import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileUp } from 'lucide-react';
import { Button } from '../components/Button';
import { List, Money, Panel, Screen, SelectField } from '../components/kit';
import { pickFile } from '../../platform/device';
import { parseBankStatement } from '../../importers';
import { applyBankRows, prepareBankRows, type BankRow } from '../../importers/apply';
import { live } from '../../domain/records';
import { useData, useStore } from '../vault';
import { toast } from '../toast';
import { cx, day } from '../format';
import { SELF_OWNER_ID } from '../../vault/schema';

export default function ImportBankPage() {
  const data = useData();
  const store = useStore();
  const navigate = useNavigate();
  const [rows, setRows] = useState<BankRow[] | null>(null);
  const [include, setInclude] = useState<Set<number>>(new Set());
  const [bank, setBank] = useState<string | undefined>();
  const [method, setMethod] = useState('Net Banking');
  const [ownerId, setOwnerId] = useState(SELF_OWNER_ID);
  const [busy, setBusy] = useState(false);
  const [showIncome, setShowIncome] = useState(true);

  const choose = async () => {
    const f = await pickFile(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv', 'text/comma-separated-values', 'application/pdf']);
    if (!f) return;
    setBusy(true);
    try {
      const preview = await parseBankStatement(f.bytes);
      const prepared = prepareBankRows(store.get(), preview.transactions);
      setRows(prepared);
      setBank(preview.bankName);
      setInclude(new Set(prepared.map((r, i) => (r.duplicate ? -1 : i)).filter(i => i >= 0)));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setCategory = (i: number, category: string) => setRows(r => r && r.map((x, j) => (j === i ? { ...x, category, edited: true } : x)));

  const confirm = () => {
    if (!rows) return;
    const chosen = rows.filter((_, i) => include.has(i));
    const res = applyBankRows(store.get(), chosen, { ownerId, paymentMethod: method });
    store.update(() => res.data, 'Bank import');
    toast.success(`${res.added} entries imported`, { label: 'Undo', onClick: () => store.undo() });
    navigate('/spend', { replace: true });
  };

  const visible = rows?.map((r, i) => [r, i] as const).filter(([r]) => showIncome || r.kind === 'EXPENSE') ?? [];

  return (
    <Screen title="Import bank statement" back>
      {!rows ? (
        <>
          <Panel className="p-4 text-sm text-neutral-600 dark:text-neutral-400">
            Download your statement as <b>Excel or CSV</b> from net banking (HDFC, ICICI, SBI, Axis, Kotak and most others work). It is read on this phone; categories come from your own past choices.
          </Panel>
          <Button size="lg" fullWidth iconLeft={<FileUp size={18} />} isLoading={busy} onClick={choose}>Choose statement</Button>
        </>
      ) : (
        <>
          <Panel className="p-4 text-sm">
            <div className="font-semibold">{bank ? `${bank} statement` : 'Bank statement'}: {rows.length} transactions</div>
            <div className="text-neutral-500">{rows.filter(r => r.duplicate).length} look like ones you already have and are unticked.</div>
          </Panel>
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Paid with" value={method} onChange={setMethod} options={data.settings.paymentMethods.map(m => ({ value: m, label: m }))} />
            {live(data.owners).length > 1 ? (
              <SelectField label="Account of" value={ownerId} onChange={setOwnerId} options={live(data.owners).map(o => ({ value: o.id, label: o.name }))} />
            ) : (
              <SelectField label="Show" value={showIncome ? 'all' : 'exp'} onChange={v => setShowIncome(v === 'all')} options={[{ value: 'all', label: 'Everything' }, { value: 'exp', label: 'Only debits' }]} />
            )}
          </div>
          <List>
            {visible.map(([r, i]) => (
              <div key={i} className={cx('flex items-center gap-3 px-4 py-3', !include.has(i) && 'opacity-50')}>
                <input type="checkbox" className="h-5 w-5 accent-primary-600" checked={include.has(i)} onChange={() => setInclude(s => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{r.narration || '—'}</div>
                  <div className="text-xs text-neutral-500 flex items-center gap-2">
                    {day(r.date, 'dd MMM')}
                    <select value={r.category} onChange={e => setCategory(i, e.target.value)} className="bg-transparent text-primary-600 text-xs dark:[color-scheme:dark]">
                      {(r.kind === 'INCOME' ? data.settings.incomeCategories : data.settings.categories).concat(r.category).filter((c, j, a) => a.indexOf(c) === j).map(c => <option key={c}>{c}</option>)}
                    </select>
                    {r.duplicate && <span className="text-warning-600">duplicate?</span>}
                  </div>
                </div>
                <Money value={r.amount} className={cx('text-sm font-medium', r.kind === 'INCOME' && 'text-success-600')} />
              </div>
            ))}
          </List>
          <Button size="lg" fullWidth disabled={include.size === 0} onClick={confirm}>Import {include.size}</Button>
        </>
      )}
    </Screen>
  );
}
