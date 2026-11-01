import { describe, expect, it } from 'vitest';
import { maskLine, maskLines } from './mask';

describe('maskLine', () => {
  it('hides identity details on non-structural lines', () => {
    expect(maskLine('Email Id: prajwal.amte@gmail.com')).toBe('Xxxxx Xx: xxxx@xxxx.xxx');
    expect(maskLine('Mobile: 9876543210')).toBe('Xxxxxx: 9999999999');
    expect(maskLine('Prajwal Amte')).toBe('Xxxxxxx Xxxx');
    expect(maskLine('12/A, MG Road, Pune 411001')).toBe('99/X, XX Xxxx, Xxxx 999999');
  });

  it('masks PAN and digits but keeps the words the parser reads on folio and scheme lines', () => {
    expect(maskLine('Folio No: 1234567 / 89    KYC: OK  PAN: ABCDE1234F')).toBe('Folio No: 9999999 / 99    KYC: OK  PAN: AAAAA9999A');
    expect(maskLine('B205RG-HDFC Flexi Cap Fund - Direct Plan - Growth - ISIN: INF179K01UT0(Advisor: DIRECT)')).toBe(
      'B999RG-HDFC Flexi Cap Fund - Direct Plan - Growth - ISIN: INF179K01UT0(Advisor: DIRECT)');
  });

  it('keeps transaction rows and totals readable, with amounts hidden', () => {
    expect(maskLine('05-Jan-2023  Purchase - Systematic Investment  5,000.00  4.000  1,250.00  4.000'))
      .toBe('99-Jan-9999  Purchase - Systematic Investment  9,999.99  9.999  9,999.99  9.999');
    expect(maskLine('Closing Unit Balance: 5.846   NAV on 26-Oct-2026: INR 1,850.23   Total Cost Value: 7,323.00'))
      .toBe('Closing Unit Balance: 9.999   NAV on 99-Oct-9999: INR 9,999.99   Total Cost Value: 9,999.99');
  });

  it('never lets a real value through', () => {
    const sample = ['Prajwal Amte', 'PAN: ABCDE1234F', 'prajwal@x.com', '9876543210', 'Folio No: 1234567'];
    const joined = maskLines(sample).join('\n');
    for (const secret of ['Prajwal', 'Amte', 'ABCDE1234F', 'prajwal@x.com', '9876543210', '1234567']) expect(joined).not.toContain(secret);
  });
});
