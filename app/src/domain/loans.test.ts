import { afterEach, describe, expect, it } from 'vitest';
import { D } from './money';
import { setClock } from './dates';
import { create } from './records';
import { accrueBalance, remainingSchedule, applyPrepayment, catchUpLoan, comparePrepayVsInvest, emiFor, monthlyRate, newLoanFields, schedule, totals } from './loans';
import type { Loan } from './types';

function homeLoan(overrides: Partial<Loan> = {}): Loan {
  return create<Loan>({
    ownerId: 'self', name: 'Home loan',
    ...newLoanFields({ principal: '1000000', annualRate: '8.5', tenureMonths: 240, startDate: '2024-01-05', interestType: 'COMPOUND', compounding: 'MONTHLY' }),
    ...overrides,
  });
}

afterEach(() => setClock(() => new Date()));

describe('monthlyRate', () => {
  it('uses annual/12 for monthly compounding and simple interest', () => {
    expect(monthlyRate('12', 'COMPOUND', 'MONTHLY').toNumber()).toBeCloseTo(0.01, 10);
    expect(monthlyRate('12', 'SIMPLE', 'YEARLY').toNumber()).toBeCloseTo(0.01, 10);
  });

  it('converts quarterly compounding to an equivalent monthly rate (not the full quarterly rate)', () => {
    const m = monthlyRate('12', 'COMPOUND', 'QUARTERLY');
    // Three monthly periods must compound to exactly one quarter at 3%.
    expect(m.plus(1).pow(3).toNumber()).toBeCloseTo(1.03, 10);
    expect(m.toNumber()).toBeLessThan(0.0100);
  });

  it('converts yearly compounding to an equivalent monthly rate', () => {
    const m = monthlyRate('12', 'COMPOUND', 'YEARLY');
    expect(m.plus(1).pow(12).toNumber()).toBeCloseTo(1.12, 10);
  });
});

describe('emi and schedule', () => {
  it('matches the standard EMI for ₹10L at 8.5% over 20 years', () => {
    expect(emiFor('1000000', monthlyRate('8.5', 'COMPOUND', 'MONTHLY'), 240).toNumber()).toBeCloseTo(8678.23, 2);
  });

  it('amortizes to zero in the stated tenure', () => {
    const loan = homeLoan();
    const rows = schedule(loan.balance, monthlyRate(loan.annualRate, 'COMPOUND', 'MONTHLY'), loan.emi, '2024-02-05');
    expect(rows.length).toBe(240);
    expect(rows[rows.length - 1].balance.toNumber()).toBeCloseTo(0, 2);
    expect(totals(rows).interest.toNumber()).toBeGreaterThan(1080000);
  });
});

describe('catchUpLoan', () => {
  it('applies every EMI due since the last update with deterministic ids, and is idempotent', () => {
    const loan = homeLoan();
    const first = catchUpLoan(loan, '2024-06-10');
    expect(first.events.map(e => e.date)).toEqual(['2024-02-05', '2024-03-05', '2024-04-05', '2024-05-05', '2024-06-05']);
    expect(first.events[0].id).toBe(`emi-${loan.id}-2024-02-05`);
    expect(D(first.loan.balance).lt(D(loan.balance))).toBe(true);
    expect(first.loan.balanceAsOf).toBe('2024-06-05');

    const again = catchUpLoan(first.loan, '2024-06-10');
    expect(again.events).toHaveLength(0);
  });

  it('first EMI interest is balance × monthly rate', () => {
    const loan = homeLoan();
    const ev = catchUpLoan(loan, '2024-02-05').events[0];
    expect(Number(ev.interest)).toBeCloseTo(1000000 * 0.085 / 12, 2);
  });
});

describe('prepayment', () => {
  it('reduce-tenure keeps the EMI and cuts months; reduce-EMI lowers the EMI', () => {
    const loan = homeLoan();
    const tenure = applyPrepayment(loan, '200000', '2024-06-10', 'REDUCE_TENURE');
    expect(tenure.loan.emi).toBe(loan.emi);
    const emi = applyPrepayment(loan, '200000', '2024-06-10', 'REDUCE_EMI');
    expect(Number(emi.loan.emi)).toBeLessThan(Number(loan.emi));
    expect(tenure.event.kind).toBe('PREPAYMENT');
  });

  it('compares prepaying against investing and finds the break-even return', () => {
    setClock(() => new Date('2024-06-10T10:00:00'));
    const loan = homeLoan();
    const low = comparePrepayVsInvest(loan, '200000', { mode: 'REDUCE_TENURE', expectedReturnPct: '5', asOf: '2024-06-10' });
    expect(low.interestSaved.gt(0)).toBe(true);
    expect(low.monthsSaved).toBeGreaterThan(20);
    expect(low.better).toBe('PREPAY');

    const high = comparePrepayVsInvest(loan, '200000', { mode: 'REDUCE_TENURE', expectedReturnPct: '14', asOf: '2024-06-10' });
    expect(high.better).toBe('INVEST');

    expect(low.breakEvenReturnPct).not.toBeNull();
    // Reinvesting freed EMIs at the same return as the loan rate is roughly a wash.
    expect(low.breakEvenReturnPct!).toBeGreaterThan(7);
    expect(low.breakEvenReturnPct!).toBeLessThan(10);
  });
});

describe('moratorium (repayment not started)', () => {
  const base = (over = {}) => create<Loan>({
    ...newLoanFields({ principal: 400000, annualRate: 10.25, tenureMonths: 84, startDate: '2022-08-01', interestType: 'COMPOUND', compounding: 'MONTHLY', firstEmiDate: '2027-05-05' }),
    name: 'Education', ownerId: 'self', ...over,
  });

  it('applies no EMIs and leaves the balance alone before the first EMI', () => {
    const loan = base({ balance: '330000.00', balanceAsOf: '2026-11-02' });
    const res = catchUpLoan(loan, '2027-04-30');
    expect(res.events).toHaveLength(0);
    expect(res.loan.balance).toBe('330000.00');
  });

  it('adds the interest that built up, then starts EMIs on the first EMI date', () => {
    const loan = base({ balance: '330000.00', balanceAsOf: '2026-11-02' });
    const res = catchUpLoan(loan, '2027-05-06');
    expect(res.events.map(e => e.date)).toEqual(['2027-05-05']);
    expect(Number(res.events[0].interest)).toBeGreaterThan(2800); // interest on a grown balance
  });

  it('projects the balance and starts the schedule at the first EMI', () => {
    const loan = base({ balance: '330000.00', balanceAsOf: '2026-11-02' });
    expect(Number(accrueBalance(loan, '2027-05-05'))).toBeGreaterThan(346000);
    expect(remainingSchedule(loan)[0].date).toBe('2027-05-05');
  });
});
