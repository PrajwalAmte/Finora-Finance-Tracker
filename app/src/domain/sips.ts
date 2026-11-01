import { D, dec, price, units } from './money';
import { addDays, monthlyOccurrences, today, type ISODate } from './dates';
import { create, live } from './records';
import type { Holding, Sip, Txn } from './types';

/** Installment dates after the last recorded one, up to `asOf`. */
export function dueInstallments(sip: Sip, asOf: ISODate = today()): ISODate[] {
  if (sip.status !== 'ACTIVE') return [];
  const until = sip.endDate && sip.endDate < asOf ? sip.endDate : asOf;
  const after = sip.lastInstallment ?? addDays(sip.startDate, -1);
  return monthlyOccurrences(sip.dayOfMonth, after, until, sip.startDate);
}

export function nextInstallment(sip: Sip, after: ISODate = today()): ISODate | undefined {
  if (sip.status !== 'ACTIVE') return undefined;
  const from = sip.lastInstallment && sip.lastInstallment > after ? sip.lastInstallment : after;
  const [next] = monthlyOccurrences(sip.dayOfMonth, from, '9999-12-31', sip.startDate).slice(0, 1);
  if (!next || (sip.endDate && next > sip.endDate)) return undefined;
  return next;
}

/** Deterministic id so two devices recording the same installment do not double it after a merge. */
export function installmentTxnId(sip: Sip, date: ISODate): string {
  return `sip-${sip.id}-${date}`;
}

export function installmentTxn(sip: Sip, holding: Holding, date: ISODate, nav = holding.currentPrice): Txn | null {
  if (!nav || D(nav).lte(0)) return null;
  const amount = D(sip.amount);
  return create<Txn>({
    id: installmentTxnId(sip, date),
    holdingId: holding.id, sipId: sip.id, date, kind: 'BUY',
    units: units(amount.div(D(nav))), price: price(nav), amount: dec(amount),
    estimated: true, source: 'SIP_AUTO',
  });
}

export interface SipCatchUp {
  sip: Sip;
  txns: Txn[];
  /** Installments that fell due but could not be recorded (no linked fund or no NAV yet). */
  pending: ISODate[];
}

export function catchUpSip(sip: Sip, holding: Holding | undefined, existing: Txn[], asOf: ISODate = today()): SipCatchUp {
  const due = dueInstallments(sip, asOf);
  if (due.length === 0) return { sip, txns: [], pending: [] };
  if (!sip.autoRecord || !holding) return { sip, txns: [], pending: due };

  const taken = new Set(live(existing).filter(t => t.sipId === sip.id).map(t => t.date));
  const txns: Txn[] = [];
  const pending: ISODate[] = [];
  let last = sip.lastInstallment;
  for (const date of due) {
    if (taken.has(date)) {
      last = date;
      continue;
    }
    const txn = installmentTxn(sip, holding, date);
    if (!txn) {
      pending.push(date);
      continue;
    }
    txns.push(txn);
    last = date;
  }
  return { sip: last !== sip.lastInstallment ? { ...sip, lastInstallment: last } : sip, txns, pending };
}

export function sipInvested(sip: Sip, txns: Txn[]): number {
  return live(txns).filter(t => t.sipId === sip.id && t.kind === 'BUY').reduce((s, t) => s + D(t.amount).toNumber(), 0);
}

export function sipInstallmentCount(sip: Sip, txns: Txn[]): number {
  return live(txns).filter(t => t.sipId === sip.id && t.kind === 'BUY').length;
}
