import { addDays as dfAddDays, addMonths as dfAddMonths, differenceInCalendarDays, differenceInCalendarMonths, endOfMonth, format, getDaysInMonth, isValid, parseISO } from 'date-fns';

/** Calendar dates are stored as 'yyyy-MM-dd' in local time. Timestamps (createdAt/updatedAt) are full ISO strings. */
export type ISODate = string;

export function toISODate(date: Date): ISODate {
  return format(date, 'yyyy-MM-dd');
}

export function parseDate(value: ISODate): Date {
  return parseISO(value);
}

export function isISODate(value: unknown): value is ISODate {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value));
}

let clock: () => Date = () => new Date();

/** Tests pin "today" through this hook; the app never calls it. */
export function setClock(fn: () => Date): void {
  clock = fn;
}

export function now(): Date {
  return clock();
}

export function today(): ISODate {
  return toISODate(clock());
}

export function nowStamp(): string {
  return clock().toISOString();
}

/** Local calendar date of a timestamp. `stamp.slice(0, 10)` would give the UTC date, a day off around midnight in India. */
export function stampDate(stamp: string): ISODate {
  return toISODate(new Date(stamp));
}

export function addDays(date: ISODate, days: number): ISODate {
  return toISODate(dfAddDays(parseISO(date), days));
}

export function addMonths(date: ISODate, months: number): ISODate {
  return toISODate(dfAddMonths(parseISO(date), months));
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return differenceInCalendarDays(parseISO(to), parseISO(from));
}

/** Whole months from `from` to `to`, counting only completed months. */
export function monthsBetween(from: ISODate, to: ISODate): number {
  const a = parseISO(from);
  const b = parseISO(to);
  let months = differenceInCalendarMonths(b, a);
  if (b.getDate() < a.getDate()) months -= 1;
  return months;
}

export function monthKey(date: ISODate): string {
  return date.slice(0, 7);
}

export function monthStart(date: ISODate): ISODate {
  return `${date.slice(0, 7)}-01`;
}

export function monthEnd(date: ISODate): ISODate {
  return toISODate(endOfMonth(parseISO(date)));
}

/** The given day of the month for the month containing `date`, clamped to the month length (31 → 28/29/30). */
export function dayInMonth(date: ISODate, day: number): ISODate {
  const d = parseISO(monthStart(date));
  const clamped = Math.min(Math.max(1, day), getDaysInMonth(d));
  return toISODate(new Date(d.getFullYear(), d.getMonth(), clamped));
}

/**
 * Every occurrence of `day`-of-month strictly after `after` and on or before `until`.
 * Used for EMIs and SIP debits.
 */
export function monthlyOccurrences(day: number, after: ISODate, until: ISODate, notBefore?: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let cursor = monthStart(after);
  for (let guard = 0; guard < 1200; guard++) {
    const occ = dayInMonth(cursor, day);
    if (occ > until) break;
    if (occ > after && (!notBefore || occ >= notBefore)) out.push(occ);
    cursor = addMonths(cursor, 1);
  }
  return out;
}

/** Indian financial year label for a date: 2026-10-29 → "2026-27". */
export function financialYear(date: ISODate): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function financialYearRange(fy: string): { start: ISODate; end: ISODate } {
  const start = Number(fy.slice(0, 4));
  return { start: `${start}-04-01`, end: `${start + 1}-03-31` };
}

export function formatDay(date: ISODate, pattern = 'dd MMM yyyy'): string {
  return format(parseISO(date), pattern);
}
