import type { ISODate } from '../dates';
import type { TaxClass } from '../types';

/**
 * Capital-gains rules, versioned by sale date. Rates are percentages; 'SLAB' means the
 * user's income-tax slab rate (Settings.slabRatePct). These are estimates for planning,
 * not tax advice: surcharge, indexation and special cases are not modelled.
 *
 * To update for a new Budget, append a rule with the new `from` date and bump RULES_VERSION.
 */
export interface ClassRule {
  /** Held for more than this many months = long term. */
  longTermMonths: number;
  shortRate: number | 'SLAB';
  longRate: number | 'SLAB';
}

export interface GainRule {
  from: ISODate;
  equity: ClassRule;
  /** Debt funds bought before 1 Apr 2023. */
  debt: ClassRule;
  other: ClassRule;
}

export const RULES_VERSION = '2024-07-23';

export const GAIN_RULES: GainRule[] = [
  {
    from: '2018-04-01',
    equity: { longTermMonths: 12, shortRate: 15, longRate: 10 },
    debt: { longTermMonths: 36, shortRate: 'SLAB', longRate: 20 },
    other: { longTermMonths: 36, shortRate: 'SLAB', longRate: 20 },
  },
  {
    // Finance (No. 2) Act 2024: sales on or after 23 Jul 2024.
    from: '2024-07-23',
    equity: { longTermMonths: 12, shortRate: 20, longRate: 12.5 },
    debt: { longTermMonths: 24, shortRate: 'SLAB', longRate: 12.5 },
    other: { longTermMonths: 24, shortRate: 'SLAB', longRate: 12.5 },
  },
];

/** Debt funds bought on or after this date are taxed at slab regardless of holding period (s.50AA). */
export const DEBT_SLAB_FROM: ISODate = '2023-04-01';

/** Equity bought before this date gets the 31 Jan 2018 fair-market-value cost step-up. */
export const GRANDFATHER_BEFORE: ISODate = '2018-02-01';

/** Yearly exemption on equity long-term gains (s.112A), by the financial year it starts in. */
export const LTCG_EXEMPTION: { fromFy: number; amount: number }[] = [
  { fromFy: 2018, amount: 100000 },
  { fromFy: 2024, amount: 125000 },
];

export const CESS_PCT = 4;

export function ruleFor(saleDate: ISODate): GainRule {
  let rule = GAIN_RULES[0];
  for (const r of GAIN_RULES) if (saleDate >= r.from) rule = r;
  return rule;
}

export function classRule(rule: GainRule, taxClass: TaxClass): ClassRule {
  return taxClass === 'EQUITY' ? rule.equity : taxClass === 'DEBT' ? rule.debt : rule.other;
}

export function exemptionFor(fy: string): number {
  const start = Number(fy.slice(0, 4));
  let amount = LTCG_EXEMPTION[0].amount;
  for (const e of LTCG_EXEMPTION) if (start >= e.fromFy) amount = e.amount;
  return amount;
}
