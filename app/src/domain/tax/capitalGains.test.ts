import { describe, expect, it } from 'vitest';
import { computePosition } from '../portfolio';
import { buy, holding, sell } from '../testFixtures';
import { grandfatheredCost, harvestSuggestions, isLongTerm, lossCandidates, rateFor, taxReport } from './capitalGains';
import { D } from '../money';

describe('holding period and rates', () => {
  it('equity is long term only after 12 months', () => {
    expect(isLongTerm('EQUITY', '2023-01-10', '2024-01-10')).toBe(false);
    expect(isLongTerm('EQUITY', '2023-01-10', '2024-01-11')).toBe(true);
  });

  it('uses 20% / 12.5% for sales on or after 23 Jul 2024 and 15% / 10% before', () => {
    expect(rateFor('EQUITY', '2023-01-01', '2024-07-22', 'SHORT')).toBe(15);
    expect(rateFor('EQUITY', '2023-01-01', '2024-07-23', 'SHORT')).toBe(20);
    expect(rateFor('EQUITY', '2020-01-01', '2024-07-23', 'LONG')).toBe(12.5);
    expect(rateFor('EQUITY', '2020-01-01', '2024-07-01', 'LONG')).toBe(10);
  });

  it('debt funds bought from Apr 2023 are always short term at slab', () => {
    expect(isLongTerm('DEBT', '2023-04-01', '2026-10-01')).toBe(false);
    expect(rateFor('DEBT', '2023-04-01', '2026-10-01', 'SHORT')).toBe('SLAB');
    expect(isLongTerm('DEBT', '2022-01-01', '2026-10-01')).toBe(true);
  });
});

describe('grandfathering', () => {
  it('cost is max(actual, min(FMV, sale value))', () => {
    expect(grandfatheredCost(D(100), D(1), '150', D(200)).toNumber()).toBe(150);
    expect(grandfatheredCost(D(100), D(1), '150', D(120)).toNumber()).toBe(120);
    expect(grandfatheredCost(D(100), D(1), '80', D(200)).toNumber()).toBe(100);
  });

  it('is applied to pre-2018 equity in the tax report', () => {
    const h = holding({ fmv2018: '150' });
    const p = computePosition(h, [buy(h.id, '2017-01-01', '100', '100'), sell(h.id, '2025-06-01', '100', '200')], '2025-12-31');
    const r = taxReport([p], '2025-26', '30');
    expect(r.rows[0].grandfathered).toBe(true);
    expect(r.rows[0].gain.toNumber()).toBe(5000);
  });
});

describe('taxReport', () => {
  it('applies the ₹1.25L exemption and 12.5% to equity long-term gains', () => {
    const h = holding();
    const p = computePosition(h, [buy(h.id, '2022-01-01', '1000', '100'), sell(h.id, '2025-06-01', '1000', '400')], '2025-12-31');
    const r = taxReport([p], '2025-26', '30');
    expect(r.longTermGain.toNumber()).toBe(300000);
    expect(r.exemptionUsed.toNumber()).toBe(125000);
    expect(r.taxBeforeCess.toNumber()).toBe(21875);
    expect(r.cess.toNumber()).toBe(875);
  });

  it('sets short-term losses off against long-term gains', () => {
    const a = holding({ name: 'A' });
    const b = holding({ name: 'B' });
    const pa = computePosition(a, [buy(a.id, '2022-01-01', '1000', '100'), sell(a.id, '2025-06-01', '1000', '400')], '2025-12-31');
    const pb = computePosition(b, [buy(b.id, '2025-04-10', '1000', '200'), sell(b.id, '2025-08-01', '1000', '150')], '2025-12-31');
    const r = taxReport([pa, pb], '2025-26', '30');
    // 3L LTCG − 50k STCL = 2.5L; − 1.25L exemption = 1.25L × 12.5%
    expect(r.taxBeforeCess.toNumber()).toBe(15625);
    expect(r.carryForwardShort.toNumber()).toBe(0);
  });

  it('carries forward losses it cannot set off', () => {
    const b = holding();
    const pb = computePosition(b, [buy(b.id, '2025-04-10', '100', '200'), sell(b.id, '2025-08-01', '100', '150')], '2025-12-31');
    const r = taxReport([pb], '2025-26', '30');
    expect(r.carryForwardShort.toNumber()).toBe(5000);
    expect(r.totalTax.toNumber()).toBe(0);
  });
});

describe('harvesting', () => {
  it('suggests selling only long-term units, in FIFO order, up to the unused exemption', () => {
    const h = holding({ currentPrice: '300' });
    const p = computePosition(h, [
      buy(h.id, '2022-01-01', '1000', '100'),
      buy(h.id, '2026-06-01', '1000', '290'),
    ], '2026-10-29');
    const [s] = harvestSuggestions([p], D(125000), '2026-10-29');
    expect(s.gain.toNumber()).toBeCloseTo(125000, 0);
    expect(s.units.toNumber()).toBeCloseTo(625, 2);
    expect(s.taxSaved.toNumber()).toBe(15625);
  });

  it('lists holdings sitting on losses', () => {
    const h = holding({ currentPrice: '80' });
    const p = computePosition(h, [buy(h.id, '2026-05-01', '100', '100')], '2026-10-29');
    const [c] = lossCandidates([p], '2026-10-29');
    expect(c.term).toBe('SHORT');
    expect(c.loss.toNumber()).toBe(2000);
  });
});
