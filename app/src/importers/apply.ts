import { D, dec, price, units } from '../domain/money';
import { addDays, daysBetween, today, type ISODate } from '../domain/dates';
import { create, live, stableHash, touch, tombstone, upsertMany } from '../domain/records';
import { computePosition } from '../domain/portfolio';
import type { Entry, Holding, Sip, TaxClass, Txn, VaultData } from '../domain/types';
import { learn, suggestCategory } from '../capture/categorize';
import type { NavLookup } from '../market/amfi';
import type { ParsedBankTxn, ParsedHolding, StatementPreview } from './types';

export interface ApplyStatementResult {
  data: VaultData;
  holdingsAdded: number;
  holdingsUpdated: number;
  txnsAdded: number;
  estimatesReplaced: number;
  sipsCreated: number;
}

function guessTaxClass(h: ParsedHolding): TaxClass {
  if (h.type === 'BOND' || h.type === 'FD') return 'DEBT';
  if (h.type === 'GOLD' || h.type === 'OTHER') return 'OTHER';
  if (h.type === 'MUTUAL_FUND') {
    const n = h.name.toLowerCase();
    if (/\b(liquid|overnight|money market|gilt|debt|bond|corporate|banking & psu|banking and psu|credit risk|duration|floater|treasury|income fund|fixed maturity|fmp)\b/.test(n)) return 'DEBT';
    if (/\b(gold|silver|international|overseas|nasdaq|us equity|global|fund of funds?|fof)\b/.test(n)) return 'OTHER';
  }
  return 'EQUITY';
}

function holdingKey(ownerId: string, h: ParsedHolding): string {
  const ident = h.isin ?? (h.symbol ?? h.name).toUpperCase().replace(/\s+/g, '-');
  return `h-${ownerId}-${ident}${h.folio ? `-${h.folio.replace(/[^\w]/g, '')}` : ''}`;
}

function findExisting(data: VaultData, ownerId: string, h: ParsedHolding): Holding | undefined {
  const holdings = live(data.holdings).filter(x => x.ownerId === ownerId);
  if (h.isin) {
    return holdings.find(x => x.isin === h.isin && (!h.folio || !x.folio || x.folio === h.folio))
      ?? holdings.find(x => x.isin === h.isin);
  }
  const sym = h.symbol?.toUpperCase();
  return holdings.find(x => (sym && x.symbol?.toUpperCase() === sym) || x.name.toLowerCase() === h.name.toLowerCase());
}

/**
 * Turn a confirmed statement preview into vault records for one owner (self, spouse, parent…).
 *  - With a transaction history (CAMS/KFintech): every transaction is added with a content-derived id,
 *    so importing the same statement twice changes nothing, and SIP installments that were recorded
 *    at an estimated NAV are replaced by the real ones.
 *  - Holdings-only statements (depository CAS, broker sheets): the difference between the statement's
 *    units and what the app already has becomes one opening/adjusting transaction.
 */
export function applyStatement(
  data: VaultData,
  preview: StatementPreview,
  selected: ParsedHolding[],
  opts: { ownerId: string; nav?: NavLookup; asOf?: ISODate },
): ApplyStatementResult {
  const asOf = opts.asOf ?? preview.statementDate ?? today();
  const holdingUpdates: Holding[] = [];
  const newTxns: Txn[] = [];
  const replaced: Txn[] = [];
  const newSips: Sip[] = [];
  let holdingsAdded = 0;
  let holdingsUpdated = 0;

  for (const p of selected) {
    const scheme = p.isin ? opts.nav?.byIsin.get(p.isin) : undefined;
    let holding = findExisting(data, opts.ownerId, p);
    const fields: Partial<Holding> = {
      isin: p.isin ?? holding?.isin,
      symbol: p.symbol ?? holding?.symbol,
      folio: p.folio ?? holding?.folio,
      amc: p.amc ?? scheme?.amc ?? holding?.amc,
      schemeCode: p.schemeCode ?? scheme?.code ?? holding?.schemeCode,
      importSource: preview.source,
    };
    const latest = scheme?.nav ?? p.price;
    if (latest) {
      fields.currentPrice = price(latest);
      fields.priceDate = scheme?.date ?? asOf;
    }
    if (holding) {
      holding = touch(holding, fields);
      holdingsUpdated++;
    } else {
      holding = create<Holding>({
        id: holdingKey(opts.ownerId, p),
        ownerId: opts.ownerId, name: p.name, type: p.type, taxClass: guessTaxClass(p), ...fields,
      });
      holdingsAdded++;
    }
    holdingUpdates.push(holding);
    const h = holding;

    const existingTxns = live(data.txns).filter(t => t.holdingId === h.id);
    if (p.transactions.length > 0) {
      const ids = new Set(existingTxns.map(t => t.id));
      for (const t of p.transactions) {
        const id = `imp-${stableHash(`${h.id}|${t.date}|${t.kind}|${t.units}|${t.amount}`)}`;
        if (ids.has(id)) continue;
        ids.add(id);
        newTxns.push(create<Txn>({ id, holdingId: h.id, date: t.date, kind: t.kind, units: t.units, price: t.price, amount: t.amount, source: 'IMPORT' }));
        // Real installment replaces the estimate recorded on app open.
        if (t.kind === 'BUY') {
          const est = existingTxns.find(x => x.estimated && !replaced.includes(x) && Math.abs(daysBetween(x.date, t.date)) <= 4 && D(x.amount).minus(D(t.amount)).abs().lte(D(t.amount).times(0.02).plus(1)));
          if (est) replaced.push(est);
        }
      }
      // Statement period started after the first purchase: add the missing units as an opening balance.
      if (p.historyMismatch) {
        const imported = p.transactions.reduce((s, t) => (t.kind === 'BUY' ? s.plus(t.units) : t.kind === 'SELL' ? s.minus(t.units) : s), D(0));
        const gap = D(p.units).minus(imported);
        const openId = `imp-open-${stableHash(`${h.id}|${p.transactions.reduce((m, t) => (t.date < m ? t.date : m), p.transactions[0].date)}`)}`;
        if (gap.gt(0.001) && !ids.has(openId)) {
          const firstDate = p.transactions.reduce((m, t) => (t.date < m ? t.date : m), p.transactions[0].date);
          const cost = p.avgCost ? D(p.avgCost) : D(p.transactions[0].price);
          newTxns.push(create<Txn>({
            id: openId, holdingId: h.id, date: addDays(firstDate, -1), kind: 'BUY',
            units: units(gap), price: price(cost), amount: dec(gap.times(cost)), source: 'IMPORT',
          }));
        }
      }
      // A SIP in the last 45 days with no SIP record yet: create one so future installments are tracked.
      const sipBuys = p.transactions.filter(t => t.systematic && t.kind === 'BUY').sort((a, b) => a.date.localeCompare(b.date));
      const last = sipBuys[sipBuys.length - 1];
      const hasSip = live(data.sips).some(s => s.holdingId === h.id) || newSips.some(s => s.holdingId === h.id);
      if (last && !hasSip && daysBetween(last.date, today()) <= 45) {
        newSips.push(create<Sip>({
          ownerId: opts.ownerId, name: p.name, holdingId: h.id, schemeCode: fields.schemeCode, isin: p.isin,
          amount: last.amount, dayOfMonth: Number(last.date.slice(8, 10)), startDate: sipBuys[0].date,
          status: 'ACTIVE', autoRecord: true, lastInstallment: last.date,
        }));
      }
    } else {
      const position = computePosition(h, existingTxns, asOf);
      const diff = D(p.units).minus(position.units);
      if (diff.abs().gt(0.0005)) {
        const px = diff.gt(0)
          ? D(p.avgCost ?? p.price ?? latest ?? 0)
          : D(p.price ?? latest ?? position.avgCost);
        newTxns.push(create<Txn>({
          id: `imp-adj-${stableHash(`${h.id}|${asOf}|${p.units}`)}`,
          holdingId: h.id, date: asOf, kind: diff.gt(0) ? 'BUY' : 'SELL',
          units: units(diff.abs()), price: price(px), amount: dec(diff.abs().times(px)), source: 'IMPORT',
        }));
      }
    }
  }

  const replacedIds = new Set(replaced.map(t => t.id));
  const txns = upsertMany(data.txns.map(t => (replacedIds.has(t.id) ? tombstone(t) : t)), newTxns);
  return {
    data: { ...data, holdings: upsertMany(data.holdings, holdingUpdates), txns, sips: upsertMany(data.sips, newSips) },
    holdingsAdded,
    holdingsUpdated,
    txnsAdded: newTxns.length,
    estimatesReplaced: replaced.length,
    sipsCreated: newSips.length,
  };
}

export interface BankRow extends ParsedBankTxn {
  category: string;
  sourceRef: string;
  duplicate: boolean;
  /** The user changed the suggested category, so the choice is worth learning. */
  edited?: boolean;
}

/** Categorise bank rows and flag those already in the vault (same statement imported twice, or captured by SMS). */
export function prepareBankRows(data: VaultData, rows: ParsedBankTxn[]): BankRow[] {
  const existing = live(data.entries);
  const refs = new Set(existing.map(e => e.sourceRef).filter(Boolean));
  return rows.map(r => {
    const sourceRef = `bank-${stableHash(`${r.date}|${r.amount}|${r.narration}|${r.balance ?? ''}`)}`;
    const nearDup = existing.some(e => e.kind === r.kind && e.amount === r.amount && Math.abs(daysBetween(e.date, r.date)) <= 1 && e.source !== 'MANUAL');
    return { ...r, category: suggestCategory(data, r.narration, r.kind).category, sourceRef, duplicate: refs.has(sourceRef) || nearDup };
  });
}

export function applyBankRows(data: VaultData, rows: BankRow[], opts: { ownerId: string; paymentMethod: string }): { data: VaultData; added: number } {
  let next = data;
  const entries: Entry[] = [];
  for (const r of rows) {
    entries.push(create<Entry>({
      id: r.sourceRef, ownerId: opts.ownerId, kind: r.kind, date: r.date, amount: r.amount,
      description: r.narration.slice(0, 120), category: r.category, paymentMethod: opts.paymentMethod,
      source: 'IMPORT', sourceRef: r.sourceRef,
    }));
    if (r.edited) next = learn(next, r.narration, r.category);
  }
  return { data: { ...next, entries: upsertMany(next.entries, entries) }, added: entries.length };
}
