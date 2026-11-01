import { D, Decimal, ZERO } from '../money';
import { monthsBetween, today, type ISODate } from '../dates';
import { live } from '../records';
import type { Position } from '../portfolio';
import type { Goal, Sip } from '../types';

export interface GoalProgress {
  goal: Goal;
  months: number;
  /** Target grown by inflation to the target date. */
  futureTarget: Decimal;
  currentValue: Decimal;
  monthlySip: Decimal;
  projected: Decimal;
  gap: Decimal;
  /** Extra monthly investment needed at the expected return to close the gap. */
  extraMonthly: Decimal;
  progressPct: number;
  onTrack: boolean;
}

function fvAnnuity(payment: Decimal, r: Decimal, n: number): Decimal {
  if (n <= 0) return ZERO;
  if (r.isZero()) return payment.times(n);
  return payment.times(r.plus(1).pow(n).minus(1).div(r));
}

export function goalProgress(goal: Goal, positions: Position[], sips: Sip[], asOf: ISODate = today()): GoalProgress {
  const months = Math.max(0, monthsBetween(asOf, goal.targetDate));
  const years = new Decimal(months).div(12);
  const futureTarget = D(goal.targetAmount).times(D(goal.inflationPct).div(100).plus(1).pow(years));

  const holdingIds = new Set(goal.holdingIds);
  const currentValue = positions.filter(p => holdingIds.has(p.holding.id)).reduce((s, p) => s.plus(p.value), ZERO);
  const sipIds = new Set(goal.sipIds);
  const monthlySip = live(sips).filter(s => sipIds.has(s.id) && s.status === 'ACTIVE').reduce((s, x) => s.plus(D(x.amount)), ZERO);

  const r = D(goal.expectedReturnPct).div(100).div(12);
  const projected = currentValue.times(r.plus(1).pow(months)).plus(fvAnnuity(monthlySip, r, months));
  const gap = Decimal.max(futureTarget.minus(projected), ZERO);
  let extraMonthly = ZERO;
  if (gap.gt(0)) {
    if (months === 0) extraMonthly = gap;
    else {
      const factor = fvAnnuity(new Decimal(1), r, months);
      extraMonthly = factor.gt(0) ? gap.div(factor).toDecimalPlaces(0, Decimal.ROUND_UP) : gap;
    }
  }

  return {
    goal,
    months,
    futureTarget,
    currentValue,
    monthlySip,
    projected,
    gap,
    extraMonthly,
    progressPct: futureTarget.gt(0) ? Math.min(100, currentValue.div(futureTarget).times(100).toNumber()) : 100,
    onTrack: gap.lte(0),
  };
}
