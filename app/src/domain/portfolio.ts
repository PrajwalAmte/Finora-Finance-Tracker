import { D, Decimal, ZERO, type DecInput } from './money';
import { daysBetween, today, type ISODate } from './dates';
import { live } from './records';
import { xirr, type CashFlow } from './xirr';
import type { AssetType, Holding, Txn, VaultData } from './types';

export interface Lot {
  txnId: string;
  date: ISODate;
  units: Decimal;
  /** Cost per unit including purchase charges. */
  costPerUnit: Decimal;
}

/** One FIFO match between a sale and the lot it consumed. */
export interface RealizedLot {
  holdingId: string;
  sellTxnId: string;
  sellDate: ISODate;
  buyDate: ISODate;
  units: Decimal;
  cost: Decimal;
  /** Sale value net of sale charges, apportioned to this lot. */
  proceeds: Decimal;
  salePricePerUnit: Decimal;
  gain: Decimal;
}

export interface Position {
  holding: Holding;
  units: Decimal;
  /** Cost of the units still held. */
  invested: Decimal;
  avgCost: Decimal;
  price: Decimal;
  value: Decimal;
  unrealized: Decimal;
  unrealizedPct: number;
  realized: Decimal;
  dividends: Decimal;
  lots: Lot[];
  realizedLots: RealizedLot[];
  xirr: number | null;
  firstBuy?: ISODate;
  /** A sale exceeded the units held; usually means missing buy history. */
  oversold: boolean;
  hasEstimated: boolean;
}

const KIND_ORDER: Record<Txn['kind'], number> = { BUY: 0, DIVIDEND: 1, SELL: 2 };

export function sortTxns(txns: Txn[]): Txn[] {
  return txns.slice().sort((a, b) =>
    a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.createdAt.localeCompare(b.createdAt));
}

export function computePosition(holding: Holding, txns: Txn[], asOf: ISODate = today()): Position {
  const sorted = sortTxns(live(txns).filter(t => t.holdingId === holding.id && t.date <= asOf));
  const lots: Lot[] = [];
  const realizedLots: RealizedLot[] = [];
  let dividends = ZERO;
  let oversold = false;
  const flows: CashFlow[] = [];
  let lastPrice: Decimal | null = null;
  let lastPriceDate = '';

  for (const t of sorted) {
    const u = D(t.units);
    const charges = D(t.charges);
    if (t.kind === 'BUY') {
      if (u.lte(0)) continue;
      const cost = D(t.amount).plus(charges);
      lots.push({ txnId: t.id, date: t.date, units: u, costPerUnit: cost.div(u) });
      flows.push({ date: t.date, amount: -cost.toNumber() });
      lastPrice = D(t.price);
      lastPriceDate = t.date;
    } else if (t.kind === 'SELL') {
      if (u.lte(0)) continue;
      const net = D(t.amount).minus(charges);
      const perUnit = net.div(u);
      flows.push({ date: t.date, amount: net.toNumber() });
      let remaining = u;
      while (remaining.gt(0) && lots.length > 0) {
        const lot = lots[0];
        const take = Decimal.min(lot.units, remaining);
        const cost = take.times(lot.costPerUnit);
        const proceeds = take.times(perUnit);
        realizedLots.push({
          holdingId: holding.id, sellTxnId: t.id, sellDate: t.date, buyDate: lot.date,
          units: take, cost, proceeds, salePricePerUnit: perUnit, gain: proceeds.minus(cost),
        });
        lot.units = lot.units.minus(take);
        remaining = remaining.minus(take);
        if (lot.units.lte(0)) lots.shift();
      }
      if (remaining.gt(1e-9)) oversold = true;
      lastPrice = D(t.price);
      lastPriceDate = t.date;
    } else {
      dividends = dividends.plus(D(t.amount));
      flows.push({ date: t.date, amount: D(t.amount).toNumber() });
    }
  }

  const unitsHeld = lots.reduce((s, l) => s.plus(l.units), ZERO);
  const invested = lots.reduce((s, l) => s.plus(l.units.times(l.costPerUnit)), ZERO);
  // The most recent known price wins: a refreshed quote, or a buy/sell price from clearly later.
  // A quote is dated by the last market close, so a trade entered a day or two after it (a weekend,
  // or tonight's entry against today's close) does not override it.
  const quoteIsNewer = holding.currentPrice && (!lastPrice || !holding.priceDate || daysBetween(holding.priceDate, lastPriceDate) <= 4);
  const price = quoteIsNewer ? D(holding.currentPrice) : lastPrice ?? (holding.currentPrice ? D(holding.currentPrice) : ZERO);
  const value = unitsHeld.times(price);
  const unrealized = value.minus(invested);
  const realized = realizedLots.reduce((s, r) => s.plus(r.gain), ZERO);
  if (value.gt(0)) flows.push({ date: asOf, amount: value.toNumber() });

  return {
    holding,
    units: unitsHeld,
    invested,
    avgCost: unitsHeld.gt(0) ? invested.div(unitsHeld) : ZERO,
    price,
    value,
    unrealized,
    unrealizedPct: invested.gt(0) ? unrealized.div(invested).times(100).toNumber() : 0,
    realized,
    dividends,
    lots,
    realizedLots,
    xirr: xirr(flows),
    firstBuy: sorted.find(t => t.kind === 'BUY')?.date,
    oversold,
    hasEstimated: sorted.some(t => t.estimated),
  };
}

export function computePositions(data: Pick<VaultData, 'holdings' | 'txns'>, asOf: ISODate = today()): Position[] {
  const byHolding = new Map<string, Txn[]>();
  for (const t of live(data.txns)) {
    const list = byHolding.get(t.holdingId);
    if (list) list.push(t); else byHolding.set(t.holdingId, [t]);
  }
  return live(data.holdings).map(h => computePosition(h, byHolding.get(h.id) ?? [], asOf));
}

export interface PortfolioSummary {
  value: Decimal;
  invested: Decimal;
  unrealized: Decimal;
  unrealizedPct: number;
  realized: Decimal;
  dividends: Decimal;
  xirr: number | null;
  byType: Record<AssetType, Decimal>;
  count: number;
}

export function summarize(positions: Position[], txns: Txn[], asOf: ISODate = today()): PortfolioSummary {
  const ids = new Set(positions.map(p => p.holding.id));
  const flows: CashFlow[] = [];
  for (const t of live(txns)) {
    if (!ids.has(t.holdingId) || t.date > asOf) continue;
    const charges = D(t.charges);
    if (t.kind === 'BUY') flows.push({ date: t.date, amount: -D(t.amount).plus(charges).toNumber() });
    else if (t.kind === 'SELL') flows.push({ date: t.date, amount: D(t.amount).minus(charges).toNumber() });
    else flows.push({ date: t.date, amount: D(t.amount).toNumber() });
  }
  const value = positions.reduce((s, p) => s.plus(p.value), ZERO);
  if (value.gt(0)) flows.push({ date: asOf, amount: value.toNumber() });

  const invested = positions.reduce((s, p) => s.plus(p.invested), ZERO);
  const unrealized = value.minus(invested);
  const byType = {} as Record<AssetType, Decimal>;
  for (const p of positions) byType[p.holding.type] = (byType[p.holding.type] ?? ZERO).plus(p.value);

  return {
    value,
    invested,
    unrealized,
    unrealizedPct: invested.gt(0) ? unrealized.div(invested).times(100).toNumber() : 0,
    realized: positions.reduce((s, p) => s.plus(p.realized), ZERO),
    dividends: positions.reduce((s, p) => s.plus(p.dividends), ZERO),
    xirr: xirr(flows),
    byType,
    count: positions.filter(p => p.units.gt(0)).length,
  };
}

/** Units, price and amount for a buy or sell entered as either amount or units. */
export function tradeFields(input: { units?: DecInput; price: DecInput; amount?: DecInput }): { units: Decimal; price: Decimal; amount: Decimal } {
  const p = D(input.price);
  if (input.units !== undefined && input.units !== '' && D(input.units).gt(0)) {
    const u = D(input.units);
    return { units: u, price: p, amount: input.amount && D(input.amount).gt(0) ? D(input.amount) : u.times(p) };
  }
  const amount = D(input.amount);
  return { units: p.gt(0) ? amount.div(p) : ZERO, price: p, amount };
}
