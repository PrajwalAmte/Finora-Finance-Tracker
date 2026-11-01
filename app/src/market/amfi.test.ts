import { describe, expect, it } from 'vitest';
import { lookup, parseNavAll, searchSchemes } from './amfi';

// Lines copied from AMFI's NAVAll.txt (8-column layout seen on 29 Oct 2026, and the older 6-column one).
const EIGHT = `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date

Open Ended Schemes(Equity Scheme - Flexi Cap Fund)

PPFAS Mutual Fund

122639;INF879O01027;-;Parag Parikh Flexi Cap Fund;Direct Plan;Growth;88.8018;28-Oct-2026
153964;-;INF879O01308;Parag Parikh Flexi Cap Fund;Direct Plan;Monthly IDCW Payout;88.8021;28-Oct-2026
122640;INF879O01019;-;Parag Parikh Flexi Cap Fund;Regular Plan;Growth;80.8370;28-Oct-2026`;

const SIX = `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
HDFC Mutual Fund
119551;INF179K01UT0;-;HDFC Flexi Cap Fund - Direct Plan - Growth;1850.2300;26-Oct-2026`;

describe('parseNavAll', () => {
  it('reads the 8-column layout, folding plan and option into the name', () => {
    const idx = parseNavAll(EIGHT, '2026-10-29T10:00:00Z');
    expect(idx.schemes).toHaveLength(3);
    expect(idx.schemes[0]).toMatchObject({
      code: '122639', name: 'Parag Parikh Flexi Cap Fund - Direct Plan - Growth', nav: '88.8018', date: '2026-10-28',
      isins: ['INF879O01027'], amc: 'PPFAS Mutual Fund',
    });
    expect(idx.schemes[1].isins).toEqual(['INF879O01308']);
  });

  it('still reads the older 6-column layout', () => {
    const [s] = parseNavAll(SIX, '2026-10-29T10:00:00Z').schemes;
    expect(s).toMatchObject({ code: '119551', name: 'HDFC Flexi Cap Fund - Direct Plan - Growth', nav: '1850.2300', date: '2026-10-26' });
  });

  it('finds schemes by ISIN and ranks Direct Growth first in search', () => {
    const l = lookup(parseNavAll(EIGHT, '2026-10-29T10:00:00Z'));
    expect(l.byIsin.get('INF879O01019')?.code).toBe('122640');
    expect(searchSchemes(l, 'parag flexi')[0].code).toBe('122639');
  });
});
