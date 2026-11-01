import { D, Decimal, ZERO } from '../money';
import { addDays, monthEnd, monthStart, monthlyOccurrences, today, type ISODate } from '../dates';
import { live } from '../records';
import type { VaultData } from '../types';

export type CalendarKind = 'EMI' | 'SIP' | 'BILL' | 'INCOME';

export interface CalendarItem {
  date: ISODate;
  kind: CalendarKind;
  title: string;
  amount: Decimal;
  refId: string;
  /** Money leaving (EMI, SIP, bill) is outflow; income is inflow. */
  outflow: boolean;
}

/** Upcoming EMIs, SIP debits, bills and income between `from` (exclusive) and `to` (inclusive). */
export function calendar(data: VaultData, from: ISODate, to: ISODate): CalendarItem[] {
  const items: CalendarItem[] = [];

  for (const loan of live(data.loans)) {
    if (loan.closedAt || D(loan.balance).lte(0)) continue;
    for (const date of monthlyOccurrences(loan.emiDay, from, to, loan.firstEmiDate)) {
      items.push({ date, kind: 'EMI', title: loan.name, amount: D(loan.emi), refId: loan.id, outflow: true });
    }
  }

  for (const sip of live(data.sips)) {
    if (sip.status !== 'ACTIVE') continue;
    const end = sip.endDate && sip.endDate < to ? sip.endDate : to;
    for (const date of monthlyOccurrences(sip.dayOfMonth, from, end, sip.startDate)) {
      items.push({ date, kind: 'SIP', title: sip.name, amount: D(sip.amount), refId: sip.id, outflow: true });
    }
  }

  for (const r of live(data.recurring)) {
    if (!r.active) continue;
    for (const date of monthlyOccurrences(r.dayOfMonth, from, to)) {
      items.push({
        date, kind: r.kind === 'INCOME' ? 'INCOME' : 'BILL', title: r.name, amount: D(r.amount), refId: r.id,
        outflow: r.kind !== 'INCOME',
      });
    }
  }

  return items.sort((a, b) => a.date.localeCompare(b.date) || Number(b.outflow) - Number(a.outflow));
}

export function upcoming(data: VaultData, days: number, asOf: ISODate = today()): CalendarItem[] {
  // `days` days starting today: 30 days never reaches the same day next month.
  return calendar(data, addDays(asOf, -1), addDays(asOf, days - 1));
}

export interface SafeToSpend {
  month: string;
  income: Decimal;
  /** True when no income was recorded yet and the expected recurring income was used. */
  incomeIsExpected: boolean;
  commitments: Decimal;
  commitmentsLeft: Decimal;
  spent: Decimal;
  savingsTarget: Decimal;
  safe: Decimal;
  perDay: Decimal;
  daysLeft: number;
}

/**
 * What you can still spend this month:
 *   income − every commitment due this month (EMIs, SIPs, bills) − discretionary spend so far − savings target.
 * Expenses recorded against a recurring bill are counted in commitments, not twice.
 */
export function safeToSpend(data: VaultData, asOf: ISODate = today()): SafeToSpend {
  const start = monthStart(asOf);
  const end = monthEnd(asOf);
  const entries = live(data.entries).filter(e => e.date >= start && e.date <= end);

  const recorded = entries.filter(e => e.kind === 'INCOME').reduce((s, e) => s.plus(D(e.amount)), ZERO);
  const month = calendar(data, addDays(start, -1), end);
  const expected = month.filter(i => !i.outflow).reduce((s, i) => s.plus(i.amount), ZERO);
  const incomeIsExpected = recorded.lt(expected);
  const income = Decimal.max(recorded, expected);

  const commitments = month.filter(i => i.outflow).reduce((s, i) => s.plus(i.amount), ZERO);
  const commitmentsLeft = month.filter(i => i.outflow && i.date > asOf).reduce((s, i) => s.plus(i.amount), ZERO);
  const spent = entries.filter(e => e.kind === 'EXPENSE' && !e.recurringId).reduce((s, e) => s.plus(D(e.amount)), ZERO);
  const savingsTarget = D(data.settings.monthlySavingsTarget);

  const safe = income.minus(commitments).minus(spent).minus(savingsTarget);
  const daysLeft = Number(end.slice(8, 10)) - Number(asOf.slice(8, 10)) + 1;
  return {
    month: start.slice(0, 7),
    income,
    incomeIsExpected,
    commitments,
    commitmentsLeft,
    spent,
    savingsTarget,
    safe,
    perDay: daysLeft > 0 && safe.gt(0) ? safe.div(daysLeft).toDecimalPlaces(0) : ZERO,
    daysLeft,
  };
}
