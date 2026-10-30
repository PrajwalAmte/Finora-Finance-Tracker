import React, { useMemo, useState } from 'react';
import { Download, Info, Scissors, TrendingDown } from 'lucide-react';
import { Button } from '../components/Button';
import { AmountField, Chip, List, Money, Panel, Row, Screen, Section, Stat } from '../components/kit';
import { useData, usePositions, useStore } from '../vault';
import { financialYear, today } from '../../domain/dates';
import { harvestSuggestions, lossCandidates, taxReport } from '../../domain/tax/capitalGains';
import { RULES_VERSION } from '../../domain/tax/rules';
import { capitalGainsCsv, schedule112aCsv } from '../../reports/reports';
import { shareFile } from '../../platform/device';
import { setSettings } from '../actions';
import { day, qty, tone } from '../format';
import { toast } from '../toast';

function fyOptions(): string[] {
  const current = financialYear(today());
  const start = Number(current.slice(0, 4));
  return [0, 1, 2, 3].map(i => {
    const y = start - i;
    return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  });
}

export default function TaxPage() {
  const data = useData();
  const store = useStore();
  const positions = usePositions();
  const [fy, setFy] = useState(financialYear(today()));
  const isCurrent = fy === financialYear(today());
  const report = useMemo(() => taxReport(positions, fy, data.settings.slabRatePct), [positions, fy, data.settings.slabRatePct]);
  const harvest = useMemo(() => (isCurrent ? harvestSuggestions(positions, report.exemptionLeft) : []), [positions, report, isCurrent]);
  const losses = useMemo(() => (isCurrent ? lossCandidates(positions) : []), [positions, isCurrent]);
  const harvestGain = harvest.reduce((s, h) => s + h.gain.toNumber(), 0);
  const harvestSaved = harvest.reduce((s, h) => s + h.taxSaved.toNumber(), 0);
  const missingFmv = positions.some(p => p.holding.taxClass === 'EQUITY' && !p.holding.fmv2018 && p.lots.some(l => l.date < '2018-02-01'));

  const exportCsv = async (which: '112a' | 'all') => {
    try {
      const csv = which === '112a' ? schedule112aCsv(report) : capitalGainsCsv(report);
      await shareFile(`${which === '112a' ? 'schedule-112a' : 'capital-gains'}-FY${fy}.csv`, csv, 'text/csv', which === '112a' ? 'Schedule 112A' : 'Capital gains');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Screen title="Capital gains tax" subtitle="Estimated on this phone from your transactions" back>
      <div className="flex gap-2 overflow-x-auto -mx-4 px-4 no-scrollbar">
        {fyOptions().map(o => <Chip key={o} active={o === fy} onClick={() => setFy(o)}>FY {o}</Chip>)}
      </div>

      <Panel className="p-4">
        <div className="text-xs text-neutral-500">Estimated tax {isCurrent ? 'so far' : ''} (incl. 4% cess)</div>
        <div className="text-3xl font-bold"><Money value={report.totalTax} /></div>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <Stat label="Short-term gains" value={<Money value={report.shortTermGain} short signed className={tone(report.shortTermGain)} />} />
          <Stat label="Long-term gains" value={<Money value={report.longTermGain} short signed className={tone(report.longTermGain)} />} />
          <Stat label={`Tax-free LTCG left (of ₹${(report.exemption / 1000).toFixed(0)}K)`} value={<Money value={report.exemptionLeft} short />} />
          {(report.carryForwardShort.gt(0) || report.carryForwardLong.gt(0)) && (
            <Stat label="Losses to carry forward" value={<Money value={report.carryForwardShort.plus(report.carryForwardLong)} short />} sub={<span className="text-neutral-500">file ITR on time to keep them</span>} />
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 mt-4">
          <Button size="sm" variant="secondary" iconLeft={<Download size={16} />} disabled={!report.rows.some(r => r.section112A)} onClick={() => exportCsv('112a')}>Schedule 112A</Button>
          <Button size="sm" variant="secondary" iconLeft={<Download size={16} />} disabled={report.rows.length === 0} onClick={() => exportCsv('all')}>All gains (CSV)</Button>
        </div>
      </Panel>

      {isCurrent && (
        <Section title="Tax-gain harvesting">
          {harvest.length === 0 ? (
            <Panel className="p-4 text-sm text-neutral-500 flex gap-2"><Scissors size={18} className="shrink-0" />{report.exemptionLeft.lte(0) ? 'This year’s tax-free limit is already used.' : 'No long-term equity gains to book right now.'}</Panel>
          ) : (
            <>
              <Panel className="p-4 text-sm">
                Sell these units and buy them back the same day to book <b><Money value={harvestGain} /></b> of gains tax-free. Your cost goes up, which saves about <b><Money value={harvestSaved} /></b> of tax when you eventually sell.
              </Panel>
              <List className="mt-2">
                {harvest.map(h => (
                  <Row key={h.position.holding.id} title={h.position.holding.name} subtitle={`Sell ${qty(h.units)} units, buy back the same day`} trailing={<Money value={h.gain} short className="text-success-600" />} trailingSub={<span className="text-neutral-500">sale <Money value={h.saleValue} short /></span>} />
                ))}
              </List>
              <p className="text-xs text-neutral-500 mt-2 px-1">Units are counted oldest first because that is how the sale will be matched. Exit loads and STT are not included.</p>
            </>
          )}
        </Section>
      )}

      {isCurrent && losses.length > 0 && (report.shortTermGain.gt(0) || report.longTermGain.gt(report.exemption)) && (
        <Section title="Losses you could book">
          <List>
            {losses.slice(0, 6).map(l => (
              <Row key={`${l.position.holding.id}-${l.term}`} icon={<TrendingDown size={18} />} title={l.position.holding.name} subtitle={`${qty(l.units)} units · ${l.term === 'SHORT' ? 'short term (offsets any gain)' : 'long term (offsets long-term gains)'}`} trailing={<Money value={l.loss.neg()} short className="text-error-600" />} />
            ))}
          </List>
        </Section>
      )}

      <Section title={`Sales in FY ${fy}`}>
        {report.rows.length === 0 ? (
          <Panel className="p-4 text-sm text-neutral-500">No sales recorded this year.</Panel>
        ) : (
          <List>
            {report.rows.map((r, i) => (
              <Row key={i} title={r.holding.name} subtitle={`${day(r.sellDate, 'dd MMM')} · ${qty(r.units)} units · ${r.term === 'LONG' ? 'LT' : 'ST'} @ ${r.rate === 'SLAB' ? 'slab' : `${r.rate}%`}${r.grandfathered ? ' · grandfathered' : ''}`} trailing={<Money value={r.gain} short signed className={tone(r.gain)} />} />
            ))}
          </List>
        )}
      </Section>

      <Panel className="p-4 space-y-3">
        <AmountField label="Your income-tax slab rate (%)" value={data.settings.slabRatePct} onChange={v => setSettings(store, { slabRatePct: v || '0' })} prefix="" hint="Used for debt funds bought after Mar 2023 and other slab-taxed gains." />
        <div className="text-xs text-neutral-500 flex gap-2">
          <Info size={14} className="shrink-0 mt-0.5" />
          <span>Estimate using rules effective {RULES_VERSION} (equity: 20% short term, 12.5% long term above ₹1.25L; older sales at 15%/10%). Surcharge, indexation, exit loads and foreign assets are not modelled. Check with a CA before filing.{missingFmv && ' Some equity bought before Feb 2018 has no 31 Jan 2018 price; add it on the holding for correct grandfathering.'}</span>
        </div>
      </Panel>
    </Screen>
  );
}
