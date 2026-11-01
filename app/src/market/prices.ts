import { httpGetText, isNative } from '../platform/device';
import { readCache, writeCache } from '../platform/files';
import { price } from '../domain/money';
import { nowStamp, stampDate, today, toISODate } from '../domain/dates';
import { live, touch } from '../domain/records';
import type { Holding, VaultData } from '../domain/types';
import { AMFI_URL, lookup, parseNavAll, type NavIndex, type NavLookup } from './amfi';

const NAV_CACHE = 'amfi-nav.json';

export function priceEndpoints(): { amfi: string; yahoo: (symbol: string) => string; headers: Record<string, string> } {
  if (isNative()) {
    return {
      amfi: AMFI_URL,
      yahoo: s => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&range=5d`,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    };
  }
  return { amfi: '/api/amfi', yahoo: s => `/api/yahoo/${encodeURIComponent(s)}`, headers: {} };
}

let memo: { index: NavIndex; lookup: NavLookup } | null = null;

/** Cached NAV index; fetched at most once a day. The cache is public data and stays unencrypted. */
export async function navIndex(force = false): Promise<NavLookup> {
  if (!force && memo && stampDate(memo.index.fetchedAt) === today()) return memo.lookup;
  if (!force && !memo) {
    const cached = await readCache(NAV_CACHE);
    if (cached) {
      const index = JSON.parse(cached) as NavIndex;
      memo = { index, lookup: lookup(index) };
      if (stampDate(index.fetchedAt) === today()) return memo.lookup;
    }
  }
  try {
    const text = await httpGetText(priceEndpoints().amfi);
    const index = parseNavAll(text, nowStamp());
    if (index.schemes.length < 100) throw new Error('AMFI returned an unexpected file');
    memo = { index, lookup: lookup(index) };
    await writeCache(NAV_CACHE, JSON.stringify(index)).catch(() => {});
    return memo.lookup;
  } catch (e) {
    // Offline: keep using yesterday's (or older) NAVs.
    if (memo) return memo.lookup;
    throw e;
  }
}

export function cachedNavDate(): string | null {
  return memo?.index.fetchedAt ?? null;
}

/** NSE by default; symbols already suffixed (.NS, .BO) are used as-is. */
export function yahooSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  return /\.(NS|BO)$/.test(s) || s.includes('^') ? s : `${s}.NS`;
}

export async function fetchStockPrice(symbol: string): Promise<{ price: number; date: string } | null> {
  const ep = priceEndpoints();
  const text = await httpGetText(ep.yahoo(yahooSymbol(symbol)), ep.headers);
  const json = JSON.parse(text) as {
    chart?: { result?: { meta?: { regularMarketPrice?: number; regularMarketTime?: number }; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
  };
  const r = json.chart?.result?.[0];
  const live = r?.meta?.regularMarketPrice;
  const closes = r?.indicators?.quote?.[0]?.close?.filter((c): c is number => typeof c === 'number') ?? [];
  const p = live ?? closes[closes.length - 1];
  if (!p || !Number.isFinite(p)) return null;
  const when = r?.meta?.regularMarketTime ? toISODate(new Date(r.meta.regularMarketTime * 1000)) : today();
  return { price: p, date: when };
}

export interface RefreshResult {
  data: VaultData;
  updated: number;
  failed: string[];
}

/** Update every holding's price: AMFI for mutual funds (by scheme code or ISIN), Yahoo for listed symbols. */
export async function refreshPrices(data: VaultData): Promise<RefreshResult> {
  const holdings = live(data.holdings);
  const failed: string[] = [];
  const updates = new Map<string, Holding>();

  const funds = holdings.filter(h => h.type === 'MUTUAL_FUND' || (!h.symbol && (h.schemeCode || h.isin)));
  if (funds.length) {
    try {
      const nav = await navIndex();
      for (const h of funds) {
        const s = (h.schemeCode && nav.byCode.get(h.schemeCode)) || (h.isin && nav.byIsin.get(h.isin.toUpperCase()));
        if (!s) {
          failed.push(h.name);
          continue;
        }
        updates.set(h.id, touch(h, { currentPrice: price(s.nav), priceDate: s.date, schemeCode: h.schemeCode ?? s.code }));
      }
    } catch {
      failed.push(...funds.map(f => f.name));
    }
  }

  const listed = holdings.filter(h => h.symbol && !updates.has(h.id) && !funds.includes(h));
  // Small batches keep Yahoo from rate-limiting a phone on mobile data.
  for (let i = 0; i < listed.length; i += 4) {
    await Promise.all(listed.slice(i, i + 4).map(async h => {
      try {
        const q = await fetchStockPrice(h.symbol!);
        if (q) updates.set(h.id, touch(h, { currentPrice: price(q.price), priceDate: q.date }));
        else failed.push(h.name);
      } catch {
        failed.push(h.name);
      }
    }));
  }

  return {
    data: {
      ...data,
      holdings: data.holdings.map(h => updates.get(h.id) ?? h),
      settings: { ...data.settings, lastPriceRefreshAt: nowStamp(), updatedAt: data.settings.updatedAt },
    },
    updated: updates.size,
    failed,
  };
}
