import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { AlertTriangle, CalendarClock, ChevronRight, Info, PartyPopper, Search, Settings as SettingsIcon, Sparkles, X } from 'lucide-react';
import { IconButton, List, Money, Panel, PrivacyToggle, Row, Screen, Section, Stat, usePrivacy } from '../components/kit';
import { QuickAdd } from '../components/QuickAdd';
import { useData, usePositions, useStore } from '../vault';
import { netWorth, snapshotSeries } from '../../domain/networth';
import { safeToSpend, upcoming } from '../../domain/planner/calendar';
import { insights, type Insight } from '../../domain/insights';
import { live } from '../../domain/records';
import { daysBetween, today } from '../../domain/dates';
import { cx, day, inrShort, tone } from '../format';
import { setSettings } from '../actions';
import { OwnerChips, useOwner } from '../owner';
import { D } from '../../domain/money';
import { isNative } from '../../platform/device';

const SEVERITY: Record<Insight['severity'], { icon: React.ElementType; cls: string }> = {
  ALERT: { icon: AlertTriangle, cls: 'text-error-600 bg-error-50 dark:bg-error-950' },
  WARN: { icon: AlertTriangle, cls: 'text-warning-600 bg-warning-50 dark:bg-warning-950' },
  TIP: { icon: Sparkles, cls: 'text-primary-600 bg-primary-50 dark:bg-primary-950' },
  GOOD: { icon: PartyPopper, cls: 'text-success-600 bg-success-50 dark:bg-success-950' },
};

const NetWorthChart: React.FC<{ series: { date: string; value: number }[] }> = ({ series }) => {
  const [hidden] = usePrivacy();
  if (series.length < 2) {
    return <p className="text-xs text-neutral-500 mt-3">Your net-worth history starts today. Open Finora now and then to build the chart.</p>;
  }
  const up = series[series.length - 1].value >= series[0].value;
  return (
    <div className="h-20 -mx-2 mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 4, bottom: 0, left: 0, right: 0 }}>
          <defs>
            <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={up ? '#16A34A' : '#DC2626'} stopOpacity={0.35} />
              <stop offset="100%" stopColor={up ? '#16A34A' : '#DC2626'} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          {!hidden && <Tooltip formatter={(v: number) => inrShort(v)} labelFormatter={(_, p) => (p?.[0] ? day(p[0].payload.date) : '')} />}
          <Area type="monotone" dataKey="value" stroke={up ? '#16A34A' : '#DC2626'} strokeWidth={2} fill="url(#nw)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export const HomePage: React.FC = () => {
  const data = useData();
  const store = useStore();
  const positions = usePositions();
  const navigate = useNavigate();
  const { ownerId } = useOwner();

  const nw = useMemo(() => netWorth(data, ownerId ?? undefined, positions), [data, ownerId, positions]);
  const series = useMemo(() => snapshotSeries(data, 180), [data]);
  const sts = useMemo(() => safeToSpend(data), [data]);
  const next = useMemo(() => upcoming(data, 7), [data]);
  const tips = useMemo(() => insights(data, positions, today(), { exportReminderDays: isNative() ? 30 : 7 }).slice(0, 4), [data, positions]);
  const self = live(data.owners).find(o => o.relation === 'SELF');
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const prev = series.length > 1 ? series.find(s => daysBetween(s.date, today()) <= 30) : undefined;
  const change = prev ? nw.netWorth.minus(prev.value) : null;

  const dismiss = (key: string) => setSettings(store, { dismissedInsights: [...data.settings.dismissedInsights.slice(-200), key] });

  return (
    <Screen
      title={`${greeting}${self && self.name !== 'Me' ? `, ${self.name}` : ''}`}
      actions={<>
        <IconButton label="Search" onClick={() => navigate('/search')}><Search size={20} /></IconButton>
        <PrivacyToggle />
        <IconButton label="Settings" onClick={() => navigate('/settings')}><SettingsIcon size={20} /></IconButton>
      </>}
    >
      <OwnerChips />

      <Panel className="p-5 bg-gradient-to-br from-primary-600 to-primary-800 text-white border-0">
        <div className="text-sm text-primary-100">Net worth</div>
        <div className="text-3xl font-bold mt-1"><Money value={nw.netWorth} /></div>
        {change && !change.isZero() && (
          <div className="text-xs mt-1 text-primary-100">
            <Money value={change} short signed /> in the last 30 days
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
          <div><div className="text-primary-200 text-xs">Investments</div><Money value={nw.assets} short className="font-semibold" /></div>
          <div><div className="text-primary-200 text-xs">Loans</div><Money value={nw.liabilities} short className="font-semibold" /></div>
        </div>
        <div className="[&_*]:!text-white"><NetWorthChart series={series} /></div>
      </Panel>

      <QuickAdd />

      <Panel className="p-4" onClick={() => navigate('/plan')}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-neutral-500">Safe to spend this month</div>
            {sts.income.isZero() ? (
              <div className="text-base font-semibold mt-1 text-primary-600">Add your income to see this</div>
            ) : (
              <div className={cx('text-2xl font-bold mt-0.5', sts.safe.lt(0) && 'text-error-600')}><Money value={sts.safe} /></div>
            )}
            {sts.perDay.gt(0) && <div className="text-xs text-neutral-500 mt-0.5">≈ <Money value={sts.perDay} /> a day for {sts.daysLeft} days</div>}
          </div>
          <ChevronRight className="text-neutral-400" size={20} />
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3">
          <Stat label={sts.incomeIsExpected ? 'Income (expected)' : 'Income'} value={<Money value={sts.income} short />} />
          <Stat label="EMIs, SIPs, bills" value={<Money value={sts.commitments} short />} />
          <Stat label="Spent" value={<Money value={sts.spent} short />} />
        </div>
        {sts.income.isZero() && <p className="text-xs text-neutral-500 mt-3">Add your salary as a regular income in Plan to see this.</p>}
      </Panel>

      {tips.length > 0 && (
        <Section title="For you">
          <div className="space-y-2">
            {tips.map(t => {
              const s = SEVERITY[t.severity];
              return (
                <Panel key={t.key} className="p-3 flex gap-3" onClick={t.route ? () => navigate(t.route!) : undefined}>
                  <div className={cx('h-9 w-9 shrink-0 rounded-full flex items-center justify-center', s.cls)}><s.icon size={18} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">{t.title}</div>
                    <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{t.body}</div>
                  </div>
                  <button aria-label="Dismiss" className="self-start text-neutral-400 p-1" onClick={e => { e.stopPropagation(); dismiss(t.key); }}><X size={16} /></button>
                </Panel>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Next 7 days" action={<button className="text-sm text-primary-600" onClick={() => navigate('/plan')}>Calendar</button>}>
        {next.length === 0 ? (
          <Panel className="p-4 text-sm text-neutral-500 flex gap-2 items-center"><CalendarClock size={18} /> Nothing due. Add EMIs, SIPs and bills to see them here.</Panel>
        ) : (
          <List>
            {next.map(i => (
              <Row
                key={`${i.kind}-${i.refId}-${i.date}`}
                title={i.title}
                subtitle={`${day(i.date, 'EEE, dd MMM')} · ${i.kind === 'EMI' ? 'EMI' : i.kind === 'SIP' ? 'SIP' : i.kind === 'INCOME' ? 'Income' : 'Bill'}`}
                trailing={<Money value={i.outflow ? i.amount.neg() : i.amount} className={tone(i.outflow ? D(-1) : D(1))} />}
              />
            ))}
          </List>
        )}
      </Section>

      {live(data.holdings).length === 0 && live(data.entries).length === 0 && (
        <Panel className="p-4 flex gap-3 items-start">
          <Info className="text-primary-600 shrink-0" size={20} />
          <div className="text-sm">
            <div className="font-semibold">Start in under a minute</div>
            <p className="text-neutral-500 mt-1">Import your CAMS/KFintech statement from Invest to load every mutual fund with its full history, or type an expense above.</p>
            <button className="mt-2 text-primary-600 font-medium" onClick={() => navigate('/invest/import')}>Import a statement</button>
          </div>
        </Panel>
      )}
    </Screen>
  );
};
