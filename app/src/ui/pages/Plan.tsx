import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Target, Trash2 } from 'lucide-react';
import { Button } from '../components/Button';
import { HeroCard, AmountField, DateField, List, Money, Panel, PrivacyToggle, Row, Screen, Section, Segmented, SelectField, Sheet, Stat, TextField, Toggle } from '../components/kit';
import { useData, usePositions, useStore } from '../vault';
import { D, dec } from '../../domain/money';
import { addMonths, today } from '../../domain/dates';
import { create, live, touch } from '../../domain/records';
import { safeToSpend, upcoming } from '../../domain/planner/calendar';
import { goalProgress } from '../../domain/planner/goals';
import type { EntryKind, Goal, Recurring } from '../../domain/types';
import { removeWithUndo, setSettings } from '../actions';
import { cx, day } from '../format';
import { calendarVisual, categoryVisual, rowIcon } from '../visuals';
import { toast } from '../toast';

const RecurringSheet: React.FC<{ open: boolean; onClose: () => void; item?: Recurring }> = ({ open, onClose, item }) => {
  const data = useData();
  const store = useStore();
  const [kind, setKind] = useState<EntryKind>('EXPENSE');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [dayOfMonth, setDay] = useState('1');
  const [category, setCategory] = useState('');
  const [active, setActive] = useState(true);
  useEffect(() => {
    if (!open) return;
    setKind(item?.kind ?? 'EXPENSE'); setName(item?.name ?? ''); setAmount(item?.amount ?? ''); setDay(String(item?.dayOfMonth ?? 1));
    setCategory(item?.category ?? ''); setActive(item?.active ?? true);
  }, [open, item]);
  const cats = kind === 'INCOME' ? data.settings.incomeCategories : data.settings.categories;
  const valid = name.trim() && D(amount).gt(0) && Number(dayOfMonth) >= 1 && Number(dayOfMonth) <= 31;
  const submit = () => {
    const fields = { kind, name: name.trim(), amount: dec(amount), dayOfMonth: Number(dayOfMonth), category: category || cats[0], active };
    store.update(d => ({ ...d, recurring: item ? d.recurring.map(r => (r.id === item.id ? touch(r, fields) : r)) : [...d.recurring, create<Recurring>(fields)] }));
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={item ? 'Edit regular payment' : 'Regular income or bill'} footer={<div className="flex gap-2">
      {item && <Button variant="ghost" className="text-error-600" iconLeft={<Trash2 size={18} />} onClick={() => { removeWithUndo(store, 'recurring', item.id, 'Removed'); onClose(); }}>Delete</Button>}
      <Button size="lg" className="flex-1" disabled={!valid} onClick={submit}>Save</Button>
    </div>}>
      <Segmented value={kind} onChange={setKind} options={[{ value: 'EXPENSE', label: 'Bill' }, { value: 'INCOME', label: 'Income' }]} />
      <TextField label="Name" value={name} onChange={setName} placeholder={kind === 'INCOME' ? 'Salary' : 'Rent, electricity, Netflix…'} />
      <div className="grid grid-cols-2 gap-3">
        <AmountField label="Amount" value={amount} onChange={setAmount} />
        <TextField label="Day of month" inputMode="numeric" value={dayOfMonth} onChange={v => setDay(v.replace(/\D/g, '').slice(0, 2))} />
      </div>
      <SelectField label="Category" value={category || cats[0]} onChange={setCategory} options={cats.map(c => ({ value: c, label: c }))} />
      <div className="-mx-4"><Toggle checked={active} onChange={setActive} label="Active" /></div>
    </Sheet>
  );
};

const GoalSheet: React.FC<{ open: boolean; onClose: () => void; goal?: Goal }> = ({ open, onClose, goal }) => {
  const data = useData();
  const store = useStore();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [date, setDate] = useState(addMonths(today(), 60));
  const [inflation, setInflation] = useState('6');
  const [ret, setRet] = useState('11');
  const [holdingIds, setHoldings] = useState<string[]>([]);
  const [sipIds, setSips] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    setName(goal?.name ?? ''); setTarget(goal?.targetAmount ?? ''); setDate(goal?.targetDate ?? addMonths(today(), 60));
    setInflation(goal?.inflationPct ?? '6'); setRet(goal?.expectedReturnPct ?? '11'); setHoldings(goal?.holdingIds ?? []); setSips(goal?.sipIds ?? []);
  }, [open, goal]);
  const toggle = (list: string[], setList: (v: string[]) => void, id: string) => setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const valid = name.trim() && D(target).gt(0) && date > today();
  const submit = () => {
    const fields = { name: name.trim(), targetAmount: dec(target), targetDate: date, inflationPct: inflation || '0', expectedReturnPct: ret || '0', holdingIds, sipIds };
    store.update(d => ({ ...d, goals: goal ? d.goals.map(g => (g.id === goal.id ? touch(g, fields) : g)) : [...d.goals, create<Goal>(fields)] }));
    toast.success('Goal saved');
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={goal ? 'Edit goal' : 'New goal'} footer={<div className="flex gap-2">
      {goal && <Button variant="ghost" className="text-error-600" iconLeft={<Trash2 size={18} />} onClick={() => { removeWithUndo(store, 'goals', goal.id, 'Goal deleted'); onClose(); }}>Delete</Button>}
      <Button size="lg" className="flex-1" disabled={!valid} onClick={submit}>Save</Button>
    </div>}>
      <TextField label="Goal" value={name} onChange={setName} placeholder="House down payment, retirement, child’s education…" />
      <div className="grid grid-cols-2 gap-3">
        <AmountField label="Cost in today’s money" value={target} onChange={setTarget} />
        <DateField label="By" value={date} onChange={setDate} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <AmountField label="Inflation (% a year)" value={inflation} onChange={setInflation} prefix="" />
        <AmountField label="Expected return (%)" value={ret} onChange={setRet} prefix="" />
      </div>
      <div>
        <div className="text-sm font-medium mb-2">Investments set aside for this</div>
        <div className="flex flex-wrap gap-2">
          {live(data.holdings).map(h => (
            <button key={h.id} onClick={() => toggle(holdingIds, setHoldings, h.id)} className={cx('px-3 h-8 rounded-full text-xs border', holdingIds.includes(h.id) ? 'bg-primary-600 text-white border-primary-600' : 'border-neutral-300 dark:border-neutral-700')}>{h.name}</button>
          ))}
          {live(data.holdings).length === 0 && <span className="text-xs text-neutral-500">Add investments first.</span>}
        </div>
      </div>
      {live(data.sips).length > 0 && (
        <div>
          <div className="text-sm font-medium mb-2">SIPs that feed it</div>
          <div className="flex flex-wrap gap-2">
            {live(data.sips).map(s => (
              <button key={s.id} onClick={() => toggle(sipIds, setSips, s.id)} className={cx('px-3 h-8 rounded-full text-xs border', sipIds.includes(s.id) ? 'bg-primary-600 text-white border-primary-600' : 'border-neutral-300 dark:border-neutral-700')}>{s.name}</button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
};

export default function PlanPage() {
  const data = useData();
  const store = useStore();
  const positions = usePositions();
  const [range, setRange] = useState<'30' | '90'>('30');
  const [recurring, setRecurring] = useState<{ item?: Recurring } | null>(null);
  const [goal, setGoal] = useState<{ goal?: Goal } | null>(null);
  const sts = useMemo(() => safeToSpend(data), [data]);
  const items = useMemo(() => upcoming(data, Number(range)), [data, range]);
  const goals = useMemo(() => live(data.goals).map(g => goalProgress(g, positions, data.sips)), [data.goals, data.sips, positions]);
  const outflow = items.filter(i => i.outflow).reduce((s, i) => s.plus(i.amount), D(0));
  const inflow = items.filter(i => !i.outflow).reduce((s, i) => s.plus(i.amount), D(0));

  return (
    <Screen title="Plan" actions={<PrivacyToggle />}>
      <HeroCard>
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400">Safe to spend · {sts.daysLeft} days left this month</div>
        <div className={cx('font-display text-[36px] leading-tight font-extrabold tracking-[-0.03em] mt-1', sts.safe.lt(0) ? 'text-error-500' : '')}><Money value={sts.safe} animate /></div>
        <div className="mt-3 space-y-1.5 text-sm">
          {[
            [sts.incomeIsExpected ? 'Income (expected)' : 'Income', sts.income, false],
            ['EMIs, SIPs and bills this month', sts.commitments, true],
            ['Spent so far', sts.spent, true],
            ['Savings target', sts.savingsTarget, true],
          ].map(([label, v, minus]) => (
            <div key={label as string} className="flex justify-between"><span className="text-neutral-500 dark:text-neutral-400">{label as string}</span><span className="num font-semibold">{minus ? '− ' : ''}<Money value={v as never} /></span></div>
          ))}
        </div>
      </HeroCard>

      <Panel className="p-4">
        <AmountField label="Monthly savings target" value={data.settings.monthlySavingsTarget === '0' ? '' : data.settings.monthlySavingsTarget} onChange={v => setSettings(store, { monthlySavingsTarget: v || '0' })} hint="Kept aside before anything counts as safe to spend." />
      </Panel>

      <Section title="Money calendar" action={<div className="w-36"><Segmented value={range} onChange={setRange} options={[{ value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} /></div>}>
        <Panel className="p-3 grid grid-cols-2 gap-3 mb-2">
          <Stat label="Going out" value={<Money value={outflow} short />} />
          <Stat label="Coming in" value={<Money value={inflow} short className="text-success-600" />} />
        </Panel>
        {items.length === 0 ? (
          <Panel className="p-4 text-sm text-neutral-500">Nothing scheduled. Add loans, SIPs, or regular bills and income below.</Panel>
        ) : (
          <List>
            {items.map(i => (
              <Row key={`${i.kind}-${i.refId}-${i.date}`} {...rowIcon(calendarVisual(i.kind))} title={i.title} subtitle={`${day(i.date, 'EEE dd MMM')} · ${{ EMI: 'EMI', SIP: 'SIP', BILL: 'Bill', INCOME: 'Income' }[i.kind]}`}
                trailing={<Money value={i.outflow ? i.amount.neg() : i.amount} className={i.outflow ? '' : 'text-success-600'} />} />
            ))}
          </List>
        )}
      </Section>

      <Section title="Regular income and bills" action={<button className="text-sm text-primary-600" onClick={() => setRecurring({})}>Add</button>}>
        {live(data.recurring).length === 0 ? (
          <Panel className="p-4 text-sm text-neutral-500">Add your salary and fixed bills (rent, school fees, subscriptions) so the calendar and safe-to-spend are complete.</Panel>
        ) : (
          <List>
            {live(data.recurring).map(r => (
              <Row key={r.id} onClick={() => setRecurring({ item: r })} {...rowIcon(categoryVisual(r.category, r.kind === 'INCOME'))} title={r.name} subtitle={`Day ${r.dayOfMonth} · ${r.category}${r.active ? '' : ' · paused'}`} trailing={<Money value={r.amount} className={r.kind === 'INCOME' ? 'text-success-600' : ''} />} />
            ))}
          </List>
        )}
      </Section>

      <Section title="Goals" action={<button className="text-sm text-primary-600 inline-flex items-center gap-1" onClick={() => setGoal({})}><Plus size={14} /> New</button>}>
        {goals.length === 0 ? (
          <Panel className="p-4 text-sm text-neutral-500 flex gap-2"><Target size={18} className="shrink-0" /> Link real investments and SIPs to a goal to see if you are on track, after inflation.</Panel>
        ) : (
          <div className="space-y-2">
            {goals.map(g => (
              <Panel key={g.goal.id} className="p-4" onClick={() => setGoal({ goal: g.goal })}>
                <div className="flex justify-between items-baseline">
                  <div className="font-semibold">{g.goal.name}</div>
                  <div className={cx('text-xs font-medium', g.onTrack ? 'text-success-600' : 'text-warning-600')}>{g.onTrack ? 'On track' : 'Behind'}</div>
                </div>
                <div className="text-xs text-neutral-500 mt-0.5">Needs <Money value={g.futureTarget} short /> by {day(g.goal.targetDate, 'MMM yyyy')} (incl. {g.goal.inflationPct}% inflation)</div>
                <div className="h-2 rounded-full bg-neutral-200 dark:bg-neutral-800 mt-3 overflow-hidden"><div className={cx('h-full', g.onTrack ? 'bg-success-500' : 'bg-primary-500')} style={{ width: `${g.progressPct}%` }} /></div>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <Stat label="Have" value={<Money value={g.currentValue} short />} />
                  <Stat label="Projected" value={<Money value={g.projected} short />} />
                  <Stat label={g.onTrack ? 'Surplus' : 'Add a month'} value={g.onTrack ? <Money value={g.projected.minus(g.futureTarget)} short /> : <Money value={g.extraMonthly} short />} />
                </div>
              </Panel>
            ))}
          </div>
        )}
      </Section>

      <RecurringSheet open={!!recurring} onClose={() => setRecurring(null)} item={recurring?.item} />
      <GoalSheet open={!!goal} onClose={() => setGoal(null)} goal={goal?.goal} />
    </Screen>
  );
}
