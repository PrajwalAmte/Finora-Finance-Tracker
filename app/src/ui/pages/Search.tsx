import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Landmark, LineChart, Repeat, Target, Wallet } from 'lucide-react';
import { List, Money, Row, Screen } from '../components/kit';
import { EntrySheet } from '../components/EntrySheet';
import { useData } from '../vault';
import { live } from '../../domain/records';
import type { Entry } from '../../domain/types';
import { day } from '../format';

export default function SearchPage() {
  const data = useData();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [entry, setEntry] = useState<Entry | null>(null);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const hit = (...fields: (string | undefined)[]) => fields.some(f => f?.toLowerCase().includes(s));
    const out: { key: string; icon: React.ReactNode; title: string; subtitle: string; amount?: string; go: () => void }[] = [];
    for (const h of live(data.holdings)) if (hit(h.name, h.symbol, h.isin, h.folio)) out.push({ key: h.id, icon: <LineChart size={18} />, title: h.name, subtitle: 'Investment', go: () => navigate(`/invest/${h.id}`) });
    for (const l of live(data.loans)) if (hit(l.name, l.lender, l.accountRef)) out.push({ key: l.id, icon: <Landmark size={18} />, title: l.name, subtitle: 'Loan', amount: l.balance, go: () => navigate(`/loans/${l.id}`) });
    for (const sp of live(data.sips)) if (hit(sp.name)) out.push({ key: sp.id, icon: <Repeat size={18} />, title: sp.name, subtitle: 'SIP', amount: sp.amount, go: () => navigate('/invest') });
    for (const g of live(data.goals)) if (hit(g.name)) out.push({ key: g.id, icon: <Target size={18} />, title: g.name, subtitle: 'Goal', go: () => navigate('/plan') });
    const entries = live(data.entries).filter(e => hit(e.description, e.category, e.merchant) || e.amount === s).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50);
    for (const e of entries) out.push({ key: e.id, icon: <Wallet size={18} />, title: e.description, subtitle: `${day(e.date)} · ${e.category}`, amount: e.amount, go: () => setEntry(e) });
    return out;
  }, [q, data, navigate]);

  return (
    <Screen title="Search" back>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Funds, loans, expenses, ISIN, folio…" className="w-full h-12 px-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-[16px]" />
      {results.length > 0 && (
        <List>
          {results.map(r => <Row key={r.key} icon={r.icon} title={r.title} subtitle={r.subtitle} trailing={r.amount ? <Money value={r.amount} /> : undefined} onClick={r.go} />)}
        </List>
      )}
      {q.trim().length >= 2 && results.length === 0 && <p className="text-sm text-neutral-500 text-center py-8">Nothing found</p>}
      <EntrySheet open={!!entry} onClose={() => setEntry(null)} entry={entry ?? undefined} />
    </Screen>
  );
}
