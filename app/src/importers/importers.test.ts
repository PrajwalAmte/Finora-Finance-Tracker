import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import { parseCasLines, parseDematCas, parseMfCas } from './cas';
import { parseBankSheet, parseHoldingsSheet } from './sheets';
import { extractPdfLines } from './pdfText';
import { parseInvestmentStatement } from './index';
import { applyBankRows, applyStatement, prepareBankRows } from './apply';
import { computePositions } from '../domain/portfolio';
import { vault } from '../domain/testFixtures';
import { ImportError } from './types';

const CAMS = `
Consolidated Account Statement
01-Jan-2023 To 26-Oct-2026
HDFC Mutual Fund
Folio No: 1234567 / 89    KYC: OK  PAN: OK
B205RG-HDFC Flexi Cap Fund - Direct Plan - Growth (Non-Demat) - ISIN: INF179K01UT0(Advisor: DIRECT) Registrar : CAMS
Opening Unit Balance: 0.000
05-Jan-2023  Purchase - Systematic Investment  5,000.00  4.000  1,250.00  4.000
05-Jan-2023  *** Stamp Duty ***  0.25
05-Feb-2023  Purchase - Systematic Investment  5,000.00  3.846  1,300.00  7.846
10-Mar-2024  Redemption  (2,800.00)  (2.000)  1,400.00  5.846
Closing Unit Balance: 5.846   NAV on 26-Oct-2026: INR 1,850.23   Total Cost Value: 7,323.00   Market Value on 26-Oct-2026: INR 10,816.44
Folio No: 99887766  KYC: OK
Parag Parikh Flexi Cap Fund - Direct Plan Growth (INF879O01027)
Opening Unit Balance: 10.000
05-Jan-2024  Purchase  10,000.00  20.000  500.00  30.000
Closing Unit Balance: 30.000   NAV on 26-Oct-2026: INR 80.50   Total Cost Value: 15,000.00
`.trim().split('\n');

const CDSL = `
CDSL Consolidated Account Statement as on 26-10-2026
ISIN  Security  Current Bal  Market Value
INE002A01018  RELIANCE INDUSTRIES LTD  10.000  29,500.00
INE009A01021  INFOSYS LIMITED  25.000  45,250.00
INE123A01011  DELISTED CO LTD  5.000  N.A.
INF204KB14I2  NIPPON INDIA ETF NIFTY BEES  100.000  27,000.00
`.trim().split('\n');

describe('parseMfCas (CAMS/KFintech)', () => {
  const res = parseMfCas(CAMS);

  it('reads folios, scheme names, ISINs and the full transaction history', () => {
    expect(res.holdings).toHaveLength(2);
    const [hdfc, ppfas] = res.holdings;
    expect(hdfc).toMatchObject({ isin: 'INF179K01UT0', folio: '1234567/89', units: '5.846', price: '1850.23', amc: 'HDFC Mutual Fund' });
    expect(hdfc.name).toBe('HDFC Flexi Cap Fund - Direct Plan - Growth');
    expect(hdfc.transactions.map(t => [t.date, t.kind, t.units, t.systematic])).toEqual([
      ['2023-01-05', 'BUY', '4', true],
      ['2023-02-05', 'BUY', '3.846', true],
      ['2024-03-10', 'SELL', '2', false],
    ]);
    expect(hdfc.historyMismatch).toBeUndefined();
    expect(ppfas.name).toBe('Parag Parikh Flexi Cap Fund - Direct Plan Growth');
  });

  it('flags a history that does not reach the closing balance', () => {
    expect(res.holdings[1].historyMismatch).toBe(true);
    expect(res.warnings.join(' ')).toContain('1 of 2 funds were bought before that');
  });

  it('is chosen automatically for CAMS statements', () => {
    expect(parseCasLines(CAMS).source).toBe('CAS_MF');
  });
});

describe('parseDematCas (CDSL/NSDL)', () => {
  const res = parseDematCas(CDSL);

  it('reads tabular rows, derives price from market value and skips N.A. rows', () => {
    expect(res.holdings.map(h => [h.isin, h.type, h.units, h.price])).toEqual([
      ['INE002A01018', 'STOCK', '10', '2950'],
      ['INE009A01021', 'STOCK', '25', '1810'],
      ['INF204KB14I2', 'ETF', '100', '270'],
    ]);
    expect(res.holdings[0].name).toBe('RELIANCE INDUSTRIES LTD');
    expect(res.warnings.some(w => w.includes('DELISTED'))).toBe(true);
    expect(res.statementDate).toBe('2026-10-26');
  });

  it('reads NSDL multi-line blocks', () => {
    const nsdl = ['NSDL Consolidated Account Statement', 'HDFC BANK LIMITED', 'INE040A01034', 'Balance 12.000', 'Market Value 19,800.00'];
    const [h] = parseDematCas(nsdl).holdings;
    expect(h).toMatchObject({ name: 'HDFC BANK LIMITED', units: '12', price: '1650' });
  });
});

function workbook(rows: (string | number)[][], bookType: XLSX.BookType = 'xlsx'): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Holdings');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType }) as ArrayBuffer);
}

describe('broker holdings sheets', () => {
  it('finds the header row under a preamble and maps Zerodha-style columns', () => {
    const bytes = workbook([
      ['Holdings statement for client AB1234'],
      [],
      ['Symbol', 'ISIN', 'Sector', 'Quantity Available', 'Average Price', 'Previous Closing Price'],
      ['INFY', 'INE009A01021', 'IT', 25, 1500, 1810],
      ['NIFTYBEES', 'INF204KB14I2', 'ETF', 100, 240.5, 270],
      ['TOTAL', '', '', 125, '', ''],
    ]);
    const res = parseHoldingsSheet(bytes);
    expect(res.holdings.map(h => [h.symbol, h.isin, h.type, h.units, h.avgCost, h.price])).toEqual([
      ['INFY', 'INE009A01021', 'STOCK', '25', '1500', '1810'],
      ['NIFTYBEES', 'INF204KB14I2', 'ETF', '100', '240.5', '270'],
    ]);
  });

  it('derives cost and price from invested/current value totals (Groww mutual-fund export)', () => {
    const csv = new TextEncoder().encode([
      'Name,Mobile', 'Holding summary,', '',
      'Scheme Name,AMC,Category,Folio No.,Units,Invested Value,Current Value,Returns',
      'Quant Small Cap Fund Direct Plan Growth,Quant Mutual Fund,Equity,51085752323,131.135,39998.08,39042.04,-956.04',
    ].join('\n'));
    const [h] = parseHoldingsSheet(csv).holdings;
    expect(h).toMatchObject({ type: 'MUTUAL_FUND', units: '131.135', folio: '51085752323', amc: 'Quant Mutual Fund' });
    expect(Number(h.avgCost) * 131.135).toBeCloseTo(39998.08, 0);
    expect(Number(h.price) * 131.135).toBeCloseTo(39042.04, 0);
  });

  it('reads CSV and merges the same security across accounts', () => {
    const csv = new TextEncoder().encode('Instrument,Qty.,Avg. cost,LTP\nTCS,10,3000,4000\nTCS,10,3500,4000\n');
    const [h] = parseHoldingsSheet(csv).holdings;
    expect(h).toMatchObject({ name: 'TCS', units: '20', avgCost: '3250' });
  });
});

describe('bank statements', () => {
  it('reads debit/credit columns', () => {
    const bytes = workbook([
      ['HDFC BANK Ltd', 'Statement of account'],
      ['Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance'],
      ['01/10/26', 'UPI-SWIGGY-swiggy@icici-123', '0001', '01/10/26', 450, '', 10000],
      ['02/10/26', 'NEFT CR-ACME CORP-SALARY OCT', '0002', '02/10/26', '', 85000, 95000],
    ]);
    const res = parseBankSheet(bytes);
    expect(res.bankName).toBe('HDFC');
    expect(res.transactions.map(t => [t.date, t.kind, t.amount])).toEqual([
      ['2026-10-01', 'EXPENSE', '450'],
      ['2026-10-02', 'INCOME', '85000'],
    ]);
  });

  it('reads a signed amount column with Dr/Cr type', () => {
    const csv = new TextEncoder().encode('Transaction Date,Description,Amount,Dr/Cr\n05-10-2026,AMAZON PAY,1299.00,DR\n06-10-2026,INTEREST,12.50,CR\n');
    const res = parseBankSheet(csv);
    expect(res.transactions.map(t => t.kind)).toEqual(['EXPENSE', 'INCOME']);
  });

  it('categorises rows, flags duplicates on re-import, and adds entries once', () => {
    const data = vault();
    const rows = prepareBankRows(data, [{ date: '2026-10-01', narration: 'UPI-SWIGGY-123', amount: '450', kind: 'EXPENSE' }]);
    expect(rows[0].category).toBe('Food');
    const once = applyBankRows(data, rows, { ownerId: 'self', paymentMethod: 'UPI' });
    expect(prepareBankRows(once.data, rows)[0].duplicate).toBe(true);
  });
});

describe('applyStatement', () => {
  it('imports transactions idempotently and replaces estimated SIP installments', () => {
    const preview = parseMfCas(CAMS);
    let data = vault();
    const first = applyStatement(data, preview, preview.holdings, { ownerId: 'self', asOf: '2026-10-26' });
    expect(first.holdingsAdded).toBe(2);
    data = first.data;
    const positions = computePositions(data, '2026-10-26');
    const hdfc = positions.find(p => p.holding.isin === 'INF179K01UT0')!;
    expect(hdfc.units.toNumber()).toBeCloseTo(5.846, 3);
    expect(hdfc.realizedLots).toHaveLength(1);
    expect(hdfc.xirr).not.toBeNull();
    const ppfas = positions.find(p => p.holding.isin === 'INF879O01027')!;
    expect(ppfas.units.toNumber()).toBe(30);

    const again = applyStatement(data, preview, preview.holdings, { ownerId: 'self', asOf: '2026-10-26' });
    expect(again.txnsAdded).toBe(0);
    expect(again.holdingsAdded).toBe(0);
  });

  it('adds an adjusting transaction for holdings-only statements', () => {
    const preview = parseDematCas(CDSL);
    const res = applyStatement(vault(), preview, preview.holdings, { ownerId: 'spouse', asOf: '2026-10-26' });
    const positions = computePositions(res.data, '2026-10-26');
    expect(positions.find(p => p.holding.isin === 'INE002A01018')!.units.toNumber()).toBe(10);
    expect(res.data.holdings.every(h => h.ownerId === 'spouse')).toBe(true);

    const smaller = { ...preview, holdings: [{ ...preview.holdings[0], units: '4' }] };
    const after = applyStatement(res.data, smaller, smaller.holdings, { ownerId: 'spouse', asOf: '2026-10-27' });
    expect(computePositions(after.data, '2026-10-27').find(p => p.holding.isin === 'INE002A01018')!.units.toNumber()).toBe(4);
  });
});

describe('PDF text extraction', () => {
  function pdf(lines: string[], password?: string): Uint8Array {
    const doc = new jsPDF(password ? { encryption: { userPassword: password, ownerPassword: password, userPermissions: ['print'] } } : {});
    lines.forEach((l, i) => doc.text(l, 10, 20 + i * 8));
    return new Uint8Array(doc.output('arraybuffer'));
  }

  it('returns lines in reading order', async () => {
    const lines = await extractPdfLines(pdf(['Folio No: 123456', 'Closing Unit Balance: 10.000']));
    expect(lines).toEqual(['Folio No: 123456', 'Closing Unit Balance: 10.000']);
  });

  it('asks for a password and rejects a wrong one', async () => {
    const bytes = pdf(['secret'], 'abcde1234f01011990');
    await expect(extractPdfLines(bytes)).rejects.toMatchObject({ code: 'PASSWORD_NEEDED' });
    await expect(extractPdfLines(bytes, 'wrong')).rejects.toMatchObject({ code: 'PASSWORD_WRONG' });
    expect(await extractPdfLines(bytes, 'abcde1234f01011990')).toEqual(['secret']);
  });

  it('routes PDFs to the CAS parser', async () => {
    const res = await parseInvestmentStatement(pdf(['CDSL Consolidated Account Statement', 'INE002A01018  RELIANCE INDUSTRIES LTD  10.000  29,500.00']));
    expect(res.holdings[0].isin).toBe('INE002A01018');
    await expect(parseInvestmentStatement(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(ImportError);
  });
});

// Shape of a real CAMS "period" statement (1 Apr to 1 Nov): a wrapped scheme name, a fund house
// heading without "Mutual Fund", opening balances, and a folio with no transactions in the period.
const PERIOD_STATEMENT = [
  'Consolidated Account Statement',
  '01-Apr-2025 To 01-Nov-2026',
  'ICICI Prudential Mutual Fund',
  'Folio No: 1234567 / 99  PAN: ABCDE1234F  KYC: OK PAN: OK',
  'Jane Doe',
  'P9999-ICICI Prudential Large Cap Fund (erstwhile Bluechip Fund) - Direct Plan - Growth (formerly ICICI Prudential Focused Bluechip Equity  Registrar : CAMS',
  'Fund) (Non-Demat) - ISIN: INF109K016L0(Advisor: DIRECT)',
  'Opening Unit Balance: 100.000',
  '05-Apr-2025 SIP Purchase - Instalment 10/120 - DIRECT  5,000.00  50.000  100.00  150.000',
  '05-Apr-2025 *** Stamp Duty ***  0.25',
  'Page 2 of 4',
  'Consolidated Account Statement',
  '01-Apr-2025 To 01-Nov-2026',
  'Date  Transaction  Amount  Units  Price  Unit',
  'Closing Unit Balance: 150.000  NAV on 31-Oct-2026: INR 120.00  Total Cost Value: 15,000.00  Market Value on 31-Oct-2026: INR 18,000.00',
  'Current: Entry Load - NIL for all transactions, including, SIP / STPs accepted by the Fund.',
  'Folio No: 7654321 / 9  PAN: ABCDE1234F  KYC: OK PAN: OK',
  'Jane Doe',
  'P1234-ICICI Prudential Healthcare Fund - Direct Plan - Growth (Non-Demat) - ISIN: INF109KC1GH2(Advisor: DIRECT)  Registrar : CAMS',
  'Opening Unit Balance: 200.000',
  '*** No transactions during this statement period ***',
  'Closing Unit Balance: 200.000  NAV on 31-Oct-2026: INR 50.00  Total Cost Value: 8,000.00  Market Value on 31-Oct-2026: INR 10,000.00',
  'Quant MF',
  'Folio No: 99999999999 / 9  PAN: ABCDE1234F  PAN: OK',
  'JANE DOE',
  '999IBDGG-quant Small Cap Fund - Direct Plan (Demat) - ISIN: INF966L01689(Advisor: INZ000031633)  Registrar :',
  'KFINTECH',
  'Opening Unit Balance: 0.000',
  '05-Apr-2025 Additional Purchase  4,000.00  20.000  200.0000  20.000',
  'Closing Unit Balance: 20.000  NAV on 31-Oct-2026: INR 250.0000  Total Cost Value: 4,000.00  Market Value on 31-Oct-2026: INR 5,000.00',
];

describe('a CAMS period statement', () => {
  const res = parseMfCas(PERIOD_STATEMENT);

  it('reads the period, wrapped scheme names, and the right fund house for each folio', () => {
    expect(res.periodStart).toBe('2025-04-01');
    expect(res.statementDate).toBe('2026-11-01');
    expect(res.holdings.map(h => [h.name, h.amc, h.units])).toEqual([
      ['ICICI Prudential Large Cap Fund (erstwhile Bluechip Fund) - Direct Plan - Growth (formerly ICICI Prudential Focused Bluechip Equity Fund)', 'ICICI Prudential Mutual Fund', '150'],
      ['ICICI Prudential Healthcare Fund - Direct Plan - Growth', 'ICICI Prudential Mutual Fund', '200'],
      ['quant Small Cap Fund - Direct Plan', 'Quant MF', '20'],
    ]);
  });

  it('flags funds held before the period, with one plain-language warning', () => {
    expect(res.holdings.map(h => h.openingUnits)).toEqual(['100', '200', undefined]);
    expect(res.warnings[0]).toContain('2 of 3 funds were bought before that');
    expect(res.warnings[0]).toContain('since inception');
  });

  it('dates earlier units the day before the period and costs them from the statement, not from today', () => {
    const out = applyStatement(vault(), res, res.holdings, { ownerId: 'self' });
    const byUnits = (u: string) => out.data.txns.filter(t => t.units === u);
    // Large Cap: opening 100 units = total cost 15,000 less the 5,000 bought in the period → 10,000.
    const [open] = byUnits('100');
    expect(open).toMatchObject({ date: '2025-03-31', kind: 'BUY', amount: '10000', source: 'IMPORT' });
    // Healthcare had no transactions: its 200 units are one buy at cost, dated before the period.
    expect(byUnits('200')[0]).toMatchObject({ date: '2025-03-31', amount: '8000' });
    // A fund bought entirely inside the period gets no opening transaction.
    expect(out.data.txns.filter(t => t.date === '2025-03-31')).toHaveLength(2);
    const again = applyStatement(out.data, res, res.holdings, { ownerId: 'self' });
    expect(again.txnsAdded).toBe(0);
  });
});

describe('a CAMS statement as a real PDF', () => {
  // Small type so every line fits the page: pdf.js drops text that runs past the page edge.
  function camsPdf(password?: string): Uint8Array {
    const doc = new jsPDF(password ? { encryption: { userPassword: password, ownerPassword: password, userPermissions: ['print'] } } : {});
    doc.setFontSize(7);
    CAMS.forEach((l, i) => doc.text(l, 10, 15 + i * 6));
    return new Uint8Array(doc.output('arraybuffer'));
  }

  it('goes from PDF bytes to folios, units and transactions', async () => {
    const res = await parseInvestmentStatement(camsPdf());
    expect(res.source).toBe('CAS_MF');
    expect(res.holdings.map(h => [h.isin, h.units, h.transactions.length])).toEqual([['INF179K01UT0', '5.846', 3], ['INF879O01027', '30', 1]]);
  });

  it('opens a password-protected statement with the right password only', async () => {
    const bytes = camsPdf('me@example.com');
    await expect(parseInvestmentStatement(bytes)).rejects.toMatchObject({ code: 'PASSWORD_NEEDED' });
    await expect(parseInvestmentStatement(bytes, 'wrong')).rejects.toMatchObject({ code: 'PASSWORD_WRONG' });
    expect((await parseInvestmentStatement(bytes, 'me@example.com')).holdings).toHaveLength(2);
  });
});

describe('browsers without ReadableStream async iteration', () => {
  it('still reads every page (pdf.js getTextContent would fail with "undefined is not a function")', async () => {
    // Safari on many iPhones cannot `for await` over a ReadableStream.
    const proto = ReadableStream.prototype as unknown as Record<symbol | string, unknown>;
    const saved = { iter: proto[Symbol.asyncIterator], values: proto.values };
    delete proto[Symbol.asyncIterator];
    delete proto.values;
    try {
      const doc = new jsPDF();
      doc.setFontSize(7);
      CAMS.forEach((l, i) => doc.text(l, 10, 15 + i * 6));
      const res = await parseInvestmentStatement(new Uint8Array(doc.output('arraybuffer')));
      expect(res.holdings).toHaveLength(2);
    } finally {
      proto[Symbol.asyncIterator] = saved.iter;
      proto.values = saved.values;
    }
  });
});

describe('pdf.js build', () => {
  it('imports the legacy build, which carries the polyfills older iPhones and Android WebViews need', async () => {
    // The regular build fails there on every PDF ("toHex is not a function"). Node 22 also lacks
    // those APIs, so the PDF tests above only pass because they run the legacy build too.
    const source = (await import('./pdfText.ts?raw')).default;
    const imports = [...source.matchAll(/await import\(\s*'(pdfjs-dist[^']*)'\s*\)/g)].map(m => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) expect(spec).toMatch(/^pdfjs-dist\/legacy\//);
  });
});
