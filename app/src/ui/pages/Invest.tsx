import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileUp, LineChart, Plus, Receipt, RefreshCw, Repeat } from 'lucide-react';
import { Button } from '../components/Button';
import { PieChart } from '../components/PieChart';
import { Empty, IconButton, List, Money, Panel, PrivacyToggle, Row, Screen, Section, Stat, usePrivacy } from '../components/kit';
import { HoldingSheet } from '../components/HoldingSheet';
import { SipSheet } from '../components/SipSheet';
import { useData, usePositions, useStore } from '../vault';
import { summarize } from '../../domain/portfolio';
import { live } from '../../domain/records';
import { nextInstallment, sipInvested } from '../../domain/sips';
import type { AssetType, Sip } from '../../domain/types';
import { refreshPrices } from '../../market/prices';
import { day, pct, tone, xirrPct } from '../format';
import { toast } from '../toast';
import { OwnerChips, useOwner } from '../owner';
import { daysBetween, stampDate, today } from '../../domain/dates';
import { TYPE_LABEL } from '../labels';


export default function InvestPage() {
  const data = useData();
  const store = useStore();
  const all = usePositions();
  const navigate = useNavigate();
  const { ownerId } = useOwner();
  const [hidden] = usePrivacy();
  const [adding, setAdding] = useState(false);
  const [sipSheet, setSipSheet] = useState<{ sip?: Sip } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const positions = useMemo(() => all.filter(p => (!ownerId || p.holding.ownerId === ownerId) && p.units.gt(0)), [all, ownerId]);
  const summary = useMemo(() => summarize(positions, data.txns), [positions, data.txns]);
  const groups = useMemo(() => {
    const m = new Map<AssetType, typeof positions>();
    for (const p of [...positions].sort((a, b) => b.value.cmp(a.value))) {
      const list = m.get(p.holding.type) ?? [];
      list.push(p);
      m.set(p.holding.type, list);
    }
    return [...m.entries()];
  }, [positions]);
  const sips = live(data.sips).filter(s => !ownerId || s.ownerId === ownerId);
  const closed = all.filter(p => p.units.lte(0) && p.realizedLots.length > 0 && (!ownerId || p.holding.ownerId === ownerId));

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await refreshPrices(store.get());
      store.replace(res.data);
      if (res.failed.length) toast.info(`Updated ${res.updated}. Not found: ${res.failed.slice(0, 3).join(', ')}${res.failed.length > 3 ? '…' : ''}`);
      else toast.success(`Prices updated for ${res.updated} holding${res.updated === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error(`Could not refresh: ${(e as Error).message}. Are you online?`);
    } finally {
      setRefreshing(false);
    }
  };

  const lastRefresh = data.settings.lastPriceRefreshAt;
  const staleDays = lastRefresh ? daysBetween(stampDate(lastRefresh), today()) : null;

  return (
    <Screen
      title="Invest"
      subtitle={lastRefresh ? `Prices ${staleDays === 0 ? 'updated today' : `${staleDays} day${staleDays === 1 ? '' : 's'} old`}` : undefined}
      actions={<>
        <IconButton label="Refresh prices" onClick={refresh}><RefreshCw size={20} className={refreshing ? 'animate-spin' : ''} /></IconButton>
        <PrivacyToggle />
        <IconButton label="Add investment" onClick={() => setAdding(true)}><Plus size={22} /></IconButton>
      </>}
    >
      <OwnerChips />
      {positions.length === 0 ? (
        <Empty
          icon={<LineChart />} title="No investments yet"
          body="Import a CAMS/KFintech or CDSL/NSDL statement to load everything with its full history, or add a holding by hand."
          action={<><Button iconLeft={<FileUp size={18} />} onClick={() => navigate('/invest/import')}>Import statement</Button><Button variant="outline" onClick={() => setAdding(true)}>Add manually</Button></>}
        />
      ) : (
        <>
          <Panel className="p-4">
            <div className="text-xs text-neutral-500">Current value</div>
            <div className="text-3xl font-bold"><Money value={summary.value} /></div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <Stat label="Invested" value={<Money value={summary.invested} short />} />
              <Stat label="Gain" value={<Money value={summary.unrealized} short signed className={tone(summary.unrealized)} />} sub={<span className={tone(summary.unrealized)}>{pct(summary.unrealizedPct)}</span>} />
              <Stat label="XIRR" value={<span className={tone(summary.xirr ?? 0)}>{xirrPct(summary.xirr)}</span>} sub={<span className="text-neutral-500">per year</span>} />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-4">
              <Button variant="secondary" size="sm" iconLeft={<FileUp size={16} />} onClick={() => navigate('/invest/import')}>Import</Button>
              <Button variant="secondary" size="sm" iconLeft={<Receipt size={16} />} onClick={() => navigate('/invest/tax')}>Tax & harvesting</Button>
            </div>
          </Panel>

          {groups.length > 1 && (
            <Panel className="p-4">
              <PieChart data={groups.map(([t, list]) => ({ name: TYPE_LABEL[t], value: list.reduce((s, p) => s + p.value.toNumber(), 0) }))} height={170} hideValues={hidden} />
            </Panel>
          )}

          {groups.map(([type, list]) => (
            <Section key={type} title={TYPE_LABEL[type]}>
              <List>
                {list.map(p => (
                  <Row
                    key={p.holding.id}
                    onClick={() => navigate(`/invest/${p.holding.id}`)}
                    title={p.holding.name}
                    subtitle={[p.hasEstimated && 'includes estimated SIPs', p.holding.folio && `Folio ${p.holding.folio}`, `XIRR ${xirrPct(p.xirr)}`].filter(Boolean).join(' · ')}
                    trailing={<Money value={p.value} short />}
                    trailingSub={<span className={tone(p.unrealized)}>{pct(p.unrealizedPct)}</span>}
                  />
                ))}
              </List>
            </Section>
          ))}
        </>
      )}

      <Section title="SIPs" action={<button className="text-sm text-primary-600" onClick={() => setSipSheet({})}>Add SIP</button>}>
        {sips.length === 0 ? (
          <Panel className="p-4 text-sm text-neutral-500 flex gap-2 items-center"><Repeat size={18} /> No SIPs. Statement imports create them automatically.</Panel>
        ) : (
          <List>
            {sips.map(s => {
              const next = nextInstallment(s);
              return (
                <Row
                  key={s.id} onClick={() => setSipSheet({ sip: s })} title={s.name}
                  subtitle={s.status !== 'ACTIVE' ? s.status.toLowerCase() : next ? `Next ${day(next, 'dd MMM')}${s.autoRecord ? ' · auto' : ''}` : 'Ended'}
                  trailing={<Money value={s.amount} />}
                  trailingSub={<span className="text-neutral-500"><Money value={sipInvested(s, data.txns)} short /> so far</span>}
                />
              );
            })}
          </List>
        )}
      </Section>

      {closed.length > 0 && (
        <Section title="Sold">
          <List>
            {closed.map(p => <Row key={p.holding.id} onClick={() => navigate(`/invest/${p.holding.id}`)} title={p.holding.name} trailing={<Money value={p.realized} short signed className={tone(p.realized)} />} trailingSub={<span className="text-neutral-500">realised</span>} />)}
          </List>
        </Section>
      )}

      <HoldingSheet open={adding} onClose={() => setAdding(false)} />
      <SipSheet open={!!sipSheet} onClose={() => setSipSheet(null)} sip={sipSheet?.sip} />
    </Screen>
  );
}
