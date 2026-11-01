import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Landmark, Plus } from 'lucide-react';
import { Button } from '../components/Button';
import { Empty, IconButton, List, Money, Panel, PrivacyToggle, Row, Screen, Section, Stat } from '../components/kit';
import { LoanSheet } from '../components/LoanSheet';
import { useData } from '../vault';
import { D, ZERO } from '../../domain/money';
import { live } from '../../domain/records';
import { nextEmiDate, remainingSchedule } from '../../domain/loans';
import { day } from '../format';

export default function LoansPage() {
  const data = useData();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const loans = live(data.loans);
  const open = loans.filter(l => !l.closedAt);
  const closed = loans.filter(l => l.closedAt);
  const balance = open.reduce((s, l) => s.plus(D(l.balance)), ZERO);
  const emis = open.reduce((s, l) => s.plus(D(l.emi)), ZERO);

  return (
    <Screen title="Loans" actions={<><PrivacyToggle /><IconButton label="Add loan" onClick={() => setAdding(true)}><Plus size={22} /></IconButton></>}>
      {open.length === 0 && closed.length === 0 ? (
        <Empty icon={<Landmark />} title="No loans" body="Add a home, car, education or personal loan. Balances move forward by themselves every EMI date." action={<Button onClick={() => setAdding(true)}>Add loan</Button>} />
      ) : (
        <>
          <Panel className="p-4 grid grid-cols-2 gap-3">
            <Stat label="Outstanding" value={<Money value={balance} />} />
            <Stat label="EMIs a month" value={<Money value={emis} />} />
          </Panel>
          <List>
            {open.map(l => {
              const left = remainingSchedule(l).length;
              const paidPct = D(l.principal).gt(0) ? Math.max(0, Math.min(100, D(1).minus(D(l.balance).div(D(l.principal))).times(100).toNumber())) : 0;
              return (
                <button key={l.id} onClick={() => navigate(`/loans/${l.id}`)} className="w-full text-left px-4 py-3 active:bg-neutral-100 dark:active:bg-neutral-800">
                  <div className="flex justify-between">
                    <div className="font-medium">{l.name}</div>
                    <Money value={l.balance} short className="font-medium" />
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5">{l.annualRate}% · EMI <Money value={l.emi} /> on {day(nextEmiDate(l), 'dd MMM')} · {left} months left</div>
                  <div className="h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800 mt-2 overflow-hidden"><div className="h-full bg-success-500" style={{ width: `${paidPct}%` }} /></div>
                </button>
              );
            })}
          </List>
          {closed.length > 0 && (
            <Section title="Closed">
              <List>{closed.map(l => <Row key={l.id} onClick={() => navigate(`/loans/${l.id}`)} title={l.name} subtitle={`Closed ${day(l.closedAt)}`} />)}</List>
            </Section>
          )}
        </>
      )}
      <LoanSheet open={adding} onClose={() => setAdding(false)} />
    </Screen>
  );
}
