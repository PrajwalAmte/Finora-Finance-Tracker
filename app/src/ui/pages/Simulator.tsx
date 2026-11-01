import React, { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Scale } from 'lucide-react';
import { AmountField, Money, Panel, Screen, Segmented, Stat } from '../components/kit';
import { useData } from '../vault';
import { D } from '../../domain/money';
import { live } from '../../domain/records';
import { comparePrepayVsInvest, type PrepayMode } from '../../domain/loans';
import { cx, day } from '../format';

/** "Should I prepay ₹X or invest it?", measured as wealth on the original loan end date. */
export default function SimulatorPage() {
  const { id } = useParams();
  const data = useData();
  const loan = live(data.loans).find(l => l.id === id);
  const [amount, setAmount] = useState('100000');
  const [ret, setRet] = useState('12');
  const [tax, setTax] = useState('12.5');
  const [mode, setMode] = useState<PrepayMode>('REDUCE_TENURE');

  const res = useMemo(() => (loan && D(amount).gt(0) ? comparePrepayVsInvest(loan, amount, { mode, expectedReturnPct: ret || '0', taxOnGainsPct: tax || '0' }) : null), [loan, amount, ret, tax, mode]);
  if (!loan) return <Screen title="Not found" back><p /></Screen>;

  return (
    <Screen title="Prepay or invest?" subtitle={loan.name} back>
      <Panel className="p-4 space-y-4">
        <AmountField label="Lump sum you have" value={amount} onChange={setAmount} />
        <div className="grid grid-cols-2 gap-3">
          <AmountField label="Expected return (% a year)" value={ret} onChange={setRet} prefix="" />
          <AmountField label="Tax on gains (%)" value={tax} onChange={setTax} prefix="" hint="12.5% for equity held over a year" />
        </div>
        <Segmented value={mode} onChange={setMode} options={[{ value: 'REDUCE_TENURE', label: 'Prepay: finish sooner' }, { value: 'REDUCE_EMI', label: 'Prepay: lower EMI' }]} />
      </Panel>

      {res && (
        <>
          <Panel className={cx('p-4 border-2', res.better === 'PREPAY' ? 'border-success-500' : res.better === 'INVEST' ? 'border-primary-500' : 'border-neutral-300')}>
            <div className="flex gap-3 items-center">
              <Scale className={res.better === 'PREPAY' ? 'text-success-600' : 'text-primary-600'} />
              <div className="text-lg font-bold">{res.better === 'PREPAY' ? 'Prepaying comes out ahead' : res.better === 'INVEST' ? 'Investing comes out ahead' : 'It is a tie'}</div>
            </div>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-2">
              By {day(res.baseline.endDate, 'MMM yyyy')} you would have <b><Money value={res.investWealth} /></b> by investing vs <b><Money value={res.prepayWealth} /></b> by prepaying and then investing the EMIs you no longer pay.
            </p>
            {res.breakEvenReturnPct !== null && (
              <p className="text-sm mt-2">Investing wins only if your investments return more than <b>{res.breakEvenReturnPct}%</b> a year (before the tax above), every year, with no bad years.</p>
            )}
          </Panel>
          <Panel className="p-4 grid grid-cols-2 gap-4">
            <Stat label="Interest saved by prepaying" value={<Money value={res.interestSaved} />} />
            <Stat label={mode === 'REDUCE_TENURE' ? 'Loan ends earlier by' : 'New EMI'} value={mode === 'REDUCE_TENURE' ? `${res.monthsSaved} months` : <Money value={res.prepay.emi} />} />
            <Stat label="Interest left today" value={<Money value={res.baseline.interest} short />} />
            <Stat label="After prepaying" value={<Money value={res.prepay.interest} short />} />
          </Panel>
          <p className="text-xs text-neutral-500 px-1">Prepaying is a guaranteed, tax-free return equal to your loan rate ({loan.annualRate}%). Investing returns are not guaranteed. Home-loan interest deductions (s.24) are not included; if you claim them, the effective loan rate is lower.</p>
        </>
      )}
    </Screen>
  );
}
