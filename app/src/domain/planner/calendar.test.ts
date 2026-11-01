import { describe, expect, it } from 'vitest';
import { create } from '../records';
import { emptyVault } from '../../vault/schema';
import { upcoming } from './calendar';
import type { Recurring } from '../types';

describe('upcoming', () => {
  it('a 30-day window never shows a monthly salary twice', () => {
    const data = emptyVault('test');
    data.recurring.push(create<Recurring>({ name: 'Salary', kind: 'INCOME', amount: '100000', dayOfMonth: 1, category: 'Salary', active: true }));
    const items = upcoming(data, 30, '2026-11-01').filter(i => i.kind === 'INCOME');
    expect(items.map(i => i.date)).toEqual(['2026-11-01']);
  });
});
