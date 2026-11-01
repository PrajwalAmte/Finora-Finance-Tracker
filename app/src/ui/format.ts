import { D, type DecInput } from '../domain/money';
import { formatDay, type ISODate } from '../domain/dates';

const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plain = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });

export function inr(value: DecInput, paise = false): string {
  const v = D(value).toNumber();
  return (paise ? inr2 : inr0).format(v);
}

/** Indian short form: ₹950, ₹12.4K, ₹3.25L, ₹1.2Cr. */
export function inrShort(value: DecInput): string {
  const v = D(value).toNumber();
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7)}Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5)}L`;
  if (a >= 1e4) return `${sign}₹${trim(a / 1e3)}K`;
  return `${sign}${inr0.format(a)}`;
}

function trim(n: number): string {
  return n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1).replace(/\.0$/, '') : n.toFixed(2).replace(/\.?0+$/, '');
}

export function qty(value: DecInput): string {
  return plain.format(D(value).toNumber());
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return `${(0).toFixed(digits)}%`;
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(digits)}%`;
}

export function xirrPct(value: number | null): string {
  return value === null ? '—' : pct(value * 100);
}

export function day(date: ISODate | undefined, pattern = 'dd MMM yyyy'): string {
  return date ? formatDay(date, pattern) : '—';
}

export function tone(value: DecInput): string {
  const v = D(value);
  if (v.gt(0)) return 'text-success-600 dark:text-success-400';
  if (v.lt(0)) return 'text-error-600 dark:text-error-400';
  return 'text-neutral-500';
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
