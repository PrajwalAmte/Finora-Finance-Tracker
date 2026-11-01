import { D, Decimal, ZERO, dec, type DecInput } from './money';
import { addDays, addMonths, monthlyOccurrences, monthsBetween, today, type ISODate } from './dates';
import { create } from './records';
import type { Compounding, InterestType, Loan, LoanEvent } from './types';

/**
 * Monthly rate as a fraction.
 *
 * SIMPLE and MONTHLY compounding both charge annualRate/12 on the outstanding balance each month.
 * QUARTERLY and YEARLY convert the periodic rate to its monthly equivalent, (1 + r/n)^(n/12) − 1,
 * so that a year of monthly charges equals the bank's stated compounding. (The old server divided
 * the quarterly rate by nothing, charging about 3× the interest, and treated yearly as simple.)
 */
export function monthlyRate(annualRatePct: DecInput, interestType: InterestType, compounding: Compounding): Decimal {
  const annual = D(annualRatePct).div(100);
  if (interestType === 'SIMPLE' || compounding === 'MONTHLY') return annual.div(12);
  if (compounding === 'QUARTERLY') return annual.div(4).plus(1).pow(new Decimal(4).div(12)).minus(1);
  return annual.plus(1).pow(new Decimal(1).div(12)).minus(1);
}

export function loanRate(loan: Pick<Loan, 'annualRate' | 'interestType' | 'compounding'>): Decimal {
  return monthlyRate(loan.annualRate, loan.interestType, loan.compounding);
}

/** Standard reducing-balance EMI. */
export function emiFor(principal: DecInput, monthly: Decimal, months: number): Decimal {
  const p = D(principal);
  if (months <= 0) return p;
  if (monthly.isZero()) return p.div(months).toDecimalPlaces(2);
  const f = monthly.plus(1).pow(months);
  return p.times(monthly).times(f).div(f.minus(1)).toDecimalPlaces(2);
}

export interface ScheduleRow {
  month: number;
  date: ISODate;
  emi: Decimal;
  interest: Decimal;
  principal: Decimal;
  balance: Decimal;
}

/** Amortization from a starting balance until it reaches zero (capped at 100 years). */
export function schedule(balance: DecInput, monthly: Decimal, emi: DecInput, firstDate: ISODate, maxMonths = 1200): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  let bal = D(balance);
  const pay = D(emi);
  for (let m = 1; m <= maxMonths && bal.gt(0.005); m++) {
    const interest = bal.times(monthly).toDecimalPlaces(2);
    if (pay.lte(interest)) break; // EMI does not cover interest: loan never closes.
    let principal = pay.minus(interest);
    let thisEmi = pay;
    // EMI and monthly interest are rounded to paise; the final EMI absorbs the few rupees of
    // residue that builds up over a long tenure, as banks do.
    if (principal.gte(bal.minus(Decimal.max(1, pay.times(0.001))))) {
      principal = bal;
      thisEmi = bal.plus(interest);
    }
    bal = bal.minus(principal);
    rows.push({ month: m, date: addMonths(firstDate, m - 1), emi: thisEmi, interest, principal, balance: bal });
  }
  return rows;
}

export function totals(rows: ScheduleRow[]): { interest: Decimal; paid: Decimal; months: number } {
  return {
    interest: rows.reduce((s, r) => s.plus(r.interest), ZERO),
    paid: rows.reduce((s, r) => s.plus(r.emi), ZERO),
    months: rows.length,
  };
}

/** True while the bank has not started collecting EMIs yet. */
export function inMoratorium(loan: Loan, on: ISODate = today()): boolean {
  return !!loan.firstEmiDate && on < loan.firstEmiDate;
}

/** Balance after interest builds up from `balanceAsOf` to `to` (no EMIs paid in between). */
export function accrueBalance(loan: Loan, to: ISODate): Decimal {
  const bal = D(loan.balance);
  const months = monthsBetween(loan.balanceAsOf, to);
  if (months <= 0) return bal;
  const rate = loanRate(loan);
  if (loan.interestType === 'SIMPLE') return bal.plus(bal.times(D(loan.annualRate).div(1200)).times(months)).toDecimalPlaces(2);
  return bal.times(rate.plus(1).pow(months)).toDecimalPlaces(2);
}

/** Next EMI date strictly after `after`, never before the first EMI of a loan in moratorium. */
export function nextEmiDate(loan: Loan, after: ISODate = today()): ISODate {
  const from = loan.firstEmiDate && loan.firstEmiDate > after ? addDays(loan.firstEmiDate, -1) : after;
  return monthlyOccurrences(loan.emiDay, from, addMonths(from, 2), loan.firstEmiDate)[0];
}

/**
 * The loan as it will stand when repayment begins: interest accrued up to the first EMI.
 * Loans that are already repaying come back unchanged.
 */
export function atRepaymentStart(loan: Loan): Loan {
  if (!loan.firstEmiDate || loan.balanceAsOf >= loan.firstEmiDate) return loan;
  const asOf = addDays(loan.firstEmiDate, -1);
  return { ...loan, balance: dec(accrueBalance(loan, asOf)), balanceAsOf: asOf };
}

export function remainingSchedule(loan: Loan, from: ISODate = loan.balanceAsOf): ScheduleRow[] {
  const l = atRepaymentStart(loan);
  return schedule(l.balance, loanRate(l), l.emi, nextEmiDate(l, from > l.balanceAsOf ? from : l.balanceAsOf));
}

/**
 * Apply every EMI that fell due after `balanceAsOf` up to `asOf`. EMI events get deterministic ids,
 * so two devices catching up the same loan produce the same records and merge cleanly.
 */
export function catchUpLoan(loan: Loan, asOf: ISODate = today()): { loan: Loan; events: LoanEvent[] } {
  if (loan.closedAt || D(loan.balance).lte(0)) return { loan, events: [] };
  // Repayment has not started: nothing falls due and the stored balance is left alone.
  if (inMoratorium(loan, asOf)) return { loan, events: [] };
  // Repayment starts now: interest that built up during the moratorium joins the balance first.
  if (loan.firstEmiDate && loan.balanceAsOf < loan.firstEmiDate) loan = atRepaymentStart(loan);
  const dates = monthlyOccurrences(loan.emiDay, loan.balanceAsOf, asOf, loan.firstEmiDate);
  if (dates.length === 0) return { loan, events: [] };

  const rate = loanRate(loan);
  const pay = D(loan.emi);
  let bal = D(loan.balance);
  const events: LoanEvent[] = [];
  let closedAt: ISODate | undefined;

  for (const date of dates) {
    const interest = bal.times(rate).toDecimalPlaces(2);
    let principal = pay.minus(interest);
    if (principal.lte(0)) principal = ZERO;
    if (principal.gt(bal)) principal = bal;
    bal = bal.minus(principal);
    events.push(create<LoanEvent>({
      id: `emi-${loan.id}-${date}`,
      loanId: loan.id, date, kind: 'EMI', auto: true,
      amount: dec(principal.plus(interest)), interest: dec(interest), principal: dec(principal), balanceAfter: dec(bal),
    }));
    if (bal.lte(0.005)) {
      closedAt = date;
      break;
    }
  }

  return {
    loan: { ...loan, balance: dec(bal), balanceAsOf: events[events.length - 1].date, closedAt: closedAt ?? loan.closedAt },
    events,
  };
}

export type PrepayMode = 'REDUCE_TENURE' | 'REDUCE_EMI';

/** Apply a part-prepayment to the loan, recalculating EMI when asked. */
export function applyPrepayment(loan: Loan, amount: DecInput, date: ISODate, mode: PrepayMode): { loan: Loan; event: LoanEvent } {
  let caughtUp = catchUpLoan(loan, date).loan;
  // During a moratorium interest keeps building, so the payment comes off the grown balance.
  if (inMoratorium(caughtUp, date)) caughtUp = { ...caughtUp, balance: dec(accrueBalance(caughtUp, date)), balanceAsOf: date };
  const pay = Decimal.min(D(amount), D(caughtUp.balance));
  const bal = D(caughtUp.balance).minus(pay);
  let emi = D(caughtUp.emi);
  if (mode === 'REDUCE_EMI' && bal.gt(0)) {
    const remaining = remainingSchedule(caughtUp, date).length;
    emi = emiFor(bal, loanRate(caughtUp), Math.max(1, remaining));
  }
  const event = create<LoanEvent>({ loanId: loan.id, date, kind: 'PREPAYMENT', amount: dec(pay), principal: dec(pay), balanceAfter: dec(bal) });
  return {
    loan: { ...caughtUp, balance: dec(bal), balanceAsOf: date, emi: dec(emi), closedAt: bal.lte(0) ? date : caughtUp.closedAt },
    event,
  };
}

export interface PrepayComparison {
  baseline: { months: number; interest: Decimal; endDate?: ISODate };
  prepay: { months: number; interest: Decimal; endDate?: ISODate; emi: Decimal };
  interestSaved: Decimal;
  monthsSaved: number;
  /** Wealth at the original loan end if you prepay, then invest the freed-up EMIs (or EMI savings). */
  prepayWealth: Decimal;
  /** Wealth at the original loan end if you invest the lump sum instead. */
  investWealth: Decimal;
  /** Annual return (before the tax setting) at which investing and prepaying come out equal, in percent. */
  breakEvenReturnPct: number | null;
  better: 'PREPAY' | 'INVEST' | 'EQUAL';
}

/**
 * "Should I prepay ₹X or invest it?" Both sides are measured at the original loan end date.
 * Returns are treated as post-tax: `taxOnGainsPct` is taken off investment gains at the end.
 */
export function comparePrepayVsInvest(
  loan: Loan,
  amount: DecInput,
  opts: { mode: PrepayMode; expectedReturnPct: DecInput; taxOnGainsPct?: DecInput; asOf?: ISODate },
): PrepayComparison {
  const asOf = opts.asOf ?? today();
  const current = atRepaymentStart(catchUpLoan(loan, asOf).loan);
  const rate = loanRate(current);
  const first = nextEmiDate(current, asOf);
  const lump = Decimal.min(D(amount), D(current.balance));

  const base = schedule(current.balance, rate, current.emi, first);
  const baseT = totals(base);
  const afterBal = D(current.balance).minus(lump);
  const newEmi = opts.mode === 'REDUCE_EMI' && afterBal.gt(0) ? emiFor(afterBal, rate, Math.max(1, base.length)) : D(current.emi);
  const pre = afterBal.gt(0) ? schedule(afterBal, rate, newEmi, first) : [];
  const preT = totals(pre);
  const horizon = base.length;
  const taxPct = D(opts.taxOnGainsPct ?? 0).div(100);

  // Projection math runs in floats: it is an estimate, and the break-even search evaluates it ~120
  // times per keystroke. Loan schedules above stay in Decimal.
  const savings = base.map((row, m) => Math.max(0, row.emi.minus(pre[m]?.emi ?? ZERO).toNumber()));
  const contributed = savings.reduce((s, v) => s + v, 0);
  const lumpN = lump.toNumber();
  const taxN = taxPct.toNumber();
  const wealthAt = (annualPct: number) => {
    const g = 1 + annualPct / 100 / 12;
    // Prepay side: every month the prepaid loan costs less than the baseline, invest the difference.
    let prepay = 0;
    for (let m = 0; m < horizon; m++) if (savings[m] > 0) prepay += savings[m] * Math.pow(g, horizon - m - 1);
    const invest = lumpN * Math.pow(g, horizon);
    return {
      prepayNet: prepay - Math.max(prepay - contributed, 0) * taxN,
      investNet: invest - Math.max(invest - lumpN, 0) * taxN,
    };
  };

  const at = wealthAt(D(opts.expectedReturnPct).toNumber());

  // Bisection on the return where both strategies give the same wealth.
  let breakEven: number | null = null;
  const diff = (pct: number) => {
    const w = wealthAt(pct);
    return w.investNet - w.prepayNet;
  };
  let lo = 0;
  let hi = 40;
  if (lump.gt(0) && horizon > 0 && diff(lo) * diff(hi) < 0) {
    let dlo = diff(lo);
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      const dm = diff(mid);
      if (dlo * dm <= 0) hi = mid; else { lo = mid; dlo = dm; }
    }
    breakEven = Math.round(((lo + hi) / 2) * 100) / 100;
  }

  const delta = at.investNet - at.prepayNet;
  return {
    baseline: { months: baseT.months, interest: baseT.interest, endDate: base[base.length - 1]?.date },
    prepay: { months: preT.months, interest: preT.interest, endDate: pre[pre.length - 1]?.date, emi: newEmi },
    interestSaved: baseT.interest.minus(preT.interest),
    monthsSaved: baseT.months - preT.months,
    prepayWealth: new Decimal(at.prepayNet).toDecimalPlaces(0),
    investWealth: new Decimal(at.investNet).toDecimalPlaces(0),
    breakEvenReturnPct: breakEven,
    better: Math.abs(delta) < 1 ? 'EQUAL' : delta > 0 ? 'INVEST' : 'PREPAY',
  };
}

/** Build a new loan record from what the user knows: principal, rate, tenure, optionally a known EMI. */
export function newLoanFields(input: {
  principal: DecInput; annualRate: DecInput; tenureMonths: number; startDate: ISODate;
  interestType: InterestType; compounding: Compounding; emi?: DecInput; emiDay?: number; firstEmiDate?: ISODate;
}): Pick<Loan, 'firstEmiDate' | 'principal' | 'annualRate' | 'tenureMonths' | 'startDate' | 'interestType' | 'compounding' | 'emi' | 'emiDay' | 'balance' | 'balanceAsOf'> {
  const rate = monthlyRate(input.annualRate, input.interestType, input.compounding);
  const emi = input.emi && D(input.emi).gt(0) ? D(input.emi) : emiFor(input.principal, rate, input.tenureMonths);
  return {
    principal: dec(input.principal),
    annualRate: dec(input.annualRate, 4),
    tenureMonths: input.tenureMonths,
    startDate: input.startDate,
    interestType: input.interestType,
    compounding: input.compounding,
    emi: dec(emi),
    emiDay: input.emiDay ?? Number((input.firstEmiDate ?? input.startDate).slice(8, 10)),
    firstEmiDate: input.firstEmiDate,
    balance: dec(input.principal),
    balanceAsOf: input.startDate,
  };
}
