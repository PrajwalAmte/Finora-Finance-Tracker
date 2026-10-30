import { D, Decimal, ZERO, type DecInput } from '../money';
import { addMonths, financialYear, financialYearRange, today, type ISODate } from '../dates';
import type { Position, RealizedLot } from '../portfolio';
import type { Holding, TaxClass } from '../types';
import { CESS_PCT, DEBT_SLAB_FROM, GRANDFATHER_BEFORE, classRule, exemptionFor, ruleFor } from './rules';

export type Term = 'SHORT' | 'LONG';

export interface GainRow {
  holding: Holding;
  buyDate: ISODate;
  sellDate: ISODate;
  units: Decimal;
  proceeds: Decimal;
  /** Actual cost of the units sold. */
  actualCost: Decimal;
  /** Cost used for tax: actual cost, or the grandfathered cost for pre-2018 equity. */
  taxCost: Decimal;
  gain: Decimal;
  term: Term;
  rate: number | 'SLAB';
  grandfathered: boolean;
  /** Fair market value per unit on 31 Jan 2018, when grandfathering applied. */
  fmv2018?: Decimal;
  /** Equity long-term gains reported in Schedule 112A. */
  section112A: boolean;
}

export function isLongTerm(taxClass: TaxClass, buyDate: ISODate, sellDate: ISODate): boolean {
  if (taxClass === 'DEBT' && buyDate >= DEBT_SLAB_FROM) return false;
  const months = classRule(ruleFor(sellDate), taxClass).longTermMonths;
  return addMonths(buyDate, months) < sellDate;
}

export function rateFor(taxClass: TaxClass, buyDate: ISODate, sellDate: ISODate, term: Term): number | 'SLAB' {
  if (taxClass === 'DEBT' && buyDate >= DEBT_SLAB_FROM) return 'SLAB';
  const rule = classRule(ruleFor(sellDate), taxClass);
  return term === 'LONG' ? rule.longRate : rule.shortRate;
}

/** Cost of acquisition under s.55(2)(ac): higher of actual cost and min(FMV on 31 Jan 2018, sale value). */
export function grandfatheredCost(actualCost: Decimal, units: Decimal, fmvPerUnit: DecInput, saleValue: Decimal): Decimal {
  const fmv = D(fmvPerUnit).times(units);
  return Decimal.max(actualCost, Decimal.min(fmv, saleValue));
}

export function gainRow(holding: Holding, lot: RealizedLot): GainRow {
  const term: Term = isLongTerm(holding.taxClass, lot.buyDate, lot.sellDate) ? 'LONG' : 'SHORT';
  const canGrandfather = holding.taxClass === 'EQUITY' && term === 'LONG' && lot.buyDate < GRANDFATHER_BEFORE && !!holding.fmv2018;
  const taxCost = canGrandfather ? grandfatheredCost(lot.cost, lot.units, holding.fmv2018, lot.proceeds) : lot.cost;
  return {
    holding,
    buyDate: lot.buyDate,
    sellDate: lot.sellDate,
    units: lot.units,
    proceeds: lot.proceeds,
    actualCost: lot.cost,
    taxCost,
    gain: lot.proceeds.minus(taxCost),
    term,
    rate: rateFor(holding.taxClass, lot.buyDate, lot.sellDate, term),
    grandfathered: canGrandfather,
    fmv2018: canGrandfather ? D(holding.fmv2018) : undefined,
    section112A: holding.taxClass === 'EQUITY' && term === 'LONG',
  };
}

export function gainRows(positions: Position[], fy: string): GainRow[] {
  const { start, end } = financialYearRange(fy);
  const rows: GainRow[] = [];
  for (const p of positions) {
    for (const lot of p.realizedLots) {
      if (lot.sellDate >= start && lot.sellDate <= end) rows.push(gainRow(p.holding, lot));
    }
  }
  return rows.sort((a, b) => a.sellDate.localeCompare(b.sellDate));
}

export interface Bucket {
  term: Term;
  rate: number | 'SLAB';
  section112A: boolean;
  gross: Decimal;
  /** After set-off of losses and the 112A exemption. */
  taxable: Decimal;
  tax: Decimal;
}

export interface TaxReport {
  fy: string;
  rows: GainRow[];
  buckets: Bucket[];
  shortTermGain: Decimal;
  longTermGain: Decimal;
  exemption: number;
  exemptionUsed: Decimal;
  exemptionLeft: Decimal;
  /** Losses that could not be set off this year (can be carried forward 8 years if the return is filed on time). */
  carryForwardShort: Decimal;
  carryForwardLong: Decimal;
  taxBeforeCess: Decimal;
  cess: Decimal;
  totalTax: Decimal;
}

function effectiveRate(rate: number | 'SLAB', slabRatePct: DecInput): Decimal {
  return rate === 'SLAB' ? D(slabRatePct) : new Decimal(rate);
}

/**
 * Estimate the year's capital-gains tax.
 * Set-off order: short-term losses against short-term then long-term gains; long-term losses against
 * long-term gains only. Losses go to the highest-rate gains first, and the 112A exemption goes to
 * the highest-rate equity long-term gains, which is the most favourable legal order.
 */
export function taxReport(positions: Position[], fy: string, slabRatePct: DecInput): TaxReport {
  const rows = gainRows(positions, fy);
  const map = new Map<string, Bucket>();
  let stLoss = ZERO;
  let ltLoss = ZERO;
  for (const r of rows) {
    if (r.gain.lt(0)) {
      if (r.term === 'SHORT') stLoss = stLoss.plus(r.gain.neg()); else ltLoss = ltLoss.plus(r.gain.neg());
      continue;
    }
    const key = `${r.term}|${r.rate}|${r.section112A}`;
    const b = map.get(key) ?? { term: r.term, rate: r.rate, section112A: r.section112A, gross: ZERO, taxable: ZERO, tax: ZERO };
    b.gross = b.gross.plus(r.gain);
    map.set(key, b);
  }
  const buckets = [...map.values()];
  for (const b of buckets) b.taxable = b.gross;
  const byRateDesc = (list: Bucket[]) => list.sort((a, b) => effectiveRate(b.rate, slabRatePct).cmp(effectiveRate(a.rate, slabRatePct)));

  const absorb = (loss: Decimal, targets: Bucket[]): Decimal => {
    let left = loss;
    for (const b of byRateDesc(targets)) {
      if (left.lte(0)) break;
      const used = Decimal.min(left, b.taxable);
      b.taxable = b.taxable.minus(used);
      left = left.minus(used);
    }
    return left;
  };

  ltLoss = absorb(ltLoss, buckets.filter(b => b.term === 'LONG'));
  stLoss = absorb(stLoss, buckets.filter(b => b.term === 'SHORT'));
  stLoss = absorb(stLoss, buckets.filter(b => b.term === 'LONG'));

  const exemption = exemptionFor(fy);
  let exemptLeft = new Decimal(exemption);
  for (const b of byRateDesc(buckets.filter(x => x.section112A))) {
    const used = Decimal.min(exemptLeft, b.taxable);
    b.taxable = b.taxable.minus(used);
    exemptLeft = exemptLeft.minus(used);
  }

  let taxBeforeCess = ZERO;
  for (const b of buckets) {
    b.tax = b.taxable.times(effectiveRate(b.rate, slabRatePct)).div(100).toDecimalPlaces(0);
    taxBeforeCess = taxBeforeCess.plus(b.tax);
  }
  const cess = taxBeforeCess.times(CESS_PCT).div(100).toDecimalPlaces(0);

  return {
    fy,
    rows,
    buckets,
    shortTermGain: rows.filter(r => r.term === 'SHORT').reduce((s, r) => s.plus(r.gain), ZERO),
    longTermGain: rows.filter(r => r.term === 'LONG').reduce((s, r) => s.plus(r.gain), ZERO),
    exemption,
    exemptionUsed: new Decimal(exemption).minus(exemptLeft),
    exemptionLeft: exemptLeft,
    carryForwardShort: stLoss,
    carryForwardLong: ltLoss,
    taxBeforeCess,
    cess,
    totalTax: taxBeforeCess.plus(cess),
  };
}

export interface HarvestSuggestion {
  position: Position;
  units: Decimal;
  saleValue: Decimal;
  gain: Decimal;
  /** Tax avoided later at the long-term rate, because the cost basis resets when you buy back. */
  taxSaved: Decimal;
}

export interface LossCandidate {
  position: Position;
  units: Decimal;
  loss: Decimal;
  term: Term;
}

/**
 * Tax-gain harvesting: sell (and buy back) long-term equity units whose gains fit inside this year's
 * unused 112A exemption. Units are taken in FIFO order because that is how the sale will be matched;
 * the walk stops at the first short-term lot.
 */
export function harvestSuggestions(positions: Position[], exemptionLeft: Decimal, asOf: ISODate = today()): HarvestSuggestion[] {
  const ltRate = classRule(ruleFor(asOf), 'EQUITY').longRate;
  const candidates: { position: Position; lots: { units: Decimal; gainPerUnit: Decimal }[]; gain: Decimal; units: Decimal }[] = [];

  for (const p of positions) {
    if (p.holding.taxClass !== 'EQUITY' || p.units.lte(0) || p.price.lte(0)) continue;
    const lots: { units: Decimal; gainPerUnit: Decimal }[] = [];
    for (const lot of p.lots) {
      if (!isLongTerm('EQUITY', lot.date, asOf)) break;
      let cpu = lot.costPerUnit;
      if (lot.date < GRANDFATHER_BEFORE && p.holding.fmv2018) {
        cpu = Decimal.max(cpu, Decimal.min(D(p.holding.fmv2018), p.price));
      }
      lots.push({ units: lot.units, gainPerUnit: p.price.minus(cpu) });
    }
    const gain = lots.reduce((s, l) => s.plus(l.gainPerUnit.times(l.units)), ZERO);
    const units = lots.reduce((s, l) => s.plus(l.units), ZERO);
    if (units.gt(0) && gain.gt(0)) candidates.push({ position: p, lots, gain, units });
  }

  // Highest gain per rupee sold first: books the exemption with the least selling.
  candidates.sort((a, b) => b.gain.div(b.units.times(b.position.price)).cmp(a.gain.div(a.units.times(a.position.price))));

  const out: HarvestSuggestion[] = [];
  let left = exemptionLeft;
  for (const c of candidates) {
    if (left.lte(1)) break;
    let units = ZERO;
    let gain = ZERO;
    for (const lot of c.lots) {
      const lotGain = lot.gainPerUnit.times(lot.units);
      if (gain.plus(lotGain).lte(left)) {
        units = units.plus(lot.units);
        gain = gain.plus(lotGain);
        continue;
      }
      const part = left.minus(gain).div(lot.gainPerUnit).toDecimalPlaces(3, Decimal.ROUND_DOWN);
      units = units.plus(part);
      gain = gain.plus(part.times(lot.gainPerUnit));
      break;
    }
    if (units.lte(0) || gain.lte(0)) continue;
    out.push({
      position: c.position,
      units,
      saleValue: units.times(c.position.price),
      gain,
      taxSaved: typeof ltRate === 'number' ? gain.times(ltRate).div(100).toDecimalPlaces(0) : ZERO,
    });
    left = left.minus(gain);
  }
  return out;
}

/** Holdings sitting on losses that could be booked to offset this year's gains. */
export function lossCandidates(positions: Position[], asOf: ISODate = today()): LossCandidate[] {
  const out: LossCandidate[] = [];
  for (const p of positions) {
    if (p.units.lte(0) || p.price.lte(0)) continue;
    for (const term of ['SHORT', 'LONG'] as Term[]) {
      let units = ZERO;
      let loss = ZERO;
      for (const lot of p.lots) {
        const lt = isLongTerm(p.holding.taxClass, lot.date, asOf);
        if ((term === 'LONG') !== lt) continue;
        const pl = p.price.minus(lot.costPerUnit).times(lot.units);
        if (pl.lt(0)) {
          units = units.plus(lot.units);
          loss = loss.plus(pl.neg());
        }
      }
      if (loss.gt(100)) out.push({ position: p, units, loss, term });
    }
  }
  return out.sort((a, b) => b.loss.cmp(a.loss));
}

export function currentFy(): string {
  return financialYear(today());
}
