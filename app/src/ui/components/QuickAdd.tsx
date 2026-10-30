import React, { useMemo, useState } from 'react';
import { ArrowUp, Camera, Sparkles } from 'lucide-react';
import { parseQuickAdd } from '../../capture/quickAdd';
import { create } from '../../domain/records';
import { dec } from '../../domain/money';
import type { Entry } from '../../domain/types';
import { learn, suggestCategory } from '../../capture/categorize';
import { useData, useStore } from '../vault';
import { EntrySheet, type EntryDraft } from './EntrySheet';
import { ScanSheet } from './ScanSheet';
import { toast } from '../toast';
import { day, inr } from '../format';
import { capabilities, tap } from '../../platform/device';
import { SELF_OWNER_ID } from '../../vault/schema';

/**
 * One line to add an expense: "200 chai upi yesterday". Parsed on the phone as you type, with the
 * category suggested from your own history. Enter saves; tapping the preview opens the full form.
 */
export const QuickAdd: React.FC = () => {
  const data = useData();
  const store = useStore();
  const [text, setText] = useState('');
  const [sheet, setSheet] = useState<EntryDraft | null>(null);
  const [scan, setScan] = useState(false);

  const parsed = useMemo(() => (text.trim() ? parseQuickAdd(text) : null), [text]);
  const suggestion = useMemo(() => (parsed?.description ? suggestCategory(data, parsed.description, parsed.kind) : null), [parsed, data]);

  const commit = () => {
    if (!parsed) return;
    if (!parsed.amount || !parsed.description) {
      setSheet({ ...parsed, source: 'QUICK_ADD' });
      return;
    }
    const entry = create<Entry>({
      ownerId: SELF_OWNER_ID, kind: parsed.kind, date: parsed.date, amount: dec(parsed.amount), description: parsed.description,
      category: suggestion?.category ?? 'Other', paymentMethod: parsed.paymentMethod ?? suggestion?.paymentMethod ?? 'UPI', source: 'QUICK_ADD',
    });
    store.update(d => learn({ ...d, entries: [...d.entries, entry] }, entry.description, entry.category, entry.paymentMethod), 'Quick add');
    tap();
    toast.success(`${inr(entry.amount)} · ${entry.category}`, { label: 'Undo', onClick: () => store.undo() });
    setText('');
  };

  return (
    <div>
      <form onSubmit={e => { e.preventDefault(); commit(); }} className="flex items-center gap-2 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 pl-4 pr-1.5 h-14 shadow-sm">
        <Sparkles size={18} className="text-primary-500 shrink-0" />
        <input
          value={text} onChange={e => setText(e.target.value)} enterKeyHint="done"
          placeholder="200 chai upi yesterday"
          className="flex-1 min-w-0 bg-transparent outline-none text-[16px] placeholder:text-neutral-400"
          aria-label="Quick add an expense"
        />
        {text ? (
          <button type="submit" aria-label="Add" className="h-10 w-10 rounded-xl bg-primary-600 text-white flex items-center justify-center"><ArrowUp size={20} /></button>
        ) : capabilities().scan && (
          <button type="button" aria-label="Scan a payment screenshot" onClick={() => setScan(true)} className="h-10 w-10 rounded-xl text-neutral-500 flex items-center justify-center"><Camera size={20} /></button>
        )}
      </form>
      {parsed && (
        <button onClick={() => setSheet({ ...parsed, category: suggestion?.category, source: 'QUICK_ADD' })} className="mt-2 w-full text-left px-4 text-xs text-neutral-500 flex flex-wrap gap-x-2">
          <span className={parsed.kind === 'INCOME' ? 'text-success-600' : ''}>{parsed.kind === 'INCOME' ? 'Income' : 'Expense'}</span>
          <span>·</span><span className="font-medium text-neutral-700 dark:text-neutral-300">{parsed.amount ? inr(parsed.amount) : 'no amount yet'}</span>
          {parsed.description && <><span>·</span><span>{parsed.description}</span></>}
          {suggestion && <><span>·</span><span>{suggestion.category}{suggestion.learned ? ' (learned)' : ''}</span></>}
          <span>·</span><span>{day(parsed.date, 'dd MMM')}</span>
          {parsed.paymentMethod && <><span>·</span><span>{parsed.paymentMethod}</span></>}
          <span className="text-primary-600">Edit</span>
        </button>
      )}
      <EntrySheet open={!!sheet} onClose={() => { setSheet(null); setText(''); }} draft={sheet ?? undefined} />
      <ScanSheet open={scan} onClose={() => setScan(false)} />
    </div>
  );
};
