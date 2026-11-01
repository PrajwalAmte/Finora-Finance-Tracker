import { D, Decimal, ZERO, dec, price, units } from '../domain/money';
import { parseLooseDate } from '../capture/textParsers';
import type { AssetType } from '../domain/types';
import type { ParsedHolding, ParsedTxn, StatementPreview } from './types';

const ISIN = /\b(IN[A-Z0-9]{10})\b/;
const DATES = /\b\d{1,2}[-/](?:[A-Za-z]{3}|\d{1,2})[-/]\d{2,4}\b/g;
const NUM_TOKEN = /^\(?-?[\d,]*\d(?:\.\d+)?\)?$/;

/** Numbers in a line, in order. Dates are removed first; "(1,234.50)" and "-1234.5" are negative. */
function numbers(text: string): Decimal[] {
  const out: Decimal[] = [];
  for (const raw of text.replace(DATES, ' ').split(/\s+/)) {
    const token = raw.replace(/^(?:INR|Rs\.?|₹)/i, '').replace(/[:;]+$/, '').replace(/,$/, '');
    if (!NUM_TOKEN.test(token)) continue;
    const neg = token.startsWith('(') || token.startsWith('-');
    const v = D(token.replace(/[(),-]/g, ''));
    out.push(neg ? v.neg() : v);
  }
  return out;
}

const lastNumber = (text: string) => numbers(text).pop() ?? null;

function statementDate(text: string): string | undefined {
  const m = text.match(/(?:as\s+on|as\s+of|statement\s+date|closing\s+date|period\b.*?\bto)\s*[:-]?\s*(\d{1,2}[/-](?:\d{1,2}|[A-Za-z]{3})[/-]\d{2,4})/i);
  return m ? parseLooseDate(m[1]) : undefined;
}

function cleanName(raw: string): string {
  return raw.replace(/[|-]+\s*$/, '').replace(/\s{2,}/g, ' ').trim();
}

function equityType(isin: string, name: string): AssetType {
  const n = name.toLowerCase();
  if (n.includes(' etf') || n.includes('exchange traded') || n.endsWith('etf') || n.includes(' bees')) return 'ETF';
  if (/\b(bond|debenture|ncd|gilt|sgb|sovereign gold)\b/.test(n)) return n.includes('gold') ? 'GOLD' : 'BOND';
  if (isin.startsWith('IN0') || isin.startsWith('ING')) return 'BOND';
  return 'STOCK';
}

// ── CAMS / KFintech consolidated MF statement (detailed, with transactions) ──

const TXN_LINE = /^(\d{1,2}-[A-Za-z]{3}-\d{4})\s+(.+?)\s+(\(?-?[\d,]+\.\d+\)?)\s+(\(?-?[\d,]+\.\d+\)?)\s+([\d,]+\.\d+)\s+(\(?-?[\d,]+\.\d+\)?)\s*$/;
const AMOUNT_ONLY_LINE = /^(\d{1,2}-[A-Za-z]{3}-\d{4})\s+(.+?)\s+(\(?-?[\d,]+\.\d+\)?)\s*$/;

const SCHEME_SUFFIX = /\s*(?:\((?:non-demat|demat)\)|\(advisor[^)]*\)|registrar\s*:.*|-)\s*$/i;

function schemeNameFrom(line: string, isin: string): string {
  let name = line
    .replace(new RegExp(`\\(?\\s*ISIN\\s*[:-]?\\s*${isin}\\s*\\)?`, 'i'), ' ')
    .replace(`(${isin})`, ' ')
    .replace(/^[A-Z0-9]{2,8}\s*-\s*/, '') // "B205RG-" scheme prefix codes
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Trailing "(Non-Demat)", "(Advisor: X)", "Registrar : CAMS" and dangling dashes, in any order.
  for (let prev = ''; prev !== name; ) {
    prev = name;
    name = name.replace(SCHEME_SUFFIX, '').trim();
  }
  return name;
}

/**
 * Parse a CAMS/KFintech CAS: for each folio and scheme, every transaction plus the closing
 * balance, NAV and cost. Transactions let the app compute exact XIRR and capital gains.
 */
export function parseMfCas(lines: string[]): StatementPreview {
  const warnings: string[] = [];
  const holdings: ParsedHolding[] = [];
  let folio: string | undefined;
  let amc: string | undefined;
  let current: ParsedHolding | null = null;
  let closingUnits: Decimal | null = null;
  let totalCost: Decimal | null = null;

  const finish = () => {
    if (!current) return;
    const net = current.transactions.reduce((s, t) => (t.kind === 'BUY' ? s.plus(t.units) : t.kind === 'SELL' ? s.minus(t.units) : s), ZERO);
    if (closingUnits !== null) current.units = units(closingUnits);
    else current.units = units(net);
    if (current.transactions.length && closingUnits !== null && net.minus(closingUnits).abs().gt(0.01)) {
      current.historyMismatch = true;
      warnings.push(`${current.name}: transactions add up to ${net.toFixed(3)} units but the closing balance is ${closingUnits.toFixed(3)}. The statement period may not start at your first purchase; an opening balance will be added.`);
    }
    if (totalCost && D(current.units).gt(0)) current.avgCost = price(totalCost.div(D(current.units)));
    if (D(current.units).gt(0) || current.transactions.length) holdings.push(current);
    current = null;
    closingUnits = null;
    totalCost = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const low = line.toLowerCase();

    if (/^[A-Za-z0-9 &.()-]+mutual fund\s*$/i.test(line)) amc = line;

    const folioMatch = line.match(/folio\s*(?:no)?\.?\s*[:-]?\s*([\w/ ]{4,30}?)(?:\s{2,}|\s+(?:kyc|pan|nominee)\b|$)/i);
    if (folioMatch && !ISIN.test(line)) {
      finish();
      folio = folioMatch[1].replace(/\s+/g, '').trim();
      continue;
    }

    const isinMatch = line.match(/ISIN\s*[:-]?\s*(IN[A-Z0-9]{10})/i) ?? line.match(/\((IN[A-Z0-9]{10})\)/);
    if (isinMatch && !TXN_LINE.test(line)) {
      finish();
      const isin = isinMatch[1];
      let name = schemeNameFrom(line, isin);
      if (name.length < 6 && lines[i - 1]) name = schemeNameFrom(`${lines[i - 1].trim()} ${name}`, isin);
      current = { type: 'MUTUAL_FUND', name, isin, folio, amc, units: '0', transactions: [] };
      continue;
    }
    if (!current) continue;

    if (/closing\s+(?:unit\s+)?balance/i.test(line)) {
      const after = line.split(/closing\s+(?:unit\s+)?balance\s*:?/i)[1] ?? '';
      const nums = numbers(after);
      if (nums.length) closingUnits = nums[0].abs();
      const nav = line.match(/NAV\s+on\s+[\w-]+\s*:?\s*(?:INR|Rs\.?)?\s*([\d,]+\.\d+)/i) ?? line.match(/@\s*(?:Rs\.?\s*)?([\d,]+\.\d+)/);
      if (nav) current.price = price(nav[1]);
      const cost = line.match(/(?:total\s+)?cost\s+value\s*:?\s*(?:INR|Rs\.?)?\s*([\d,]+\.\d+)/i);
      if (cost) totalCost = D(cost[1]);
      continue;
    }
    if (/(?:total\s+)?cost\s+value|invested\s+value|amount\s+invested/i.test(low)) {
      const v = lastNumber(line);
      if (v && v.gt(0)) totalCost = v;
      continue;
    }

    const t = line.match(TXN_LINE);
    if (t) {
      const [, date, desc, amountS, unitsS, priceS] = t;
      const amount = numbers(amountS)[0] ?? ZERO;
      const u = numbers(unitsS)[0] ?? ZERO;
      if (u.isZero()) continue;
      const isSell = u.lt(0) || /redemption|switch[- ]?out|sell|transfer[- ]?out|stp[- ]?out|swp/i.test(desc);
      const txn: ParsedTxn = {
        date: parseLooseDate(date),
        kind: isSell ? 'SELL' : 'BUY',
        units: units(u.abs()),
        price: price(priceS),
        amount: dec(amount.abs()),
        description: desc.trim(),
        systematic: /systematic|sip\b/i.test(desc),
      };
      current.transactions.push(txn);
      continue;
    }

    const a = line.match(AMOUNT_ONLY_LINE);
    if (a && /idcw|dividend/i.test(a[2]) && !/reinvest/i.test(a[2])) {
      current.transactions.push({
        date: parseLooseDate(a[1]), kind: 'DIVIDEND', units: '0', price: '0',
        amount: dec(numbers(a[3])[0]?.abs() ?? 0), description: a[2].trim(), systematic: false,
      });
    }
    // Stamp duty / STT lines ("*** Stamp Duty ***") are folded into the purchase price already.
  }
  finish();

  if (holdings.length === 0) warnings.push('No mutual fund folios were found. Check that this is a CAMS or KFintech consolidated account statement.');
  return { source: 'CAS_MF', holdings, warnings, statementDate: statementDate(lines.join('\n')) };
}

// ── CDSL / NSDL depository CAS (holdings only) ──────────────────────────────

const WINDOW = 8;

/**
 * Port of the server's CasStatementParser: CDSL's tabular rows (name, ISIN, quantity, value on one
 * line) and NSDL's multi-line blocks (scan ±8 lines for Balance / Market Value).
 */
export function parseDematCas(lines: string[]): StatementPreview {
  const warnings: string[] = [];
  const holdings: ParsedHolding[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = line.match(ISIN);
    if (!m) continue;
    const isin = m[1];
    if (seen.has(isin)) continue;
    seen.add(isin);

    let name = '';
    let qty: Decimal | null = null;
    let value: Decimal | null = null;
    let avg: Decimal | null = null;
    let na = false;

    const remainder = line.replace(isin, ' ').trim();
    const lineNums = numbers(remainder).filter(n => n.gte(0));
    const prefix = remainder.replace(/[\d,. ()-]+$/, '').replace(/\s{2,}/g, ' ').trim();
    if (prefix.length > 3) name = cleanName(prefix);
    if (lineNums.length >= 2) {
      qty = lineNums[lineNums.length - 2];
      value = lineNums[lineNums.length - 1];
    } else if (lineNums.length === 1) {
      qty = lineNums[0];
    }

    // The block for this ISIN ends at the neighbouring ISIN lines (NSDL prints one block per security).
    let from = i;
    while (from > Math.max(0, i - WINDOW) && !ISIN.test(lines[from - 1])) from--;
    let to = i;
    while (to < Math.min(lines.length - 1, i + WINDOW) && !ISIN.test(lines[to + 1])) to++;

    if (line.includes('N.A.') || line.includes('N/A')) na = true;
    // Name: nearest descriptive line above the ISIN, else below.
    const isLabel = (raw: string) => raw.length > 4 && !/^[\d,. %|/:-]+$/.test(raw) && !/balance|market value|quantity|value|isin|statement|nsdl|cdsl/i.test(raw);
    for (let j = i - 1; !name && j >= from; j--) if (isLabel(lines[j].trim())) name = cleanName(lines[j].trim());
    for (let j = i + 1; !name && j <= to; j++) if (isLabel(lines[j].trim())) name = cleanName(lines[j].trim());

    for (let j = from; j <= to; j++) {
      const raw = lines[j].trim();
      const low = raw.toLowerCase();
      if (j > i && lineNums.length === 0 && (raw.includes('N.A.') || raw.includes('N/A'))) na = true;
      if (qty === null && /balance|free bal|quantity|units held/.test(low)) {
        const q = lastNumber(raw);
        if (q && q.gte(0)) qty = q;
      }
      if (value === null && /market value|mkt val|current value/.test(low)) value = lastNumber(raw);
      if (avg === null && /avg|purchase cost|invested/.test(low)) {
        const v = lastNumber(raw);
        if (v && v.gt(0)) avg = v;
      }
    }

    if (!name) name = isin;
    if (na) {
      warnings.push(`Skipped ${name} (${isin}): market value is N.A. (delisted, suspended or pledged).`);
      continue;
    }
    if (qty === null) {
      warnings.push(`Skipped ${name} (${isin}): could not read the quantity.`);
      continue;
    }
    if (qty.isZero()) continue;

    const px = value && qty.gt(0) ? value.div(qty) : null;
    const detected = equityType(isin, name);
    holdings.push({
      type: isin.startsWith('INF') && detected !== 'ETF' ? 'MUTUAL_FUND' : detected,
      name, isin,
      units: units(qty),
      avgCost: avg ? price(avg) : undefined,
      price: px ? price(px) : undefined,
      transactions: [],
    });
  }

  if (seen.size === 0) warnings.push('No ISINs were found. Check the file is a CDSL or NSDL CAS and the password is right.');
  const missingCost = holdings.filter(h => !h.avgCost).length;
  if (missingCost) warnings.push(`${missingCost} holding(s) have no purchase cost in this statement; their current value will be used as cost until you edit it.`);
  return { source: 'CAS_DEMAT', holdings, warnings, statementDate: statementDate(lines.join('\n')) };
}

/** Pick the parser from the statement's own wording. */
export function parseCasLines(lines: string[]): StatementPreview {
  const head = lines.slice(0, 80).join(' ').toLowerCase();
  const isDepository = /\bnsdl\b|\bcdsl\b|depository/.test(head);
  const hasFolios = lines.some(l => /folio\s*(no)?\.?\s*[:-]/i.test(l));
  if (isDepository && !hasFolios) return parseDematCas(lines);
  if (!isDepository) return parseMfCas(lines);

  // Depository CAS with an MF folio section: demat holdings from one parser, folios from the other.
  const demat = parseDematCas(lines);
  const mf = parseMfCas(lines);
  const mfIsins = new Set(mf.holdings.map(h => h.isin));
  return {
    source: 'CAS_DEMAT',
    holdings: [...demat.holdings.filter(h => !mfIsins.has(h.isin)), ...mf.holdings],
    warnings: [...demat.warnings, ...mf.warnings.filter(w => !w.startsWith('No mutual fund'))],
    statementDate: demat.statementDate ?? mf.statementDate,
  };
}
