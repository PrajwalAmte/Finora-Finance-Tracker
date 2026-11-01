import { daysBetween, type ISODate } from './dates';

export interface CashFlow {
  date: ISODate;
  /** Negative = money going in (purchase), positive = money coming out (sale, dividend, current value). */
  amount: number;
}

/**
 * Annualised internal rate of return for irregular cash flows, as a fraction (0.12 = 12%).
 * Returns null when it is undefined (no sign change) or does not converge.
 */
export function xirr(flows: CashFlow[]): number | null {
  const r = solve(flows);
  // Solver noise around zero would otherwise show as "−0.0%".
  return r !== null && Math.abs(r) < 1e-6 ? 0 : r;
}

function solve(flows: CashFlow[]): number | null {
  const cf = flows.filter(f => Number.isFinite(f.amount) && f.amount !== 0);
  if (cf.length < 2) return null;
  if (!cf.some(f => f.amount < 0) || !cf.some(f => f.amount > 0)) return null;

  const start = cf.reduce((min, f) => (f.date < min ? f.date : min), cf[0].date);
  const t = cf.map(f => daysBetween(start, f.date) / 365);
  if (t.every(x => x === 0)) return null;

  const npv = (r: number) => cf.reduce((s, f, i) => s + f.amount / Math.pow(1 + r, t[i]), 0);
  const dnpv = (r: number) => cf.reduce((s, f, i) => s - (t[i] * f.amount) / Math.pow(1 + r, t[i] + 1), 0);

  // Newton first; fall back to bisection when it wanders out of (-1, ∞) or stalls.
  let r = 0.1;
  for (let i = 0; i < 50; i++) {
    const f = npv(r);
    const d = dnpv(r);
    if (Math.abs(f) < 1e-7) return r;
    if (!Number.isFinite(d) || d === 0) break;
    const next = r - f / d;
    if (!Number.isFinite(next) || next <= -0.9999) break;
    if (Math.abs(next - r) < 1e-10) return next;
    r = next;
  }

  let lo = -0.9999;
  let hi = 10;
  let flo = npv(lo);
  const fhi = npv(hi);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7 || hi - lo < 1e-10) return mid;
    if (flo * fm < 0) {
      hi = mid;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  return null;
}
