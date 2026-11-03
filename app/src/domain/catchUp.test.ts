import { describe, expect, it } from 'vitest';
import { create } from './records';
import { emptyVault } from '../vault/schema';
import { catchUp } from './catchUp';
import type { Recurring } from './types';

describe('recurring income and bills', () => {
  it('records salary as an entry once it is due, once only, and not after deleting it', () => {
    const data = emptyVault('t');
    data.recurring.push({ ...create<Recurring>({ name: 'Salary', kind: 'INCOME', amount: '100000', dayOfMonth: 1, category: 'Salary', active: true }), createdAt: '2026-10-20T00:00:00.000Z' });
    const first = catchUp(data, '2026-11-03').data;
    expect(first.entries.filter(e => e.kind === 'INCOME').map(e => e.date)).toEqual(['2026-11-01']);
    expect(catchUp(first, '2026-11-04').data.entries).toHaveLength(1);
    const deleted = { ...first, entries: first.entries.map(e => ({ ...e, deletedAt: '2026-11-04T00:00:00.000Z' })) };
    expect(catchUp(deleted, '2026-11-05').data.entries.filter(e => !e.deletedAt)).toHaveLength(0);
  });
});
