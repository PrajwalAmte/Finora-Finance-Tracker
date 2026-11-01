import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarClock, ChevronRight, FileUp, PartyPopper, Search, Settings as SettingsIcon, Sparkles, X } from 'lucide-react';
import { HeroCard, IconButton, List, Money, Panel, PrivacyToggle, Row, Screen, Section, usePrivacy } from '../components/kit';
import { QuickAdd } from '../components/QuickAdd';
import { Button } from '../components/Button';
import { useData, usePositions, useStore } from '../vault';
import { netWorth, snapshotSeries } from '../../domain/networth';
import { safeToSpend, upcoming } from '../../domain/planner/calendar';
import { insights, type Insight } from '../../domain/insights';
import { live } from '../../domain/records';
import { daysBetween, today } from '../../domain/dates';
import { cx, day, inrShort } from '../format';
import { setSettings } from '../actions';
import { OwnerChips, useOwner } from '../owner';
import { isNative } from '../../platform/device';
import { calendarVisual, rowIcon } from '../visuals';
import { SyncBadge } from '../components/CloudVault';

const SEVERITY: Record<Insight['severity'], { icon: React.ElementType; tile: string; label: string }> = {
  ALERT: { icon: AlertTriangle, tile: 'bg-error-100 text-error-600 dark:bg-error-400/15 dark:text-error-300', label: 'Needs attention' },
  WARN: { icon: AlertTriangle, tile: 'bg-warning-100 text-warning-700 dark:bg-warning-400/15 dark:text-warning-300', label: 'Heads up' },
  TIP: { icon: Sparkles, tile: 'bg-primary-100 text-primary-700 dark:bg-primary-400/15 dark:text-primary-200', label: 'Tip' },
  GOOD: { icon: PartyPopper, tile: 'bg-success-100 text-success-700 dark:bg-success-400/15 dark:text-success-300', label: 'Good news' },
};

/** Net-worth sparkline inside the hero card. */
const NetWorthChart: React.FC<{ series: { date: string; value: number }[] }> = ({ series }) => {
  const [hidden] = usePrivacy();
  if (series.length < 2) {
    return <p className="text-[12px] text-neutral-500 dark:text-neutral-400 mt-4">Your net-worth history starts today. Open Finora now and then to grow this chart.</p>;
  }
  return (
    <div className="h-24 -mx-5 -mb-5 mt-3">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 6, bottom: 0, left: 0, right: 0 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          {!hidden && (
            <Tooltip
              cursor={{ stroke: 'rgba(116,102,241,0.3)' }}
              contentStyle={{ background: '#1c1c22', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#fff', fontSize: 12 }}
              formatter={(v: number) => [inrShort(v), 'Net worth']}
              labelFormatter={(_, p) => (p?.[0] ? day(p[0].payload.date) : '')}
            />
          )}
          <Area type="monotone" dataKey="value" stroke="#7466F1" strokeWidth={2} fill="#7466F1" fillOpacity={0.08} isAnimationActive={false} />
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
  const greeting = hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 17 ? 'Good afternoon' : 'Good evening';
  const prev = series.length > 1 ? series.find(s => daysBetween(s.date, today()) <= 30) : undefined;
  const change = prev ? nw.netWorth.minus(prev.value) : null;
  const empty = live(data.holdings).length === 0 && live(data.entries).length === 0 && live(data.loans).length === 0;
  const spentShare = sts.income.gt(0) ? Math.min(100, sts.commitments.plus(sts.spent).div(sts.income).times(100).toNumber()) : 0;

  const dismiss = (key: string) => setSettings(store, { dismissedInsights: [...data.settings.dismissedInsights.slice(-200), key] });

  return (
    <Screen
      eyebrow={greeting}
      title={self && self.name !== 'Me' ? self.name : 'Your money'}
      actions={<>
        <SyncBadge onClick={() => navigate('/settings')} />
        <IconButton label="Search" onClick={() => navigate('/search')}><Search size={19} /></IconButton>
        <PrivacyToggle />
        <IconButton label="Settings" onClick={() => navigate('/settings')}><SettingsIcon size={19} /></IconButton>
      </>}
    >
      <OwnerChips />

      <HeroCard>
        <div className="flex items-center justify-between">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400">Net worth</div>
          {change && !change.isZero() && (
            <div className={cx('flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold', change.gt(0) ? 'bg-success-50 text-success-700 dark:bg-success-400/15 dark:text-success-300' : 'bg-error-50 text-error-600 dark:bg-error-400/15 dark:text-error-300')}>
              {change.gt(0) ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
              <Money value={change.abs()} short /> <span className="opacity-60 font-medium">30d</span>
            </div>
          )}
        </div>
        <div className="font-display text-[40px] leading-none font-extrabold tracking-[-0.03em] mt-3">
          <Money value={nw.netWorth} animate />
        </div>
        <div className="grid grid-cols-2 gap-4 mt-5">
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400 font-semibold">Investments</div>
            <Money value={nw.assets} short className="font-display text-lg font-bold" />
          </div>
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400 font-semibold">Loans</div>
            <Money value={nw.liabilities} short className="font-display text-lg font-bold" />
          </div>
        </div>
        <NetWorthChart series={series} />
      </HeroCard>

      <QuickAdd />

      <Panel className="p-5 animate-rise" onClick={() => navigate('/plan')}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-neutral-500 dark:text-neutral-400">Safe to spend · {sts.daysLeft} days left</div>
            {sts.income.isZero() ? (
              <div className="font-display text-lg font-bold mt-1.5 text-primary-600">Add your income to see this</div>
            ) : (
              <div className={cx('font-display text-[30px] font-extrabold tracking-[-0.02em] mt-1', sts.safe.lt(0) && 'text-error-500')}><Money value={sts.safe} animate /></div>
            )}
            {sts.perDay.gt(0) && <div className="text-[12.5px] text-neutral-500 dark:text-neutral-400 mt-0.5">≈ <Money value={sts.perDay} /> a day</div>}
          </div>
          <ChevronRight className="text-neutral-400 mt-1" size={20} />
        </div>
        {sts.income.gt(0) && (
          <div className="mt-4">
            <div className="h-2 rounded-full bg-neutral-100 dark:bg-white/[0.06] overflow-hidden">
              <div className={cx('h-full rounded-full transition-all duration-700', spentShare > 90 ? 'bg-error-400' : 'bg-primary-500')} style={{ width: `${spentShare}%` }} />
            </div>
            <div className="flex justify-between text-[11.5px] text-neutral-500 dark:text-neutral-400 mt-2 num">
              <span>Commitments <Money value={sts.commitments} short /> · Spent <Money value={sts.spent} short /></span>
              <span>of <Money value={sts.income} short /></span>
            </div>
          </div>
        )}
      </Panel>

      {tips.length > 0 && (
        <Section title="For you">
          <div className="flex gap-3 overflow-x-auto -mx-4 px-4 pb-1 no-scrollbar snap-x snap-mandatory">
            {tips.map(t => {
              const s = SEVERITY[t.severity];
              return (
                <Panel key={t.key} className="snap-start shrink-0 w-[78%] max-w-[320px] p-4 flex flex-col" onClick={t.route ? () => navigate(t.route!) : undefined}>
                  <div className="flex items-start justify-between">
                    <div className={cx('h-10 w-10 rounded-2xl flex items-center justify-center', s.tile)}><s.icon size={18} /></div>
                    <button aria-label="Dismiss" className="text-neutral-400 p-1 -m-1" onClick={e => { e.stopPropagation(); dismiss(t.key); }}><X size={16} /></button>
                  </div>
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400 mt-3">{s.label}</div>
                  <div className="text-[15px] font-bold mt-1 leading-snug">{t.title}</div>
                  <div className="text-[12.5px] text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">{t.body}</div>
                </Panel>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Next 7 days" action={<button className="text-[13px] font-semibold text-primary-600" onClick={() => navigate('/plan')}>Calendar</button>}>
        {next.length === 0 ? (
          <Panel className="p-4 text-sm text-neutral-500 dark:text-neutral-400 flex gap-3 items-center"><CalendarClock size={18} className="shrink-0" /> Nothing due. EMIs, SIPs and bills you add show up here.</Panel>
        ) : (
          <List>
            {next.map(i => (
              <Row
                key={`${i.kind}-${i.refId}-${i.date}`}
                {...rowIcon(calendarVisual(i.kind))}
                title={i.title}
                subtitle={`${day(i.date, 'EEE, dd MMM')} · ${i.kind === 'EMI' ? 'EMI' : i.kind === 'SIP' ? 'SIP' : i.kind === 'INCOME' ? 'Income' : 'Bill'}`}
                trailing={<Money value={i.outflow ? i.amount.neg() : i.amount} className={i.outflow ? '' : 'text-success-600 dark:text-success-400'} />}
              />
            ))}
          </List>
        )}
      </Section>

      {empty && (
        <Panel className="p-5 animate-rise">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-primary-600">Start here</div>
          <div className="font-display text-xl font-extrabold mt-1">Load everything in a minute</div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1.5 leading-relaxed">Import your CAMS or KFintech statement and every mutual fund arrives with its full history, returns and tax lots.</p>
          <Button className="mt-4" iconLeft={<FileUp size={18} />} onClick={() => navigate('/invest/import')}>Import a statement</Button>
        </Panel>
      )}
    </Screen>
  );
};
