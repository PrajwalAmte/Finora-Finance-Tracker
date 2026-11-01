import { describe, expect, it } from 'vitest';
import { computePosition, summarize } from './portfolio';
import { xirr } from './xirr';
import { buy, holding, sell } from './testFixtures';

describe('xirr', () => {
  it('is 10% for a one-year 10% gain', () => {
    const r = xirr([{ date: '2021-01-01', amount: -1000 }, { date: '2022-01-01', amount: 1100 }]);
    expect(r).toBeCloseTo(0.1, 4);
  });

  it('handles monthly SIP-style flows', () => {
    const flows = Array.from({ length: 12 }, (_, i) => ({ date: `2023-${String(i + 1).padStart(2, '0')}-05`, amount: -1000 }));
    flows.push({ date: '2024-01-05', amount: 13000 });
    const r = xirr(flows)!;
    expect(r).toBeGreaterThan(0.13);
    expect(r).toBeLessThan(0.17);
  });

  it('is null when there is no sign change', () => {
    expect(xirr([{ date: '2021-01-01', amount: -1000 }])).toBeNull();
  });
});

describe('computePosition (FIFO)', () => {
  it('sells the oldest units first and keeps the rest at their cost', () => {
    const h = holding({ currentPrice: '150' });
    const txns = [
      buy(h.id, '2022-01-10', '10', '100'),
      buy(h.id, '2023-01-10', '10', '120'),
      sell(h.id, '2023-06-10', '15', '140'),
    ];
    const p = computePosition(h, txns, '2024-01-01');
    expect(p.units.toNumber()).toBe(5);
    expect(p.invested.toNumber()).toBe(600);
    expect(p.value.toNumber()).toBe(750);
    expect(p.realizedLots).toHaveLength(2);
    expect(p.realizedLots[0].buyDate).toBe('2022-01-10');
    expect(p.realizedLots[0].units.toNumber()).toBe(10);
    expect(p.realizedLots[0].gain.toNumber()).toBe(400);
    expect(p.realizedLots[1].gain.toNumber()).toBe(100);
    expect(p.realized.toNumber()).toBe(500);
    expect(p.oversold).toBe(false);
  });

  it('flags a sale larger than the units held', () => {
    const h = holding();
    const p = computePosition(h, [buy(h.id, '2022-01-10', '5', '100'), sell(h.id, '2022-02-10', '8', '110')], '2024-01-01');
    expect(p.oversold).toBe(true);
    expect(p.units.toNumber()).toBe(0);
  });

  it('includes charges in cost and nets them from proceeds', () => {
    const h = holding({ currentPrice: '100' });
    const p = computePosition(h, [buy(h.id, '2022-01-10', '10', '100', { charges: '20' })], '2024-01-01');
    expect(p.invested.toNumber()).toBe(1020);
    expect(p.unrealized.toNumber()).toBe(-20);
  });

  it('summarizes a portfolio with an overall XIRR', () => {
    const h = holding({ currentPrice: '110' });
    const txns = [buy(h.id, '2023-01-01', '10', '100')];
    const s = summarize([computePosition(h, txns, '2024-01-01')], txns, '2024-01-01');
    expect(s.value.toNumber()).toBe(1100);
    expect(s.xirr).toBeCloseTo(0.1, 3);
  });
});

describe('valuation price', () => {
  it('uses a later trade price over an older quote, and a newer quote over trades', () => {
    const h = holding({ currentPrice: '100', priceDate: '2023-01-01' });
    const txns = [buy(h.id, '2023-01-01', '10', '100'), sell(h.id, '2024-01-01', '5', '150')];
    expect(computePosition(h, txns, '2024-06-01').price.toNumber()).toBe(150);
    const refreshed = { ...h, currentPrice: '170', priceDate: '2024-05-01' };
    expect(computePosition(refreshed, txns, '2024-06-01').price.toNumber()).toBe(170);
  });
});

describe('quote vs trade price', () => {
  it('keeps a refreshed quote dated at the last close over a trade entered the next day', () => {
    const h = holding({ currentPrice: '1520', priceDate: '2026-10-29' });
    expect(computePosition(h, [buy(h.id, '2026-10-30', '10', '1400')], '2026-10-30').price.toNumber()).toBe(1520);
  });
});
