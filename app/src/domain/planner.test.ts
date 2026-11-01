import { describe, expect, it } from 'vitest';
import { create } from './records';
import { catchUp } from './catchUp';
import { calendar, safeToSpend } from './planner/calendar';
import { goalProgress } from './planner/goals';
import { computePositions } from './portfolio';
import { newLoanFields } from './loans';
import { buy, holding, vault } from './testFixtures';
import type { Entry, Goal, Loan, Recurring, Sip } from './types';

function sip(fields: Partial<Sip>): Sip {
  return create<Sip>({ ownerId: 'self', name: 'Nifty SIP', amount: '5000', dayOfMonth: 5, startDate: '2026-07-05', status: 'ACTIVE', autoRecord: true, ...fields });
}

describe('catchUp', () => {
  it('records SIP installments at the latest NAV, once', () => {
    const h = holding({ currentPrice: '50' });
    const s = sip({ holdingId: h.id });
    const data = vault({ holdings: [h], sips: [s] });
    const first = catchUp(data, '2026-10-29');
    expect(first.report.sipInstallments).toBe(4);
    expect(first.data.txns.every(t => t.estimated && t.units === '100')).toBe(true);
    expect(first.data.txns[0].id).toBe(`sip-${s.id}-2026-07-05`);

    const second = catchUp(first.data, '2026-10-29');
    expect(second.report.sipInstallments).toBe(0);
    expect(second.data.txns).toHaveLength(4);
  });

  it('reports SIPs it could not record', () => {
    const s = sip({ autoRecord: false });
    const r = catchUp(vault({ sips: [s] }), '2026-08-10');
    expect(r.report.pendingSips[0].dates).toEqual(['2026-07-05', '2026-08-05']);
  });

  it('takes one snapshot per day', () => {
    const h = holding({ currentPrice: '10' });
    const data = vault({ holdings: [h], txns: [buy(h.id, '2026-01-01', '10', '10')] });
    const r = catchUp(data, '2026-10-29');
    expect(r.data.snapshots.map(s => s.id)).toEqual(['snap-2026-10-29']);
    expect(r.data.snapshots[0].netWorth).toBe('100');
  });
});

describe('calendar and safe to spend', () => {
  const loan = create<Loan>({
    ownerId: 'self', name: 'Car loan',
    ...newLoanFields({ principal: '500000', annualRate: '9', tenureMonths: 60, startDate: '2026-01-10', interestType: 'COMPOUND', compounding: 'MONTHLY', emi: '10000' }),
  });
  const salary = create<Recurring>({ name: 'Salary', kind: 'INCOME', amount: '100000', dayOfMonth: 1, category: 'Salary', active: true });
  const rent = create<Recurring>({ name: 'Rent', kind: 'EXPENSE', amount: '25000', dayOfMonth: 3, category: 'Rent', active: true });

  it('lists EMIs, SIPs and recurring items in date order', () => {
    const data = vault({ loans: [loan], recurring: [salary, rent], sips: [sip({})] });
    const items = calendar(data, '2026-10-31', '2026-11-30');
    expect(items.map(i => `${i.date}:${i.kind}`)).toEqual(['2026-11-01:INCOME', '2026-11-03:BILL', '2026-11-05:SIP', '2026-11-10:EMI']);
  });

  it('subtracts commitments and discretionary spend from income', () => {
    const lunch = create<Entry>({ ownerId: 'self', kind: 'EXPENSE', date: '2026-10-12', amount: '15000', description: 'Food', category: 'Food', paymentMethod: 'UPI', source: 'MANUAL' });
    const rentPaid = create<Entry>({ ownerId: 'self', kind: 'EXPENSE', date: '2026-10-03', amount: '25000', description: 'Rent', category: 'Rent', paymentMethod: 'UPI', source: 'RECURRING', recurringId: rent.id });
    const data = vault({ loans: [loan], recurring: [salary, rent], sips: [sip({})], entries: [lunch, rentPaid] });
    const s = safeToSpend(data, '2026-10-29');
    // 100000 − (25000 rent + 5000 SIP + 10000 EMI) − 15000 discretionary
    expect(s.safe.toNumber()).toBe(45000);
    expect(s.incomeIsExpected).toBe(true);
    expect(s.daysLeft).toBe(3);
    expect(s.perDay.toNumber()).toBe(15000);
  });
});

describe('goals', () => {
  it('projects linked holdings and SIPs and suggests the extra monthly amount', () => {
    const h = holding({ currentPrice: '100' });
    const s = sip({ holdingId: h.id, amount: '10000' });
    const data = vault({ holdings: [h], sips: [s], txns: [buy(h.id, '2025-01-01', '1000', '100')] });
    const goal = create<Goal>({ name: 'House', targetAmount: '5000000', targetDate: '2031-10-29', inflationPct: '6', expectedReturnPct: '12', holdingIds: [h.id], sipIds: [s.id] });
    const g = goalProgress(goal, computePositions(data, '2026-10-29'), [s], '2026-10-29');
    expect(g.months).toBe(60);
    expect(g.futureTarget.toNumber()).toBeCloseTo(5000000 * Math.pow(1.06, 5), -2);
    expect(g.onTrack).toBe(false);
    expect(g.extraMonthly.toNumber()).toBeGreaterThan(0);
  });
});
