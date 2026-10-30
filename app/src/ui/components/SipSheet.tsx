import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from './Button';
import { AmountField, DateField, SelectField, Sheet, TextField, Toggle } from './kit';
import { D, dec } from '../../domain/money';
import { addDays, today } from '../../domain/dates';
import { create, live, touch } from '../../domain/records';
import type { Sip, SipStatus } from '../../domain/types';
import { useData, useStore } from '../vault';
import { removeWithUndo } from '../actions';
import { toast } from '../toast';
import { SELF_OWNER_ID } from '../../vault/schema';

export const SipSheet: React.FC<{ open: boolean; onClose: () => void; sip?: Sip; holdingId?: string }> = ({ open, onClose, sip, holdingId }) => {
  const data = useData();
  const store = useStore();
  const funds = live(data.holdings).filter(h => h.type === 'MUTUAL_FUND' || h.type === 'ETF' || h.type === 'STOCK');
  const [name, setName] = useState('');
  const [hid, setHid] = useState('');
  const [amount, setAmount] = useState('');
  const [dayOfMonth, setDay] = useState('5');
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState('');
  const [status, setStatus] = useState<SipStatus>('ACTIVE');
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    if (!open) return;
    const h = funds.find(f => f.id === (sip?.holdingId ?? holdingId));
    setName(sip?.name ?? h?.name ?? '');
    setHid(sip?.holdingId ?? holdingId ?? '');
    setAmount(sip?.amount ?? '');
    setDay(String(sip?.dayOfMonth ?? 5));
    setStart(sip?.startDate ?? today());
    setEnd(sip?.endDate ?? '');
    setStatus(sip?.status ?? 'ACTIVE');
    setAuto(sip?.autoRecord ?? true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sip, holdingId]);

  const valid = name.trim() && D(amount).gt(0) && Number(dayOfMonth) >= 1 && Number(dayOfMonth) <= 31;

  const submit = () => {
    if (!valid) return;
    const fields = {
      name: name.trim(), holdingId: hid || undefined, amount: dec(amount), dayOfMonth: Number(dayOfMonth), startDate: start,
      endDate: end || undefined, status, autoRecord: auto,
      ownerId: funds.find(f => f.id === hid)?.ownerId ?? sip?.ownerId ?? SELF_OWNER_ID,
    };
    if (sip) {
      store.update(d => ({ ...d, sips: d.sips.map(s => (s.id === sip.id ? touch(s, fields) : s)) }));
    } else {
      // Installments before today are assumed already in the fund's history; only future ones are auto-recorded.
      const rec = create<Sip>({ ...fields, lastInstallment: start < today() ? addDays(today(), -1) : undefined });
      store.update(d => ({ ...d, sips: [...d.sips, rec] }));
    }
    toast.success(sip ? 'SIP saved' : 'SIP added');
    onClose();
  };

  return (
    <Sheet
      open={open} onClose={onClose} title={sip ? 'Edit SIP' : 'New SIP'}
      footer={
        <div className="flex gap-2">
          {sip && <Button variant="ghost" className="text-error-600" iconLeft={<Trash2 size={18} />} onClick={() => { removeWithUndo(store, 'sips', sip.id, 'SIP deleted'); onClose(); }}>Delete</Button>}
          <Button size="lg" className="flex-1" disabled={!valid} onClick={submit}>Save</Button>
        </div>
      }
    >
      <SelectField label="Invests into" value={hid} onChange={v => { setHid(v); const h = funds.find(f => f.id === v); if (h && !name) setName(h.name); }} options={[{ value: '', label: 'Not linked yet' }, ...funds.map(f => ({ value: f.id, label: f.name }))]} hint="Link the fund so installments update your holding and returns." />
      <TextField label="Name" value={name} onChange={setName} />
      <div className="grid grid-cols-2 gap-3">
        <AmountField label="Monthly amount" value={amount} onChange={setAmount} />
        <TextField label="Debit day" inputMode="numeric" value={dayOfMonth} onChange={v => setDay(v.replace(/\D/g, '').slice(0, 2))} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <DateField label="Started" value={start} onChange={setStart} />
        <DateField label="Ends (optional)" value={end} onChange={setEnd} />
      </div>
      <SelectField label="Status" value={status} onChange={v => setStatus(v as SipStatus)} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'PAUSED', label: 'Paused' }, { value: 'STOPPED', label: 'Stopped' }]} />
      <div className="-mx-4"><Toggle checked={auto} onChange={setAuto} label="Record installments automatically" description="Adds each installment at the latest NAV. A statement import later replaces it with the exact units." /></div>
    </Sheet>
  );
};
