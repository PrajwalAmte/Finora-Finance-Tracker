import { today, type ISODate } from './dates';
import { live, upsertMany } from './records';
import { catchUpLoan } from './loans';
import { catchUpSip } from './sips';
import { computePositions } from './portfolio';
import { snapshotFor } from './networth';
import type { Loan, LoanEvent, Sip, Txn, VaultData } from './types';

export interface CatchUpReport {
  emisApplied: number;
  loansClosed: string[];
  sipInstallments: number;
  estimatedSips: number;
  pendingSips: { sip: Sip; dates: ISODate[] }[];
  snapshotTaken: boolean;
}

/**
 * Replaces the server's scheduled jobs. Runs on app open/unlock and applies everything that
 * fell due since the last run: EMIs move loan balances, SIP installments become buy transactions,
 * and today's net-worth snapshot is recorded. Idempotent: running it twice changes nothing.
 */
export function catchUp(data: VaultData, asOf: ISODate = today()): { data: VaultData; report: CatchUpReport; changed: boolean } {
  const report: CatchUpReport = { emisApplied: 0, loansClosed: [], sipInstallments: 0, estimatedSips: 0, pendingSips: [], snapshotTaken: false };

  const loans: Loan[] = [];
  const loanEvents: LoanEvent[] = [];
  for (const loan of live(data.loans)) {
    const res = catchUpLoan(loan, asOf);
    if (res.events.length === 0) continue;
    loans.push(res.loan);
    loanEvents.push(...res.events);
    report.emisApplied += res.events.length;
    if (res.loan.closedAt && !loan.closedAt) report.loansClosed.push(loan.name);
  }

  const holdings = new Map(live(data.holdings).map(h => [h.id, h]));
  const sips: Sip[] = [];
  const txns: Txn[] = [];
  for (const sip of live(data.sips)) {
    const res = catchUpSip(sip, sip.holdingId ? holdings.get(sip.holdingId) : undefined, data.txns, asOf);
    if (res.sip !== sip) sips.push(res.sip);
    txns.push(...res.txns);
    report.sipInstallments += res.txns.length;
    report.estimatedSips += res.txns.filter(t => t.estimated).length;
    if (res.pending.length) report.pendingSips.push({ sip, dates: res.pending });
  }

  let next: VaultData = data;
  if (loans.length || loanEvents.length || sips.length || txns.length) {
    next = {
      ...data,
      loans: upsertMany(data.loans, loans),
      loanEvents: upsertMany(data.loanEvents, loanEvents),
      sips: upsertMany(data.sips, sips),
      txns: upsertMany(data.txns, txns),
    };
  }

  const hasSnapshot = data.snapshots.some(s => s.date === asOf && !s.deletedAt);
  const hasData = live(next.holdings).length > 0 || live(next.loans).length > 0;
  if (hasData && (!hasSnapshot || next !== data)) {
    next = { ...next, snapshots: upsertMany(next.snapshots, [snapshotFor(next, asOf, computePositions(next, asOf))]) };
    report.snapshotTaken = true;
  }

  const changed = next !== data || data.meta.lastCatchUpDate !== asOf;
  if (changed) next = { ...next, meta: { ...next.meta, lastCatchUpDate: asOf } };
  return { data: next, report, changed };
}
