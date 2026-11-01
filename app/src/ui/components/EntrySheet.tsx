import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from './Button';
import { AmountField, DateField, SelectField, Segmented, Sheet, TextField } from './kit';
import { D, dec } from '../../domain/money';
import { today } from '../../domain/dates';
import { create, live, touch } from '../../domain/records';
import type { Entry, EntryKind, EntrySource } from '../../domain/types';
import { learn, suggestCategory } from '../../capture/categorize';
import { useData, useStore } from '../vault';
import { removeWithUndo } from '../actions';
import { toast } from '../toast';
import { tap } from '../../platform/device';
import { SELF_OWNER_ID } from '../../vault/schema';

export interface EntryDraft {
  kind?: EntryKind;
  amount?: string | null;
  date?: string;
  description?: string;
  category?: string;
  paymentMethod?: string;
  merchant?: string;
  source?: EntrySource;
  sourceRef?: string;
}

/** Add or edit an expense/income. Saving teaches the auto-categoriser this merchant's category. */
export const EntrySheet: React.FC<{ open: boolean; onClose: () => void; entry?: Entry; draft?: EntryDraft }> = ({ open, onClose, entry, draft }) => {
  const data = useData();
  const store = useStore();
  const [kind, setKind] = useState<EntryKind>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [method, setMethod] = useState('UPI');
  const [ownerId, setOwnerId] = useState(SELF_OWNER_ID);
  const [touchedCategory, setTouchedCategory] = useState(false);

  useEffect(() => {
    if (!open) return;
    const k = entry?.kind ?? draft?.kind ?? 'EXPENSE';
    setKind(k);
    setAmount(entry?.amount ?? draft?.amount ?? '');
    setDate(entry?.date ?? draft?.date ?? today());
    setDescription(entry?.description ?? draft?.description ?? '');
    setOwnerId(entry?.ownerId ?? SELF_OWNER_ID);
    const desc = entry?.description ?? draft?.description ?? '';
    const s = suggestCategory(data, draft?.merchant ?? desc, k);
    setCategory(entry?.category ?? draft?.category ?? s.category);
    setMethod(entry?.paymentMethod ?? draft?.paymentMethod ?? s.paymentMethod ?? 'UPI');
    setTouchedCategory(!!entry);
    // Only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry, draft]);

  // Re-suggest while the user types a description, until they pick a category themselves.
  useEffect(() => {
    if (!open || touchedCategory || !description) return;
    const s = suggestCategory(data, description, kind);
    setCategory(s.category);
    if (s.paymentMethod) setMethod(s.paymentMethod);
  }, [description, kind, open, touchedCategory, data]);

  const categories = kind === 'INCOME' ? data.settings.incomeCategories : data.settings.categories;
  const valid = D(amount).gt(0) && description.trim().length > 0 && !!date;

  const submit = () => {
    if (!valid) return;
    const fields = {
      kind, amount: dec(amount), date, description: description.trim(), category: category || categories[0],
      paymentMethod: method, ownerId,
    };
    store.update(d => {
      const rec = entry
        ? touch(entry, fields)
        : create<Entry>({ ...fields, merchant: draft?.merchant, source: draft?.source ?? 'MANUAL', sourceRef: draft?.sourceRef });
      const next = { ...d, entries: entry ? d.entries.map(e => (e.id === rec.id ? rec : e)) : [...d.entries, rec] };
      return learn(next, draft?.merchant ?? rec.description, rec.category, rec.paymentMethod);
    });
    tap();
    toast.success(entry ? 'Saved' : `${kind === 'INCOME' ? 'Income' : 'Expense'} added`);
    onClose();
  };

  return (
    <Sheet
      open={open} onClose={onClose} title={entry ? 'Edit' : kind === 'INCOME' ? 'Add income' : 'Add expense'}
      footer={
        <div className="flex gap-2">
          {entry && (
            <Button variant="ghost" className="text-error-600" iconLeft={<Trash2 size={18} />} onClick={() => { removeWithUndo(store, 'entries', entry.id, 'Entry deleted'); onClose(); }}>Delete</Button>
          )}
          <Button size="lg" className="flex-1" disabled={!valid} onClick={submit}>Save</Button>
        </div>
      }
    >
      <Segmented value={kind} onChange={k => { setKind(k); setTouchedCategory(false); }} options={[{ value: 'EXPENSE', label: 'Expense' }, { value: 'INCOME', label: 'Income' }]} />
      <AmountField label="Amount" value={amount} onChange={setAmount} autoFocus={!entry} />
      <TextField label="What for" value={description} onChange={setDescription} placeholder={kind === 'INCOME' ? 'Salary, refund…' : 'Swiggy, petrol, rent…'} />
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Category" value={category} onChange={v => { setCategory(v); setTouchedCategory(true); }} options={[...new Set([...categories, category])].filter(Boolean).map(c => ({ value: c, label: c }))} />
        <SelectField label="Paid with" value={method} onChange={setMethod} options={data.settings.paymentMethods.map(m => ({ value: m, label: m }))} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <DateField label="Date" value={date} onChange={setDate} max={today()} />
        {live(data.owners).length > 1 && (
          <SelectField label="Whose" value={ownerId} onChange={setOwnerId} options={live(data.owners).map(o => ({ value: o.id, label: o.name }))} />
        )}
      </div>
    </Sheet>
  );
};
