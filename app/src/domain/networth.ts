import { D, Decimal, ZERO, dec } from './money';
import { today, type ISODate } from './dates';
import { create, live } from './records';
import { computePositions, type Position } from './portfolio';
import type { Snapshot, VaultData } from './types';

export interface NetWorth {
  assets: Decimal;
  liabilities: Decimal;
  netWorth: Decimal;
  invested: Decimal;
  byType: Record<string, Decimal>;
}

export function netWorth(data: VaultData, ownerId?: string, positions?: Position[]): NetWorth {
  const pos = (positions ?? computePositions(data)).filter(p => !ownerId || p.holding.ownerId === ownerId);
  const byType: Record<string, Decimal> = {};
  for (const p of pos) byType[p.holding.type] = (byType[p.holding.type] ?? ZERO).plus(p.value);
  const assets = pos.reduce((s, p) => s.plus(p.value), ZERO);
  const invested = pos.reduce((s, p) => s.plus(p.invested), ZERO);
  const liabilities = live(data.loans)
    .filter(l => !ownerId || l.ownerId === ownerId)
    .filter(l => !l.closedAt)
    .reduce((s, l) => s.plus(D(l.balance)), ZERO);
  return { assets, liabilities, netWorth: assets.minus(liabilities), invested, byType };
}

/** One snapshot per day with a deterministic id, so the same day on two devices merges into one record. */
export function snapshotFor(data: VaultData, date: ISODate = today(), positions?: Position[]): Snapshot {
  const nw = netWorth(data, undefined, positions);
  const byType: Record<string, string> = {};
  for (const [k, v] of Object.entries(nw.byType)) byType[k] = dec(v);
  return create<Snapshot>({
    id: `snap-${date}`,
    date,
    assets: dec(nw.assets),
    liabilities: dec(nw.liabilities),
    netWorth: dec(nw.netWorth),
    invested: dec(nw.invested),
    byType,
  });
}

/**
 * Net worth over time. Snapshots taken before a loan was added do not contain it, so adding a
 * years-old loan would look like a sudden drop. Loans are subtracted from the older points too,
 * which keeps the trend about what actually changed.
 */
export function snapshotSeries(data: VaultData, days = 365): { date: ISODate; value: number }[] {
  const loans = live(data.loans).filter(l => !l.closedAt);
  return live(data.snapshots)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-days)
    .map(s => {
      const missing = loans.filter(l => l.createdAt.slice(0, 10) > s.date).reduce((sum, l) => sum.plus(D(l.balance)), ZERO);
      return { date: s.date, value: D(s.netWorth).minus(missing).toNumber() };
    });
}
