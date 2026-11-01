import React, { useEffect, useState } from 'react';
import { Button } from './Button';
import { AmountField, DateField, SelectField, Sheet, TextField } from './kit';
import { D, dec } from '../../domain/money';
import { today } from '../../domain/dates';
import { create, live, touch } from '../../domain/records';
import { catchUpLoan, emiFor, monthlyRate, newLoanFields } from '../../domain/loans';
import type { Compounding, InterestType, Loan } from '../../domain/types';
import { useData, useStore } from '../vault';
import { inr } from '../format';
import { toast } from '../toast';
import { SELF_OWNER_ID } from '../../vault/schema';
import { upsertMany } from '../../domain/records';

/**
 * Add a loan from what is on the sanction letter. For a loan that started in the past, give the
 * outstanding balance today (from the bank app) so the app does not have to guess past prepayments.
 */
export const LoanSheet: React.FC<{ open: boolean; onClose: () => void; loan?: Loan }> = ({ open, onClose, loan }) => {
  const data = useData();
  const store = useStore();
  const [name, setName] = useState('');
  const [lender, setLender] = useState('');
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [tenure, setTenure] = useState('');
  const [start, setStart] = useState(today());
  const [emi, setEmi] = useState('');
  const [emiDay, setEmiDay] = useState('5');
  const [balance, setBalance] = useState('');
  const [firstEmi, setFirstEmi] = useState('');
  const [interestType, setInterestType] = useState<InterestType>('COMPOUND');
  const [compounding, setCompounding] = useState<Compounding>('MONTHLY');
  const [accountRef, setAccountRef] = useState('');
  const [ownerId, setOwnerId] = useState(SELF_OWNER_ID);

  useEffect(() => {
    if (!open) return;
    setName(loan?.name ?? ''); setLender(loan?.lender ?? ''); setPrincipal(loan?.principal ?? ''); setRate(loan?.annualRate ?? '');
    setTenure(loan ? String(loan.tenureMonths) : ''); setStart(loan?.startDate ?? today()); setEmi(loan?.emi ?? '');
    setEmiDay(String(loan?.emiDay ?? 5)); setBalance(''); setFirstEmi(loan?.firstEmiDate ?? ''); setInterestType(loan?.interestType ?? 'COMPOUND');
    setCompounding(loan?.compounding ?? 'MONTHLY'); setAccountRef(loan?.accountRef ?? ''); setOwnerId(loan?.ownerId ?? SELF_OWNER_ID);
  }, [open, loan]);

  const months = Number(tenure);
  const computedEmi = D(principal).gt(0) && D(rate).gte(0) && months > 0 ? emiFor(principal, monthlyRate(rate, interestType, compounding), months) : null;
  const valid = name.trim() && D(principal).gt(0) && months > 0 && Number(emiDay) >= 1 && Number(emiDay) <= 31;
  const started = start < today();
  const waiting = !!firstEmi && firstEmi > today();

  const submit = () => {
    if (!valid) return;
    const base = newLoanFields({ principal, annualRate: rate || '0', tenureMonths: months, startDate: start, interestType, compounding, emi: emi || undefined, emiDay: Number(emiDay), firstEmiDate: firstEmi || undefined });
    const fields = { ...base, name: name.trim(), lender: lender.trim() || undefined, accountRef: accountRef.trim() || undefined, ownerId };
    if (loan) {
      // Keep the tracked balance unless the user typed a fresh one.
      const keep = { balance: balance ? dec(balance) : loan.balance, balanceAsOf: balance ? today() : loan.balanceAsOf };
      store.update(d => ({ ...d, loans: d.loans.map(l => (l.id === loan.id ? touch(l, { ...fields, ...keep }) : l)) }));
    } else {
      let rec = create<Loan>(balance && started ? { ...fields, balance: dec(balance), balanceAsOf: today() } : fields);
      const caught = catchUpLoan(rec);
      rec = caught.loan;
      store.update(d => ({ ...d, loans: [...d.loans, rec], loanEvents: upsertMany(d.loanEvents, caught.events) }));
    }
    toast.success(loan ? 'Loan saved' : 'Loan added');
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={loan ? 'Edit loan' : 'Add loan'} footer={<Button size="lg" fullWidth disabled={!valid} onClick={submit}>Save</Button>}>
      <TextField label="Name" value={name} onChange={setName} placeholder="Home loan, car loan…" />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Lender" value={lender} onChange={setLender} placeholder="SBI, HDFC…" />
        <TextField label="Loan account no." value={accountRef} onChange={setAccountRef} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <AmountField label="Loan amount" value={principal} onChange={setPrincipal} />
        <AmountField label="Interest rate (% a year)" value={rate} onChange={setRate} prefix="" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Tenure (months)" inputMode="numeric" value={tenure} onChange={v => setTenure(v.replace(/\D/g, ''))} />
        <DateField label="Disbursed on" value={start} onChange={setStart} max={today()} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <AmountField label="EMI" value={emi} onChange={setEmi} hint={computedEmi ? `Calculated ${inr(computedEmi)}` : undefined} />
        <TextField label="EMI day" inputMode="numeric" value={emiDay} onChange={v => setEmiDay(v.replace(/\D/g, '').slice(0, 2))} />
      </div>
      <DateField label="First EMI date (only if repayment has not started)" value={firstEmi} onChange={setFirstEmi} min={start} />
      {waiting && <p className="text-xs text-neutral-500 -mt-2">Moratorium: no EMIs before this date. Interest keeps building at the loan rate and joins the balance when repayment starts. Enter the outstanding your bank shows, including any prepayments you made.</p>}
      {(started || loan) && (
        <AmountField label={loan ? 'Correct outstanding balance (optional)' : 'Outstanding today (from your bank app)'} value={balance} onChange={setBalance} hint={loan ? `Tracked: ${inr(loan.balance)} as of ${loan.balanceAsOf}` : 'Leave empty to calculate it from the EMIs since the start date.'} />
      )}
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Interest" value={interestType} onChange={v => setInterestType(v as InterestType)} options={[{ value: 'COMPOUND', label: 'Reducing balance' }, { value: 'SIMPLE', label: 'Simple' }]} />
        <SelectField label="Compounding" value={compounding} onChange={v => setCompounding(v as Compounding)} options={[{ value: 'MONTHLY', label: 'Monthly' }, { value: 'QUARTERLY', label: 'Quarterly' }, { value: 'YEARLY', label: 'Yearly' }]} />
      </div>
      {live(data.owners).length > 1 && <SelectField label="Borrower" value={ownerId} onChange={setOwnerId} options={live(data.owners).map(o => ({ value: o.id, label: o.name }))} />}
    </Sheet>
  );
};
