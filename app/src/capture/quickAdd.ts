import { addDays, parseDate, toISODate, today, type ISODate } from '../domain/dates';
import type { EntryKind } from '../domain/types';

export interface QuickAddResult {
  kind: EntryKind;
  amount: string | null;
  date: ISODate;
  paymentMethod?: string;
  description: string;
  /** Words the parser recognised, for highlighting in the preview. */
  matched: string[];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const PAYMENT_WORDS: [RegExp, string][] = [
  [/^(upi|gpay|phonepe|paytm|bhim)$/i, 'UPI'],
  [/^(cash)$/i, 'Cash'],
  [/^(cc|credit|creditcard)$/i, 'Credit Card'],
  [/^(dc|debit|debitcard|card)$/i, 'Debit Card'],
  [/^(netbanking|neft|imps)$/i, 'Net Banking'],
  [/^(wallet)$/i, 'Wallet'],
];

const FILLER = /^(spent|spend|paid|pay|for|on|at|to|via|by|using|with|rs\.?|inr|₹|rupees?|the|a|an|from|got|received)$/i;
const INCOME_HINT = /^(salary|received|got|income|refund|cashback|credited|bonus|interest|dividend)$/i;

function parseAmount(token: string): string | null {
  const m = token.replace(/^(rs\.?|inr|₹)/i, '').match(/^(\d[\d,]*(?:\.\d{1,2})?)(k|l|lakh|lac)?$/i);
  if (!m) return null;
  let value = Number(m[1].replace(/,/g, ''));
  const unit = m[2]?.toLowerCase();
  if (unit === 'k') value *= 1000;
  if (unit === 'l' || unit === 'lakh' || unit === 'lac') value *= 100000;
  return Number.isFinite(value) && value > 0 ? String(Math.round(value * 100) / 100) : null;
}

function resolveDay(words: string[], i: number, asOf: ISODate): { date: ISODate; used: number } | null {
  const w = words[i].toLowerCase();
  if (w === 'today') return { date: asOf, used: 1 };
  if (w === 'yesterday' || w === 'yday') return { date: addDays(asOf, -1), used: 1 };
  const wd = WEEKDAYS.findIndex(d => w.startsWith(d) && w.length <= 9);
  if (wd !== -1 && /^[a-z]+$/.test(w)) {
    const base = parseDate(asOf);
    const diff = (base.getDay() - wd + 7) % 7 || 7;
    return { date: addDays(asOf, -diff), used: 1 };
  }
  // dd/mm or dd-mm(-yy)
  const slash = w.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (slash) {
    const year = slash[3] ? (slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3])) : Number(asOf.slice(0, 4));
    const d = new Date(year, Number(slash[2]) - 1, Number(slash[1]));
    if (!Number.isNaN(d.getTime())) return { date: clampFuture(toISODate(d), asOf), used: 1 };
  }
  // "3 oct" / "oct 3"
  const asNum = Number(w);
  const next = words[i + 1]?.toLowerCase().slice(0, 3);
  if (Number.isInteger(asNum) && asNum >= 1 && asNum <= 31 && next && MONTHS.includes(next)) {
    const d = new Date(Number(asOf.slice(0, 4)), MONTHS.indexOf(next), asNum);
    return { date: clampFuture(toISODate(d), asOf), used: 2 };
  }
  const mon = MONTHS.indexOf(w.slice(0, 3));
  const nextNum = Number(words[i + 1]);
  if (mon !== -1 && /^[a-z]+$/.test(w) && Number.isInteger(nextNum) && nextNum >= 1 && nextNum <= 31) {
    const d = new Date(Number(asOf.slice(0, 4)), mon, nextNum);
    return { date: clampFuture(toISODate(d), asOf), used: 2 };
  }
  return null;
}

/** A date without a year that lands in the future means last year ("28 dec" typed in January). */
function clampFuture(date: ISODate, asOf: ISODate): ISODate {
  if (date <= asOf) return date;
  return `${Number(date.slice(0, 4)) - 1}${date.slice(4)}`;
}

/**
 * Parse one line of quick-add text, on the device, with no model:
 *   "200 chai upi yesterday", "spent 1,250 on groceries at dmart via card", "+50k salary", "uber 450 3 oct"
 */
export function parseQuickAdd(text: string, asOf: ISODate = today()): QuickAddResult {
  const raw = text.trim();
  let kind: EntryKind = 'EXPENSE';
  let body = raw;
  if (body.startsWith('+')) {
    kind = 'INCOME';
    body = body.slice(1);
  } else if (body.startsWith('-')) {
    body = body.slice(1);
  }

  const words = body.split(/\s+/).filter(Boolean);
  const keep: string[] = [];
  const matched: string[] = [];
  let amount: string | null = null;
  let date = asOf;
  let paymentMethod: string | undefined;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const bare = word.replace(/[.,;:!]+$/, '');
    if (!amount) {
      const a = parseAmount(bare);
      if (a) {
        amount = a;
        matched.push(word);
        continue;
      }
    }
    const day = resolveDay(words.map(w => w.replace(/[.,;:!]+$/, '')), i, asOf);
    if (day) {
      date = day.date;
      matched.push(...words.slice(i, i + day.used));
      i += day.used - 1;
      continue;
    }
    const pm = PAYMENT_WORDS.find(([re]) => re.test(bare));
    if (pm && !paymentMethod) {
      paymentMethod = pm[1];
      matched.push(word);
      continue;
    }
    if (INCOME_HINT.test(bare)) kind = 'INCOME';
    if (FILLER.test(bare)) continue;
    keep.push(bare);
  }

  const description = keep.join(' ').replace(/\s+/g, ' ').trim();
  return {
    kind,
    amount,
    date,
    paymentMethod,
    description: description ? description[0].toUpperCase() + description.slice(1) : '',
    matched,
  };
}
