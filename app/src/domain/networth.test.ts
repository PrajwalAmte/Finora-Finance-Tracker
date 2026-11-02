import { describe, expect, it } from 'vitest';
import { create } from './records';
import { emptyVault } from '../vault/schema';
import { snapshotSeries } from './networth';
import type { Loan, Snapshot } from './types';

describe('snapshotSeries', () => {
  it('adding an old loan today does not look like a drop in net worth', () => {
    const data = emptyVault('test');
    data.snapshots.push(create<Snapshot>({ id: 's1', date: '2026-10-10', assets: '700000', liabilities: '0', netWorth: '700000', invested: '600000', byType: {} }));
    data.loans.push({ ...create<Loan>({ ownerId: 'self', name: 'Edu', principal: '400000', annualRate: '10.25', interestType: 'COMPOUND', compounding: 'MONTHLY', startDate: '2022-04-16', tenureMonths: 48, emi: '10000', emiDay: 10, balance: '401130', balanceAsOf: '2026-11-02' }), createdAt: '2026-11-02T10:00:00.000Z' });
    expect(snapshotSeries(data)[0].value).toBe(700000 - 401130);
  });
});
