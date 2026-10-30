import * as XLSX from 'xlsx';
import { D } from '../domain/money';
import { formatDay, today } from '../domain/dates';
import { live } from '../domain/records';
import type { Position } from '../domain/portfolio';
import type { TaxReport } from '../domain/tax/capitalGains';
import { RULES_VERSION } from '../domain/tax/rules';
import type { VaultData } from '../domain/types';
import { netWorth } from '../domain/networth';

const n = (v: { toNumber(): number } | string | undefined) => (v === undefined ? '' : typeof v === 'string' ? Number(v) : Math.round(v.toNumber() * 100) / 100);

/** One workbook with a sheet per area. Generated on the phone and handed to the share sheet. */
export function excelReport(data: VaultData, positions: Position[]): Uint8Array {
  const owners = new Map(live(data.owners).map(o => [o.id, o.name]));
  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: Record<string, unknown>[]) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'No records' }]), name);
  };

  add('Holdings', positions.filter(p => p.units.gt(0)).map(p => ({
    Owner: owners.get(p.holding.ownerId) ?? '', Name: p.holding.name, Type: p.holding.type, ISIN: p.holding.isin ?? '',
    Folio: p.holding.folio ?? '', Units: n(p.units), 'Avg cost': n(p.avgCost), Price: n(p.price), Invested: n(p.invested),
    Value: n(p.value), 'Gain': n(p.unrealized), 'XIRR %': p.xirr === null ? '' : Math.round(p.xirr * 10000) / 100,
  })));

  const holdingNames = new Map(live(data.holdings).map(h => [h.id, h.name]));
  add('Transactions', live(data.txns).sort((a, b) => a.date.localeCompare(b.date)).map(t => ({
    Date: t.date, Holding: holdingNames.get(t.holdingId) ?? '', Kind: t.kind, Units: n(t.units), Price: n(t.price),
    Amount: n(t.amount), Charges: n(t.charges), Estimated: t.estimated ? 'yes' : '',
  })));

  add('Spending', live(data.entries).sort((a, b) => b.date.localeCompare(a.date)).map(e => ({
    Date: e.date, Type: e.kind, Description: e.description, Category: e.category, 'Paid by': e.paymentMethod,
    Amount: n(e.amount), Owner: owners.get(e.ownerId) ?? '',
  })));

  add('Loans', live(data.loans).map(l => ({
    Name: l.name, Lender: l.lender ?? '', Principal: n(l.principal), 'Rate %': n(l.annualRate), EMI: n(l.emi),
    'EMI day': l.emiDay, Start: l.startDate, 'Tenure (months)': l.tenureMonths, Balance: n(l.balance), 'As of': l.balanceAsOf,
    Closed: l.closedAt ?? '',
  })));

  add('SIPs', live(data.sips).map(s => ({
    Name: s.name, Amount: n(s.amount), Day: s.dayOfMonth, Start: s.startDate, End: s.endDate ?? '', Status: s.status,
    'Last installment': s.lastInstallment ?? '',
  })));

  add('Net worth', live(data.snapshots).sort((a, b) => a.date.localeCompare(b.date)).map(s => ({
    Date: s.date, Assets: n(s.assets), Liabilities: n(s.liabilities), 'Net worth': n(s.netWorth),
  })));

  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Schedule 112A rows (equity long-term gains), in the column order of the ITR utility's CSV upload.
 * One row per sale lot; the utility accepts this and you can paste it into the CSV template.
 */
export function schedule112aCsv(report: TaxReport): string {
  const header = [
    'Share/Unit acquired', 'ISIN Code', 'Name of the Share/Unit', 'No. of Shares/Units', 'Sale-price per Share/Unit',
    'Full Value of Consideration', 'Cost of acquisition without indexation', 'Cost of acquisition',
    'If the long term capital asset was acquired before 01.02.2018, Fair Market Value per share/unit as on 31st January 2018',
    'Total Fair Market Value of capital asset as per section 55(2)(ac)', 'Expenditure wholly and exclusively in connection with transfer',
    'Total deductions', 'Balance',
  ];
  const rows = report.rows.filter(r => r.section112A).map(r => {
    const salePerUnit = r.proceeds.div(r.units);
    const fmvTotal = r.fmv2018 ? r.fmv2018.times(r.units) : undefined;
    return [
      r.buyDate < '2018-02-01' ? 'On or before 31st January 2018' : 'After 31st January 2018',
      r.holding.isin ?? '', r.holding.name, r.units.toDecimalPlaces(3).toString(), salePerUnit.toDecimalPlaces(2).toString(),
      r.proceeds.toDecimalPlaces(2).toString(), r.actualCost.toDecimalPlaces(2).toString(), r.taxCost.toDecimalPlaces(2).toString(),
      r.fmv2018 ? r.fmv2018.toString() : '', fmvTotal ? fmvTotal.toDecimalPlaces(2).toString() : '', '0',
      r.taxCost.toDecimalPlaces(2).toString(), r.gain.toDecimalPlaces(2).toString(),
    ];
  });
  return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
}

export function capitalGainsCsv(report: TaxReport): string {
  const header = ['Holding', 'ISIN', 'Tax class', 'Bought', 'Sold', 'Units', 'Sale value', 'Cost', 'Tax cost', 'Gain', 'Term', 'Rate', 'Grandfathered'];
  const rows = report.rows.map(r => [
    r.holding.name, r.holding.isin ?? '', r.holding.taxClass, r.buyDate, r.sellDate, r.units.toDecimalPlaces(3).toString(),
    r.proceeds.toFixed(2), r.actualCost.toFixed(2), r.taxCost.toFixed(2), r.gain.toFixed(2), r.term, String(r.rate), r.grandfathered ? 'yes' : '',
  ]);
  return [header, ...rows, [], [`Estimate for FY ${report.fy}, rules version ${RULES_VERSION}. Not tax advice.`]].map(r => r.map(csvCell).join(',')).join('\n');
}

/**
 * The family emergency file: everything someone would need if you could not tell them yourself.
 * Rendered as a PDF the user can password-protect and share or print.
 */
export async function emergencyPdf(data: VaultData, positions: Position[], password?: string): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF(password ? { encryption: { userPassword: password, ownerPassword: password, userPermissions: ['print'] } } : {});
  const owners = new Map(live(data.owners).map(o => [o.id, o.name]));
  const inr = (v: { toNumber(): number } | string) => `Rs ${Math.round(typeof v === 'string' ? Number(v) : v.toNumber()).toLocaleString('en-IN')}`;
  const nw = netWorth(data, undefined, positions);

  doc.setFontSize(18);
  doc.text('Family emergency file', 14, 18);
  doc.setFontSize(10);
  doc.text(`Prepared ${formatDay(today())} with Finora. Keep this somewhere safe.`, 14, 25);
  doc.text(`Net worth ${inr(nw.netWorth)}  ·  Assets ${inr(nw.assets)}  ·  Loans ${inr(nw.liabilities)}`, 14, 31);

  let y = 38;
  if (data.settings.emergencyNotes) {
    doc.setFontSize(12);
    doc.text('Notes and instructions', 14, y);
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(data.settings.emergencyNotes, 180) as string[];
    doc.text(lines, 14, y + 6);
    y += 10 + lines.length * 5;
  }

  const section = (title: string, head: string[], body: (string | number)[][]) => {
    if (body.length === 0) return;
    autoTable(doc, { startY: y, head: [head], body, theme: 'grid', styles: { fontSize: 8 }, headStyles: { fillColor: [37, 99, 235] }, didDrawPage: () => {} });
    doc.setFontSize(12);
    doc.text(title, 14, y - 2);
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
  };

  y += 4;
  section('Investments', ['Owner', 'Holding', 'Folio / ISIN', 'Fund house / broker', 'Units', 'Value', 'Nominee'],
    positions.filter(p => p.units.gt(0)).map(p => [
      owners.get(p.holding.ownerId) ?? '', p.holding.name, [p.holding.folio, p.holding.isin].filter(Boolean).join(' / '),
      p.holding.amc ?? p.holding.broker ?? '', p.units.toDecimalPlaces(3).toString(), inr(p.value), p.holding.nominee ?? '',
    ]));
  section('Loans', ['Owner', 'Loan', 'Lender', 'Account', 'EMI', 'EMI day', 'Outstanding'],
    live(data.loans).filter(l => !l.closedAt).map(l => [owners.get(l.ownerId) ?? '', l.name, l.lender ?? '', l.accountRef ?? '', inr(l.emi), l.emiDay, inr(l.balance)]));
  section('Running SIPs', ['SIP', 'Amount', 'Debit day', 'Since'],
    live(data.sips).filter(s => s.status === 'ACTIVE').map(s => [s.name, inr(s.amount), s.dayOfMonth, s.startDate]));
  section('Regular payments', ['Name', 'Type', 'Amount', 'Day'],
    live(data.recurring).filter(r => r.active).map(r => [r.name, r.kind === 'INCOME' ? 'Income' : 'Bill', inr(D(r.amount)), r.dayOfMonth]));

  return new Uint8Array(doc.output('arraybuffer'));
}
