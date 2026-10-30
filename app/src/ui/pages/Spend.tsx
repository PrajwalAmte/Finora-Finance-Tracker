import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, FileUp, MessageSquareText, Plus, ScanText, Search, Wallet } from 'lucide-react';
import { Button } from '../components/Button';
import { PieChart } from '../components/PieChart';
import { Chip, Empty, IconButton, List, Money, Panel, PrivacyToggle, Row, Screen, Section, Stat, usePrivacy } from '../components/kit';
import { EntrySheet } from '../components/EntrySheet';
import { ScanSheet } from '../components/ScanSheet';
import { SmsReview } from '../components/CaptureReview';
import { SmsShortcutGuide } from '../components/ForwardedSms';
import { capabilities, platform } from '../../platform/device';
import { QuickAdd } from '../components/QuickAdd';
import { useData } from '../vault';
import { D, ZERO } from '../../domain/money';
import { addMonths, formatDay, monthKey, today } from '../../domain/dates';
import { live } from '../../domain/records';
import type { Entry } from '../../domain/types';
import { smsSupported } from '../../platform/capture';
import { day, tone } from '../format';

export default function SpendPage() {
  const data = useData();
  const navigate = useNavigate();
  const [hidden] = usePrivacy();
  const [month, setMonth] = useState(monthKey(today()));
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [adding, setAdding] = useState(false);
  const [scan, setScan] = useState(false);
  const [sms, setSms] = useState(false);

  const monthEntries = useMemo(() => live(data.entries).filter(e => monthKey(e.date) === month), [data.entries, month]);
  const spent = monthEntries.filter(e => e.kind === 'EXPENSE').reduce((s, e) => s.plus(D(e.amount)), ZERO);
  const income = monthEntries.filter(e => e.kind === 'INCOME').reduce((s, e) => s.plus(D(e.amount)), ZERO);
  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of monthEntries) if (e.kind === 'EXPENSE') m.set(e.category, (m.get(e.category) ?? 0) + D(e.amount).toNumber());
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [monthEntries]);

  const lastMonth = addMonths(`${month}-01`, -1).slice(0, 7);
  const lastSpent = live(data.entries).filter(e => e.kind === 'EXPENSE' && monthKey(e.date) === lastMonth).reduce((s, e) => s.plus(D(e.amount)), ZERO);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source = q ? live(data.entries) : monthEntries;
    return source
      .filter(e => (!category || e.category === category) && (!q || e.description.toLowerCase().includes(q) || e.category.toLowerCase().includes(q) || e.amount.includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [monthEntries, data.entries, category, query]);

  const byDay = useMemo(() => {
    const groups: [string, Entry[]][] = [];
    for (const e of shown) {
      const last = groups[groups.length - 1];
      if (last && last[0] === e.date) last[1].push(e); else groups.push([e.date, [e]]);
    }
    return groups;
  }, [shown]);

  const isCurrent = month === monthKey(today());

  return (
    <Screen title="Spend" actions={<>
      <IconButton label="Search" onClick={() => setSearching(s => !s)}><Search size={20} /></IconButton>
      <PrivacyToggle />
      <IconButton label="Add" onClick={() => setAdding(true)}><Plus size={22} /></IconButton>
    </>}>
      {searching && (
        <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search all entries" className="w-full h-11 px-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-[16px]" />
      )}
      <QuickAdd />

      <div className="flex items-center justify-between">
        <IconButton label="Previous month" onClick={() => setMonth(addMonths(`${month}-01`, -1).slice(0, 7))}><ChevronLeft size={20} /></IconButton>
        <div className="font-semibold">{formatDay(`${month}-01`, 'MMMM yyyy')}</div>
        <IconButton label="Next month" onClick={() => !isCurrent && setMonth(addMonths(`${month}-01`, 1).slice(0, 7))} className={isCurrent ? 'opacity-30' : ''}><ChevronRight size={20} /></IconButton>
      </div>

      <Panel className="p-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Spent" value={<Money value={spent} short />} sub={lastSpent.gt(0) ? <span className={tone(lastSpent.minus(spent))}>{spent.gt(lastSpent) ? '▲' : '▼'} {Math.abs(Math.round(spent.div(lastSpent).minus(1).times(100).toNumber()))}% vs last month</span> : undefined} />
          <Stat label="Income" value={<Money value={income} short />} />
          <Stat label="Saved" value={<Money value={income.minus(spent)} short className={tone(income.minus(spent))} />} />
        </div>
        {byCategory.length > 0 && <PieChart className="mt-4" data={byCategory.map(([name, value]) => ({ name, value }))} height={170} hideValues={hidden} />}
      </Panel>

      <div className={capabilities().scan ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-2 gap-2'}>
        {capabilities().scan && <Button variant="secondary" size="sm" iconLeft={<ScanText size={16} />} onClick={() => setScan(true)}>Screenshot</Button>}
        <Button variant="secondary" size="sm" iconLeft={<FileUp size={16} />} onClick={() => navigate('/spend/import')}>Statement</Button>
        {smsSupported() || platform() === 'ios' ? (
          <Button variant="secondary" size="sm" iconLeft={<MessageSquareText size={16} />} onClick={() => setSms(true)}>From SMS</Button>
        ) : (
          <Button variant="secondary" size="sm" iconLeft={<Plus size={16} />} onClick={() => setAdding(true)}>Manual</Button>
        )}
      </div>

      {byCategory.length > 1 && (
        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 no-scrollbar">
          <Chip active={!category} onClick={() => setCategory(null)}>All</Chip>
          {byCategory.map(([c]) => <Chip key={c} active={category === c} onClick={() => setCategory(category === c ? null : c)}>{c}</Chip>)}
        </div>
      )}

      {shown.length === 0 ? (
        <Empty icon={<Wallet />} title={query ? 'Nothing matches' : 'No entries this month'} body="Type one line above, scan a payment screenshot, or import your bank statement." />
      ) : (
        byDay.map(([date, entries]) => (
          <Section key={date} title={day(date, 'EEE, dd MMM')} action={<span className="text-xs text-neutral-500"><Money value={entries.filter(e => e.kind === 'EXPENSE').reduce((s, e) => s.plus(D(e.amount)), ZERO)} /></span>}>
            <List>
              {entries.map(e => (
                <Row key={e.id} onClick={() => setEditing(e)} title={e.description} subtitle={`${e.category} · ${e.paymentMethod}${e.source === 'SMS' ? ' · SMS' : e.source === 'OCR' ? ' · scanned' : ''}`}
                  trailing={<Money value={e.kind === 'INCOME' ? e.amount : D(e.amount).neg()} className={e.kind === 'INCOME' ? 'text-success-600' : ''} />} />
              ))}
            </List>
          </Section>
        ))
      )}

      <EntrySheet open={adding || !!editing} onClose={() => { setAdding(false); setEditing(null); }} entry={editing ?? undefined} />
      <ScanSheet open={scan} onClose={() => setScan(false)} />
      {smsSupported() && <SmsReview open={sms} onClose={() => setSms(false)} />}
      {platform() === 'ios' && <SmsShortcutGuide open={sms} onClose={() => setSms(false)} />}
    </Screen>
  );
}
