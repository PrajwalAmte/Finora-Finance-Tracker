import { D, Decimal, ZERO } from './money';
import { addMonths, daysBetween, financialYear, monthKey, monthStart, stampDate, today, type ISODate } from './dates';
import { live } from './records';
import type { Position } from './portfolio';
import { dueInstallments } from './sips';
import { safeToSpend } from './planner/calendar';
import { harvestSuggestions, taxReport } from './tax/capitalGains';
import type { VaultData } from './types';

export type Severity = 'ALERT' | 'WARN' | 'TIP' | 'GOOD';

export interface Insight {
  /** Stable per period, so dismissing hides it until the situation recurs next period. */
  key: string;
  severity: Severity;
  title: string;
  body: string;
  route?: string;
}

const fmt = (d: Decimal) => `₹${Math.round(d.toNumber()).toLocaleString('en-IN')}`;

/** Rule-based observations computed on the device. Nothing here leaves the phone. */
export function insights(data: VaultData, positions: Position[], asOf: ISODate = today(), opts: { exportReminderDays?: number } = {}): Insight[] {
  const exportEvery = opts.exportReminderDays ?? 30;
  const out: Insight[] = [];
  const month = monthKey(asOf);

  // 1. Category spend running hot vs the previous 3 months.
  const entries = live(data.entries).filter(e => e.kind === 'EXPENSE');
  const thisMonth = new Map<string, Decimal>();
  const prior = new Map<string, Decimal>();
  const priorStart = addMonths(monthStart(asOf), -3);
  for (const e of entries) {
    if (monthKey(e.date) === month) thisMonth.set(e.category, (thisMonth.get(e.category) ?? ZERO).plus(D(e.amount)));
    else if (e.date >= priorStart && e.date < monthStart(asOf)) prior.set(e.category, (prior.get(e.category) ?? ZERO).plus(D(e.amount)));
  }
  const dayOfMonth = Number(asOf.slice(8, 10));
  for (const [cat, spent] of thisMonth) {
    const avg = (prior.get(cat) ?? ZERO).div(3);
    if (avg.lt(1000)) continue;
    if (spent.gt(avg.times(1.4))) {
      const pct = Math.round(spent.div(avg).minus(1).times(100).toNumber());
      out.push({
        key: `spend-${cat}-${month}`, severity: 'WARN',
        title: `${cat} is ${pct}% above usual`,
        body: `${fmt(spent)} so far this month vs a ${fmt(avg)} monthly average${dayOfMonth < 20 ? `, with ${30 - dayOfMonth} days to go` : ''}.`,
        route: '/spend',
      });
    }
  }

  // 2. Safe-to-spend gone negative.
  const sts = safeToSpend(data, asOf);
  if (sts.income.gt(0) && sts.safe.lt(0)) {
    out.push({
      key: `overspend-${month}`, severity: 'ALERT',
      title: 'Spending is ahead of income this month',
      body: `After EMIs, SIPs and bills you are ${fmt(sts.safe.neg())} over. Consider pausing discretionary spends.`,
      route: '/plan',
    });
  }

  // 3. SIPs that fell due but were not recorded.
  for (const sip of live(data.sips)) {
    const due = dueInstallments(sip, asOf);
    if (due.length > 0 && !sip.autoRecord) {
      out.push({
        key: `sip-missed-${sip.id}-${due[due.length - 1]}`, severity: 'WARN',
        title: `${sip.name}: ${due.length} installment${due.length > 1 ? 's' : ''} not recorded`,
        body: 'Mark them paid or import your latest CAS so returns stay accurate.',
        route: '/invest',
      });
    }
  }

  // 4. Loans finishing soon, and expensive loans.
  for (const loan of live(data.loans)) {
    if (loan.closedAt) continue;
    const bal = D(loan.balance);
    const months = bal.gt(0) && D(loan.emi).gt(0) ? Math.ceil(bal.div(D(loan.emi)).toNumber()) : 0;
    if (months > 0 && months <= 3) {
      out.push({
        key: `loan-ending-${loan.id}`, severity: 'GOOD',
        title: `${loan.name} closes in about ${months} month${months > 1 ? 's' : ''}`,
        body: `Plan where the ${fmt(D(loan.emi))} EMI goes next: a SIP keeps the habit going.`,
        route: `/loans/${loan.id}`,
      });
    }
    if (D(loan.annualRate).gte(11) && bal.gt(50000)) {
      out.push({
        key: `loan-costly-${loan.id}-${month}`, severity: 'TIP',
        title: `${loan.name} costs ${D(loan.annualRate).toString()}% a year`,
        body: 'Prepaying a loan this expensive usually beats investing. Try the prepay-vs-invest simulator.',
        route: `/loans/${loan.id}/simulate`,
      });
    }
  }

  // 5. Concentration risk.
  const total = positions.reduce((s, p) => s.plus(p.value), ZERO);
  if (total.gt(100000)) {
    for (const p of positions) {
      const share = p.value.div(total).times(100).toNumber();
      if (share >= 30 && positions.length > 1) {
        out.push({
          key: `concentration-${p.holding.id}-${month}`, severity: 'TIP',
          title: `${Math.round(share)}% of your portfolio is in one holding`,
          body: `${p.holding.name} dominates. Check that this is intentional.`,
          route: `/invest/${p.holding.id}`,
        });
      }
    }
  }

  // 6. Tax-gain harvesting window, most useful in Jan–Mar before the financial year ends.
  const fy = financialYear(asOf);
  const report = taxReport(positions, fy, data.settings.slabRatePct);
  const harvest = harvestSuggestions(positions, report.exemptionLeft, asOf);
  const harvestable = harvest.reduce((s, h) => s.plus(h.gain), ZERO);
  const m = Number(asOf.slice(5, 7));
  if (harvestable.gt(10000) && (m >= 1 && m <= 3)) {
    out.push({
      key: `harvest-${fy}`, severity: 'TIP',
      title: `Book ${fmt(harvestable)} of tax-free gains before 31 March`,
      body: `You have ${fmt(report.exemptionLeft)} of unused LTCG exemption this year. Selling and buying back resets your cost.`,
      route: '/invest/tax',
    });
  }

  // 7. Stale prices and overdue export.
  const lastRefresh = data.settings.lastPriceRefreshAt && stampDate(data.settings.lastPriceRefreshAt);
  if (positions.length > 0 && (!lastRefresh || daysBetween(lastRefresh, asOf) > 7)) {
    out.push({
      key: `prices-${month}-${Math.floor(dayOfMonth / 7)}`, severity: 'TIP',
      title: 'Prices are more than a week old',
      body: 'Refresh NAVs and stock prices to see your real net worth.',
      route: '/invest',
    });
  }
  const lastExport = data.settings.lastExportAt && stampDate(data.settings.lastExportAt);
  const hasRecords = live(data.entries).length + live(data.holdings).length > 0;
  if (hasRecords && (!lastExport || daysBetween(lastExport, asOf) > exportEvery)) {
    out.push({
      key: `export-${month}-${exportEvery < 30 ? Math.floor(dayOfMonth / 7) : 0}`, severity: 'WARN',
      title: lastExport ? `Last backup was ${daysBetween(lastExport, asOf)} days ago` : 'No backup yet',
      body: exportEvery < 30
        ? 'Your data lives only in this browser’s storage. Export an encrypted copy every week.'
        : 'Your data lives only on this phone. Export an encrypted copy to Drive or Files.',
      route: '/settings/backup',
    });
  }

  const dismissed = new Set(data.settings.dismissedInsights);
  const order: Record<Severity, number> = { ALERT: 0, WARN: 1, TIP: 2, GOOD: 3 };
  return out.filter(i => !dismissed.has(i.key)).sort((a, b) => order[a.severity] - order[b.severity]);
}
