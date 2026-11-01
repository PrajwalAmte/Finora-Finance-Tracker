import React, { useEffect, useState } from 'react';
import { CheckSquare, MessageSquareText, Square } from 'lucide-react';
import { Button } from './Button';
import { List, Money, Row, Sheet } from './kit';
import { create, live, upsertMany } from '../../domain/records';
import { daysBetween } from '../../domain/dates';
import type { Entry } from '../../domain/types';
import { learn, suggestCategory } from '../../capture/categorize';
import { parseBankSms, type CapturedTxn } from '../../capture/textParsers';
import { readSms, requestSmsPermission } from '../../platform/capture';
import { useData, useStore } from '../vault';
import { setSettings } from '../actions';
import { day } from '../format';
import { toast } from '../toast';
import { SELF_OWNER_ID } from '../../vault/schema';

/**
 * Android only: read bank/UPI SMS on the phone, show what was found, and add the ones the user keeps.
 * Messages are parsed in memory and never stored; only the resulting expense is saved.
 */
export const SmsReview: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const data = useData();
  const store = useStore();
  const [found, setFound] = useState<(CapturedTxn & { category: string })[]>([]);
  const [keep, setKeep] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [newest, setNewest] = useState(0);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setBusy(true);
      try {
        if (!(await requestSmsPermission())) {
          toast.error('SMS permission was not granted');
          onClose();
          return;
        }
        const since = data.settings.lastSmsScanAt ?? Date.now() - 45 * 86400_000;
        const messages = await readSms(since);
        const existing = live(data.entries);
        const refs = new Set(existing.map(e => e.sourceRef));
        const out: (CapturedTxn & { category: string })[] = [];
        for (const m of messages) {
          const t = parseBankSms(m.body, m.address, m.date);
          if (!t || refs.has(t.sourceRef)) continue;
          // Same amount on the same day already entered by hand or from a screenshot: probably the same payment.
          if (existing.some(e => e.amount === t.amount && e.kind === t.kind && Math.abs(daysBetween(e.date, t.date)) <= 1)) continue;
          refs.add(t.sourceRef);
          out.push({ ...t, category: suggestCategory(data, t.merchant, t.kind).category });
        }
        setFound(out);
        setKeep(new Set(out.map((_, i) => i)));
        setNewest(messages.reduce((m, x) => Math.max(m, x.date), since));
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const add = () => {
    const entries = found.filter((_, i) => keep.has(i)).map(t => create<Entry>({
      id: t.sourceRef, ownerId: SELF_OWNER_ID, kind: t.kind, date: t.date, amount: t.amount, description: t.merchant,
      merchant: t.merchant, category: t.category, paymentMethod: t.paymentMethod, source: 'SMS', sourceRef: t.sourceRef,
    }));
    store.update(d => {
      let next = { ...d, entries: upsertMany(d.entries, entries) };
      for (const e of entries) next = learn(next, e.merchant ?? e.description, e.category, e.paymentMethod);
      return next;
    }, 'SMS import');
    if (newest) setSettings(store, { lastSmsScanAt: newest });
    toast.success(`${entries.length} transaction${entries.length === 1 ? '' : 's'} added from SMS`, { label: 'Undo', onClick: () => store.undo() });
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Transactions from SMS" footer={found.length > 0 && <Button size="lg" fullWidth onClick={add} disabled={keep.size === 0}>Add {keep.size}</Button>}>
      {busy ? (
        <p className="text-sm text-neutral-500 py-6 text-center">Reading bank messages on this phone…</p>
      ) : found.length === 0 ? (
        <div className="text-center py-6 text-sm text-neutral-500"><MessageSquareText className="mx-auto mb-2" />No new bank transactions since the last check.</div>
      ) : (
        <List>
          {found.map((t, i) => (
            <Row
              key={t.sourceRef}
              onClick={() => setKeep(k => { const n = new Set(k); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
              icon={keep.has(i) ? <CheckSquare size={20} className="text-primary-600" /> : <Square size={20} />}
              title={t.merchant}
              subtitle={`${day(t.date, 'dd MMM')} · ${t.category} · ${t.reference ?? t.paymentMethod}`}
              trailing={<Money value={t.amount} className={t.kind === 'INCOME' ? 'text-success-600' : ''} />}
            />
          ))}
        </List>
      )}
    </Sheet>
  );
};
