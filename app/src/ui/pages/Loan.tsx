import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Calculator, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../components/Button';
import { HeroCard, AmountField, DateField, IconButton, List, Money, Row, Screen, Section, Segmented, Sheet, Stat } from '../components/kit';
import { LoanSheet } from '../components/LoanSheet';
import { useData, useStore } from '../vault';
import { D } from '../../domain/money';
import { today } from '../../domain/dates';
import { live, remove } from '../../domain/records';
import { applyPrepayment, remainingSchedule, totals, type PrepayMode } from '../../domain/loans';
import { removeWithUndo } from '../actions';
import { day } from '../format';
import { toast } from '../toast';

export default function LoanPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const data = useData();
  const store = useStore();
  const loan = live(data.loans).find(l => l.id === id);
  const [edit, setEdit] = useState(false);
  const [prepay, setPrepay] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [mode, setMode] = useState<PrepayMode>('REDUCE_TENURE');
  const [showAll, setShowAll] = useState(false);

  const sched = useMemo(() => (loan ? remainingSchedule(loan) : []), [loan]);
  const events = useMemo(() => live(data.loanEvents).filter(e => e.loanId === id).sort((a, b) => b.date.localeCompare(a.date)), [data.loanEvents, id]);
  if (!loan) return <Screen title="Not found" back><p className="text-neutral-500">This loan was deleted.</p></Screen>;
  const t = totals(sched);

  const record = () => {
    const res = applyPrepayment(loan, amount, date, mode);
    store.update(d => ({ ...d, loans: d.loans.map(l => (l.id === loan.id ? res.loan : l)), loanEvents: [...d.loanEvents, res.event] }), 'Prepayment');
    toast.success('Prepayment recorded', { label: 'Undo', onClick: () => store.undo() });
    setPrepay(false);
    setAmount('');
  };

  const del = () => {
    removeWithUndo(store, 'loans', loan.id, `${loan.name} deleted`, d => ({
      ...d, loanEvents: d.loanEvents.reduce((acc, e) => (e.loanId === loan.id && !e.deletedAt ? remove(acc, e.id) : acc), d.loanEvents),
    }));
    navigate('/loans', { replace: true });
  };

  return (
    <Screen title={loan.name} subtitle={[loan.lender, `${loan.annualRate}%`, loan.accountRef].filter(Boolean).join(' · ')} back actions={<>
      <IconButton label="Edit" onClick={() => setEdit(true)}><Pencil size={18} /></IconButton>
      <IconButton label="Delete" onClick={del}><Trash2 size={18} /></IconButton>
    </>}>
      <HeroCard>
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400">Outstanding as of {day(loan.balanceAsOf)}</div>
        <div className="font-display text-[36px] leading-tight font-extrabold tracking-[-0.03em] mt-1"><Money value={loan.balance} /></div>
        <div className="grid grid-cols-3 gap-3 mt-4">
          <Stat label="EMI" value={<Money value={loan.emi} />} sub={<span className="text-neutral-500">on day {loan.emiDay}</span>} />
          <Stat label="Months left" value={loan.closedAt ? 'Closed' : t.months} sub={sched.length ? <span className="text-neutral-500">ends {day(sched[sched.length - 1].date, 'MMM yyyy')}</span> : undefined} />
          <Stat label="Interest still to pay" value={<Money value={t.interest} short />} />
        </div>
        {!loan.closedAt && (
          <div className="grid grid-cols-2 gap-2 mt-4">
            <Button size="sm" variant="secondary" onClick={() => setPrepay(true)}>Record prepayment</Button>
            <Button size="sm" variant="secondary" iconLeft={<Calculator size={16} />} onClick={() => navigate(`/loans/${loan.id}/simulate`)}>Prepay or invest?</Button>
          </div>
        )}
        {sched.length === 0 && !loan.closedAt && D(loan.balance).gt(0) && <p className="text-xs text-error-600 mt-3">The EMI does not cover the monthly interest, so this loan never closes. Check the EMI and rate.</p>}
      </HeroCard>

      {sched.length > 0 && (
        <Section title="Upcoming EMIs" action={sched.length > 6 && <button className="text-sm text-primary-600" onClick={() => setShowAll(s => !s)}>{showAll ? 'Less' : `All ${sched.length}`}</button>}>
          <List>
            {(showAll ? sched : sched.slice(0, 6)).map(r => (
              <Row key={r.month} title={day(r.date, 'MMM yyyy')} subtitle={<>Principal <Money value={r.principal} /> · Interest <Money value={r.interest} /></>} trailing={<Money value={r.balance} short />} trailingSub={<span className="text-neutral-500">left after</span>} />
            ))}
          </List>
        </Section>
      )}

      {events.length > 0 && (
        <Section title="History">
          <List>
            {events.slice(0, 24).map(e => (
              <Row key={e.id} title={e.kind === 'EMI' ? 'EMI paid' : e.kind === 'PREPAYMENT' ? 'Prepayment' : 'Rate change'} subtitle={`${day(e.date)}${e.interest ? ` · interest ${Math.round(Number(e.interest)).toLocaleString('en-IN')}` : ''}`} trailing={<Money value={e.amount} />} trailingSub={e.balanceAfter ? <span className="text-neutral-500"><Money value={e.balanceAfter} short /> left</span> : undefined} />
            ))}
          </List>
        </Section>
      )}

      <LoanSheet open={edit} onClose={() => setEdit(false)} loan={loan} />
      <Sheet open={prepay} onClose={() => setPrepay(false)} title="Record prepayment" footer={<Button size="lg" fullWidth disabled={!D(amount).gt(0)} onClick={record}>Save</Button>}>
        <AmountField label="Amount paid" value={amount} onChange={setAmount} autoFocus />
        <DateField label="Date" value={date} onChange={setDate} max={today()} />
        <Segmented value={mode} onChange={setMode} options={[{ value: 'REDUCE_TENURE', label: 'Keep EMI, finish sooner' }, { value: 'REDUCE_EMI', label: 'Lower EMI' }]} />
        <p className="text-xs text-neutral-500">Most banks keep the EMI and shorten the tenure unless you ask otherwise. Keeping the EMI saves more interest.</p>
      </Sheet>
    </Screen>
  );
}
