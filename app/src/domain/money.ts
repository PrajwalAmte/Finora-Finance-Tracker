import Decimal from 'decimal.js';

Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

/** Amounts are stored as decimal strings so that no value ever passes through a binary float. */
export type Dec = string;

export type DecInput = Decimal | Dec | number | null | undefined;

export const ZERO = new Decimal(0);

export function D(value: DecInput): Decimal {
  if (value === null || value === undefined || value === '') return ZERO;
  if (value instanceof Decimal) return value;
  try {
    return new Decimal(typeof value === 'string' ? value.replace(/,/g, '').trim() : value);
  } catch {
    return ZERO;
  }
}

/** Serialise for storage. Money is kept to 2dp, units/NAVs to more. */
export function dec(value: DecInput, dp = 2): Dec {
  return D(value).toDecimalPlaces(dp).toString();
}

export function units(value: DecInput): Dec {
  return dec(value, 6);
}

export function price(value: DecInput): Dec {
  return dec(value, 4);
}

export function sum(values: DecInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(D(v)), ZERO);
}

export function sumBy<T>(items: T[], pick: (item: T) => DecInput): Decimal {
  return items.reduce<Decimal>((acc, item) => acc.plus(D(pick(item))), ZERO);
}

export function num(value: DecInput): number {
  return D(value).toNumber();
}

export function isPositive(value: DecInput): boolean {
  return D(value).greaterThan(0);
}

export function max(a: DecInput, b: DecInput): Decimal {
  return Decimal.max(D(a), D(b));
}

export function min(a: DecInput, b: DecInput): Decimal {
  return Decimal.min(D(a), D(b));
}

export { Decimal };
