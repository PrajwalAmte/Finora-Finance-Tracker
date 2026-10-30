import * as XLSX from 'xlsx';
import { D, Decimal, dec, price, units } from '../domain/money';
import { parseLooseDate } from '../capture/textParsers';
import { toISODate } from '../domain/dates';
import type { AssetType } from '../domain/types';
import { ImportError, type BankPreview, type ParsedBankTxn, type ParsedHolding, type StatementPreview } from './types';

type Row = (string | number | Date | null | undefined)[];

/** Read every sheet of an .xlsx/.xls/.csv as rows of cells. SheetJS handles all three formats. */
export function readRows(bytes: Uint8Array): { name: string; rows: Row[] }[] {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: 'array', cellDates: true, dense: true });
  } catch (e) {
    throw new ImportError(`Could not open the spreadsheet: ${(e as Error).message}`, 'UNREADABLE');
  }
  return wb.SheetNames.map(name => ({
    name,
    rows: XLSX.utils.sheet_to_json<Row>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false }),
  }));
}

const cellText = (v: Row[number]): string => (v === null || v === undefined ? '' : v instanceof Date ? toISODate(v) : String(v).trim());

function cellNumber(v: Row[number]): Decimal | null {
  if (v === null || v === undefined || v === '' || v === '-') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? new Decimal(v) : null;
  const s = String(v).replace(/[₹$,\s]/g, '').replace(/^\((.*)\)$/, '-$1').replace(/(cr|dr)$/i, '');
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  return D(s);
}

function cellDate(v: Row[number]): string | null {
  if (v instanceof Date) return toISODate(v);
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? toISODate(new Date(d.y, d.m - 1, d.d)) : null;
  }
  const s = cellText(v);
  if (!/\d{1,4}[/.\-\s][\dA-Za-z]{1,9}[/.\-\s]\d{1,4}/.test(s)) return null;
  const parsed = parseLooseDate(s.replace(/\./g, '-'), '');
  return parsed || null;
}

const norm = (s: string) => s.toLowerCase().replace(/[.:*]/g, '').replace(/\s+/g, ' ').trim();

/** Index of the first header cell matching any alias (exact match beats substring). */
function findColumn(rawHeader: string[], aliases: string[], taken: Set<number>): number {
  const header = rawHeader.map(norm);
  for (const alias of aliases.map(norm)) {
    const i = header.findIndex((h, idx) => !taken.has(idx) && h === alias);
    if (i >= 0) return i;
  }
  // Short aliases ("dr", "cr", "qty") only match exactly: "description" contains "cr".
  for (const alias of aliases.map(norm)) {
    if (alias.length <= 3) continue;
    const i = header.findIndex((h, idx) => !taken.has(idx) && h.includes(alias));
    if (i >= 0) return i;
  }
  return -1;
}

// ── Broker holdings (Zerodha, Groww, Upstox, ICICI, HDFC Sec, Angel, 5paisa, Kotak…) ─────

const H = {
  isin: ['isin', 'isin code'],
  qty: ['net qty', 'net quantity', 'quantity available', 'quantity', 'qty', 'shares', 'units', 'balance'],
  avg: ['avg. cost', 'avg cost', 'average cost', 'average price', 'avg. price', 'avg price', 'avg buy price', 'buy price', 'purchase price', 'cost price', 'cost/share', 'cost per share'],
  name: ['instrument', 'scrip name', 'security name', 'stock name', 'scheme name', 'company name', 'security', 'scrip', 'stock', 'scheme', 'name'],
  symbol: ['nse symbol', 'bse symbol', 'trading symbol', 'symbol', 'ticker', 'nse code'],
  ltp: ['last traded price', 'last price', 'market price', 'current price', 'close price', 'closing price', 'ltp', 'cmp', 'nav'],
  type: ['instrument type', 'asset type', 'asset class', 'type', 'series'],
};

function holdingType(typeText: string, isin: string | undefined, name: string): AssetType {
  const t = typeText.toLowerCase();
  if (t.includes('etf')) return 'ETF';
  if (t.includes('mutual') || t === 'mf') return 'MUTUAL_FUND';
  if (/bond|ncd|debt/.test(t)) return 'BOND';
  const n = name.toLowerCase();
  if (/\betf\b|exchange traded|bees\b/.test(n)) return 'ETF';
  if (isin?.startsWith('INF')) return 'MUTUAL_FUND';
  if (isin?.startsWith('IN0') || isin?.startsWith('ING')) return 'BOND';
  if (/\bsgb\b|gold bond/.test(n)) return 'GOLD';
  if (/\b(bond|debenture|ncd|gilt)\b/.test(n)) return 'BOND';
  if (/\bfund\b|growth|idcw|direct plan|regular plan/.test(n)) return 'MUTUAL_FUND';
  return 'STOCK';
}

export function parseHoldingsSheet(bytes: Uint8Array): StatementPreview {
  const warnings: string[] = [];
  const merged = new Map<string, ParsedHolding & { cost: Decimal }>();
  let parsedSheets = 0;

  for (const sheet of readRows(bytes)) {
    let headerIdx = -1;
    let cols: Record<keyof typeof H, number> | null = null;
    for (let r = 0; r < Math.min(sheet.rows.length, 30); r++) {
      const header = sheet.rows[r].map(c => cellText(c).toLowerCase());
      const taken = new Set<number>();
      const pick = (k: keyof typeof H) => {
        const i = findColumn(header, H[k], taken);
        if (i >= 0) taken.add(i);
        return i;
      };
      const isin = pick('isin');
      const qty = pick('qty');
      const avg = pick('avg');
      const ltp = pick('ltp');
      const symbol = pick('symbol');
      const name = pick('name');
      const type = pick('type');
      if (qty >= 0 && (isin >= 0 || name >= 0 || symbol >= 0)) {
        headerIdx = r;
        cols = { isin, qty, avg, ltp, symbol, name, type };
        break;
      }
    }
    if (!cols) continue;
    const sn = sheet.name.toLowerCase();
    if (parsedSheets > 0 && /combined|all holding|consolidated|total holding|all fund|summary/.test(sn)) {
      warnings.push(`Sheet "${sheet.name}" was skipped: it looks like a combined view of the other sheets.`);
      continue;
    }
    parsedSheets++;

    for (const row of sheet.rows.slice(headerIdx + 1)) {
      let isin: string | undefined = cols.isin >= 0 ? cellText(row[cols.isin]).toUpperCase() : undefined;
      if (isin && !/^IN[A-Z0-9]{10}$/.test(isin)) isin = undefined;
      const symbol = cols.symbol >= 0 ? cellText(row[cols.symbol]) || undefined : undefined;
      const name = (cols.name >= 0 ? cellText(row[cols.name]) : '') || symbol || isin;
      if (!name || /^total/i.test(name)) continue;
      const qty = cellNumber(row[cols.qty]);
      if (!qty || qty.lte(0)) continue;
      const avg = cols.avg >= 0 ? cellNumber(row[cols.avg]) : null;
      const ltp = cols.ltp >= 0 ? cellNumber(row[cols.ltp]) : null;
      const type = holdingType(cols.type >= 0 ? cellText(row[cols.type]) : '', isin, name);
      const key = isin ?? `${type}|${(symbol ?? name).toUpperCase()}`;
      const existing = merged.get(key);
      const cost = avg ? avg.times(qty) : new Decimal(0);
      if (existing) {
        // Same security in two demat accounts or two sheets: add up, weighted average cost.
        const totalUnits = D(existing.units).plus(qty);
        existing.cost = existing.cost.plus(cost);
        existing.units = units(totalUnits);
        existing.avgCost = existing.cost.gt(0) ? price(existing.cost.div(totalUnits)) : existing.avgCost;
        continue;
      }
      merged.set(key, {
        type, name, isin, symbol: type === 'MUTUAL_FUND' ? undefined : symbol ?? (name.includes(' ') ? undefined : name),
        units: units(qty), avgCost: avg ? price(avg) : undefined, price: ltp ? price(ltp) : undefined,
        transactions: [], cost,
      });
    }
  }

  if (parsedSheets === 0) {
    throw new ImportError('Could not find a holdings table. Expected columns like Instrument/Symbol/ISIN and Quantity.');
  }
  const holdings = [...merged.values()].map(({ cost: _cost, ...h }) => h);
  if (!holdings.some(h => h.isin)) warnings.push('This file has no ISIN column, so holdings are matched by symbol or name.');
  if (holdings.length === 0) warnings.push('No holdings with a quantity were found.');
  return { source: 'BROKER_SHEET', holdings, warnings };
}

// ── Bank statements ─────────────────────────────────────────────────────────

const B = {
  date: ['txn date', 'transaction date', 'value date', 'posting date', 'trans date', 'tran date', 'date'],
  narration: ['narration', 'description', 'particulars', 'transaction details', 'transaction remarks', 'details', 'remarks', 'remark'],
  debit: ['withdrawal amt.', 'withdrawal amount', 'withdrawals', 'withdrawal', 'debit amount', 'debit', 'dr amount', 'dr'],
  credit: ['deposit amt.', 'deposit amount', 'deposits', 'deposit', 'credit amount', 'credit', 'cr amount', 'cr'],
  amount: ['transaction amount', 'txn amount', 'amount (inr)', 'amount'],
  balance: ['closing balance', 'running balance', 'balance (inr)', 'balance'],
  type: ['dr/cr', 'cr/dr', 'transaction type', 'type'],
};

const BANKS = ['HDFC', 'ICICI', 'SBI', 'State Bank', 'Axis', 'Kotak', 'Yes Bank', 'IndusInd', 'IDFC', 'Bank of Baroda', 'Canara', 'PNB', 'Union Bank', 'Federal', 'AU Small', 'RBL'];

export function parseBankSheet(bytes: Uint8Array): BankPreview {
  const sheets = readRows(bytes);
  const { rows } = sheets[0];
  let headerIdx = -1;
  let cols: Record<keyof typeof B, number> | null = null;
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const header = rows[r].map(c => cellText(c).toLowerCase());
    const taken = new Set<number>();
    const pick = (k: keyof typeof B) => {
      const i = findColumn(header, B[k], taken);
      if (i >= 0) taken.add(i);
      return i;
    };
    const type = pick('type');
    const narration = pick('narration');
    const debit = pick('debit');
    const credit = pick('credit');
    const balance = pick('balance');
    const amount = pick('amount');
    const date = pick('date');
    if (date >= 0 && narration >= 0 && (debit >= 0 || amount >= 0)) {
      headerIdx = r;
      cols = { date, narration, debit, credit, amount, balance, type };
      break;
    }
  }
  if (!cols) throw new ImportError('Could not find the transaction table. Expected Date, Narration/Description and Debit/Amount columns.');

  const head = rows.slice(0, headerIdx).flat().map(cellText).join(' ');
  const bankName = BANKS.find(b => head.toLowerCase().includes(b.toLowerCase()));
  const warnings: string[] = [];
  const transactions: ParsedBankTxn[] = [];

  for (const row of rows.slice(headerIdx + 1)) {
    const date = cellDate(row[cols.date]);
    if (!date) continue;
    const narration = cellText(row[cols.narration]).replace(/\s+/g, ' ');
    const debit = cols.debit >= 0 ? cellNumber(row[cols.debit]) : null;
    const credit = cols.credit >= 0 ? cellNumber(row[cols.credit]) : null;
    const amount = cols.amount >= 0 ? cellNumber(row[cols.amount]) : null;
    const balance = cols.balance >= 0 ? cellNumber(row[cols.balance]) : null;
    const type = cols.type >= 0 ? cellText(row[cols.type]).toUpperCase() : '';
    const rawAmount = cols.amount >= 0 ? cellText(row[cols.amount]).toUpperCase() : '';

    let kind: 'EXPENSE' | 'INCOME';
    let value: Decimal;
    if (debit && debit.abs().gt(0)) { kind = 'EXPENSE'; value = debit.abs(); }
    else if (credit && credit.abs().gt(0)) { kind = 'INCOME'; value = credit.abs(); }
    else if (amount && !amount.isZero()) {
      if (type.includes('CR') || rawAmount.endsWith('CR')) kind = 'INCOME';
      else if (type.includes('DR') || rawAmount.endsWith('DR')) kind = 'EXPENSE';
      else kind = amount.lt(0) ? 'EXPENSE' : 'INCOME';
      value = amount.abs();
    } else continue;

    transactions.push({ date, narration, amount: dec(value), kind, balance: balance ? dec(balance) : undefined });
  }
  if (transactions.length === 0) throw new ImportError('No transactions were found in this statement.');
  return { bankName, transactions, warnings };
}
