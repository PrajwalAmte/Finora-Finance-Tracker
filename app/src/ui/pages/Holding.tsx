import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '../components/Button';
import { HeroCard, AmountField, DateField, IconButton, List, Money, Row, Screen, Section, Segmented, Sheet, Stat } from '../components/kit';
import { HoldingSheet } from '../components/HoldingSheet';
import { useData, usePositions, useStore } from '../vault';
import { D, dec, price, units as toUnits } from '../../domain/money';
import { addMonths, today } from '../../domain/dates';
import { create, remove, touch } from '../../domain/records';
import { sortTxns, tradeFields } from '../../domain/portfolio';
import { isLongTerm } from '../../domain/tax/capitalGains';
import type { Txn, TxnKind } from '../../domain/types';
import { removeWithUndo } from '../actions';
import { day, pct, qty, tone, xirrPct } from '../format';
import { toast } from '../toast';
import { TYPE_LABEL } from '../labels';
import { live } from '../../domain/records';

const TxnSheet: React.FC<{ open: boolean; onClose: () => void; holdingId: string; txn?: Txn; kind?: TxnKind; maxUnits: string }> = ({ open, onClose, holdingId, txn, kind: initialKind, maxUnits }) => {
  const store = useStore();
  const [kind, setKind] = useState<TxnKind>('BUY');
  const [date, setDate] = useState(today());
  const [unitsIn, setUnits] = useState('');
  const [priceIn, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [charges, setCharges] = useState('');

  useEffect(() => {
    if (!open) return;
    setKind(txn?.kind ?? initialKind ?? 'BUY');
    setDate(txn?.date ?? today());
    setUnits(txn && txn.kind !== 'DIVIDEND' ? txn.units : '');
    setPrice(txn && txn.kind !== 'DIVIDEND' ? txn.price : '');
    setAmount(txn?.amount ?? '');
    setCharges(txn?.charges ?? '');
  }, [open, txn, initialKind]);

  const t = kind === 'DIVIDEND' ? { units: D(0), price: D(0), amount: D(amount) } : tradeFields({ units: unitsIn, price: priceIn, amount });
  const over = kind === 'SELL' && !txn && t.units.gt(D(maxUnits).plus(0.0001));
  const valid = kind === 'DIVIDEND' ? t.amount.gt(0) : t.units.gt(0) && t.price.gt(0) && !over;

  const submit = () => {
    const fields = { kind, date, units: toUnits(t.units), price: price(t.price), amount: dec(t.amount), charges: charges ? dec(charges) : undefined, estimated: false };
    store.update(d => ({
      ...d,
      txns: txn ? d.txns.map(x => (x.id === txn.id ? touch(x, fields) : x)) : [...d.txns, create<Txn>({ holdingId, source: 'MANUAL', ...fields })],
    }));
    toast.success('Saved');
    onClose();
  };

  return (
    <Sheet
      open={open} onClose={onClose} title={txn ? 'Edit transaction' : kind === 'SELL' ? 'Record a sale' : kind === 'DIVIDEND' ? 'Record a dividend' : 'Record a purchase'}
      footer={<div className="flex gap-2">
        {txn && <Button variant="ghost" className="text-error-600" iconLeft={<Trash2 size={18} />} onClick={() => { removeWithUndo(store, 'txns', txn.id, 'Transaction deleted'); onClose(); }}>Delete</Button>}
        <Button size="lg" className="flex-1" disabled={!valid} onClick={submit}>Save</Button>
      </div>}
    >
      <Segmented value={kind} onChange={setKind} options={[{ value: 'BUY', label: 'Buy' }, { value: 'SELL', label: 'Sell' }, { value: 'DIVIDEND', label: 'Dividend' }]} />
      <DateField label="Date" value={date} onChange={setDate} max={today()} />
      {kind === 'DIVIDEND' ? (
        <AmountField label="Amount received" value={amount} onChange={setAmount} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <AmountField label="Price / NAV" value={priceIn} onChange={setPrice} />
            <AmountField label="Units" value={unitsIn} onChange={setUnits} prefix="" hint={kind === 'SELL' ? `You hold ${qty(maxUnits)}` : undefined} />
          </div>
          <AmountField label="…or total amount" value={amount} onChange={setAmount} />
          <AmountField label="Charges (brokerage, STT, stamp duty)" value={charges} onChange={setCharges} />
          {over && <p className="text-xs text-error-600">That is more than the units you hold.</p>}
        </>
      )}
    </Sheet>
  );
};

export default function HoldingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const data = useData();
  const store = useStore();
  const positions = usePositions();
  const p = positions.find(x => x.holding.id === id);
  const [edit, setEdit] = useState(false);
  const [txnSheet, setTxnSheet] = useState<{ txn?: Txn; kind?: TxnKind } | null>(null);
  const txns = useMemo(() => sortTxns(live(data.txns).filter(t => t.holdingId === id)).reverse(), [data.txns, id]);

  if (!p) return <Screen title="Not found" back><p className="text-neutral-500">This holding was deleted.</p></Screen>;
  const h = p.holding;
  const owner = live(data.owners).find(o => o.id === h.ownerId);

  const deleteHolding = () => {
    removeWithUndo(store, 'holdings', h.id, `${h.name} deleted`, d => ({
      ...d,
      txns: d.txns.reduce((acc, t) => (t.holdingId === h.id && !t.deletedAt ? remove(acc, t.id) : acc), d.txns),
      sips: d.sips.map(s => (s.holdingId === h.id ? touch(s, { holdingId: undefined }) : s)),
    }));
    navigate('/invest', { replace: true });
  };

  return (
    <Screen title={h.name} subtitle={[TYPE_LABEL[h.type], owner && live(data.owners).length > 1 ? owner.name : null, h.isin].filter(Boolean).join(' · ')} back actions={<>
      <IconButton label="Edit" onClick={() => setEdit(true)}><Pencil size={18} /></IconButton>
      <IconButton label="Delete" onClick={deleteHolding}><Trash2 size={18} /></IconButton>
    </>}>
      <HeroCard>
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400">Value</div>
        <div className="font-display text-[36px] leading-tight font-extrabold tracking-[-0.03em] mt-1"><Money value={p.value} /></div>
        <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">{qty(p.units)} units × <Money value={p.price} paise />{h.priceDate ? ` on ${day(h.priceDate, 'dd MMM')}` : ''}</div>
        <div className="grid grid-cols-3 gap-3 mt-4">
          <Stat label="Invested" value={<Money value={p.invested} short />} sub={<span className="text-neutral-500">avg <Money value={p.avgCost} paise /></span>} />
          <Stat label="Gain" value={<Money value={p.unrealized} short signed className={tone(p.unrealized)} />} sub={<span className={tone(p.unrealized)}>{pct(p.unrealizedPct)}</span>} />
          <Stat label="XIRR" value={<span className={tone(p.xirr ?? 0)}>{xirrPct(p.xirr)}</span>} />
        </div>
        {(p.realized.abs().gt(0) || p.dividends.gt(0)) && (
          <div className="grid grid-cols-3 gap-3 mt-3">
            <Stat label="Realised" value={<Money value={p.realized} short signed className={tone(p.realized)} />} />
            <Stat label="Dividends" value={<Money value={p.dividends} short />} />
          </div>
        )}
        {p.oversold && <p className="mt-3 text-xs text-warning-700 dark:text-warning-400">Sales exceed purchases here, so some buy history is missing. Import a full statement to fix returns and tax.</p>}
        {p.hasEstimated && <p className="mt-3 text-xs text-neutral-500">Some SIP installments use an estimated NAV. Import your latest CAMS/KFintech statement to replace them with exact units.</p>}
        <div className="grid grid-cols-3 gap-2 mt-4">
          <Button size="sm" variant="secondary" onClick={() => setTxnSheet({ kind: 'BUY' })}>Buy</Button>
          <Button size="sm" variant="secondary" disabled={p.units.lte(0)} onClick={() => setTxnSheet({ kind: 'SELL' })}>Sell</Button>
          <Button size="sm" variant="secondary" onClick={() => setTxnSheet({ kind: 'DIVIDEND' })}>Dividend</Button>
        </div>
      </HeroCard>

      {p.lots.length > 0 && (
        <Section title="Lots (sold first-in, first-out)">
          <List>
            {p.lots.map(l => {
              const lt = isLongTerm(h.taxClass, l.date, today());
              const gain = p.price.minus(l.costPerUnit).times(l.units);
              const ltOn = addMonths(l.date, h.taxClass === 'EQUITY' ? 12 : 24);
              return (
                <Row
                  key={l.txnId} title={`${qty(l.units)} units @ ₹${l.costPerUnit.toDecimalPlaces(2).toString()}`}
                  subtitle={`${day(l.date)} · ${lt ? 'long term' : h.taxClass === 'DEBT' && l.date >= '2023-04-01' ? 'slab rate' : `long term from ${day(ltOn, 'dd MMM yy')}`}`}
                  trailing={<Money value={gain} short signed className={tone(gain)} />}
                />
              );
            })}
          </List>
        </Section>
      )}

      <Section title={`Transactions (${txns.length})`}>
        <List>
          {txns.map(t => (
            <Row
              key={t.id} onClick={() => setTxnSheet({ txn: t })}
              title={t.kind === 'BUY' ? (t.sipId ? 'SIP installment' : 'Bought') : t.kind === 'SELL' ? 'Sold' : 'Dividend'}
              subtitle={`${day(t.date)}${t.kind !== 'DIVIDEND' ? ` · ${qty(t.units)} @ ₹${D(t.price).toDecimalPlaces(2).toString()}` : ''}${t.estimated ? ' · estimated' : ''}`}
              trailing={<Money value={t.kind === 'BUY' ? D(t.amount).neg() : t.amount} className={t.kind === 'BUY' ? '' : 'text-success-600'} />}
            />
          ))}
        </List>
      </Section>

      <HoldingSheet open={edit} onClose={() => setEdit(false)} holding={h} />
      <TxnSheet open={!!txnSheet} onClose={() => setTxnSheet(null)} holdingId={h.id} txn={txnSheet?.txn} kind={txnSheet?.kind} maxUnits={p.units.toString()} />
    </Screen>
  );
}
