import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { catchUp, type CatchUpReport } from '../domain/catchUp';
import { parseDate, today } from '../domain/dates';
import { computePositions, type Position } from '../domain/portfolio';
import { upcoming } from '../domain/planner/calendar';
import { snapshotFor } from '../domain/networth';
import { upsertMany } from '../domain/records';
import type { VaultData } from '../domain/types';
import { onAppState, onAppUrl, requestPersistentStorage, scheduleReminders, setScreenProtection } from '../platform/device';
import { acceptCaptureUrl } from '../capture/inbox';
import { attachCloud, detachCloud, handleOAuthReturn } from './cloud';
import { session } from '../vault/session';
import { VaultStore } from '../vault/store';
import { applyTheme } from './theme';
import { toast } from './toast';
import { inr } from './format';

export type Phase = 'loading' | 'new' | 'locked' | 'unlocked';

interface VaultContextValue {
  phase: Phase;
  store: VaultStore | null;
  lastCatchUp: CatchUpReport | null;
  open: (data: VaultData) => void;
  lock: () => Promise<void>;
  reset: () => Promise<void>;
}

const VaultContext = createContext<VaultContextValue | null>(null);

function describe(report: CatchUpReport): string | null {
  const parts: string[] = [];
  if (report.emisApplied) parts.push(`${report.emisApplied} EMI${report.emisApplied > 1 ? 's' : ''} applied`);
  if (report.sipInstallments) parts.push(`${report.sipInstallments} SIP installment${report.sipInstallments > 1 ? 's' : ''} recorded`);
  if (report.loansClosed.length) parts.push(`${report.loansClosed.join(', ')} fully repaid 🎉`);
  return parts.length ? `${parts.join(' · ')} since you were last here` : null;
}

/** Upcoming EMIs and SIP debits become local notifications at 9am on the day. */
function remind(data: VaultData) {
  const items = upcoming(data, 14).filter(i => i.kind === 'EMI' || i.kind === 'SIP' || i.kind === 'BILL');
  scheduleReminders(items.map((i, idx) => {
    const at = parseDate(i.date);
    at.setHours(9, 0, 0, 0);
    return { id: 1000 + idx, title: i.kind === 'EMI' ? 'EMI due today' : i.kind === 'SIP' ? 'SIP debit today' : 'Bill due today', body: `${i.title}: ${inr(i.amount)}`, at };
  }));
}

export const VaultProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [phase, setPhase] = useState<Phase>('loading');
  const [store, setStore] = useState<VaultStore | null>(null);
  const [lastCatchUp, setLastCatchUp] = useState<CatchUpReport | null>(null);
  const backgroundAt = useRef<number | null>(null);
  const storeRef = useRef<VaultStore | null>(null);
  storeRef.current = store;

  useEffect(() => {
    applyTheme('dark');
    setScreenProtection(true);
    session.onSaveError = e => toast.error(`Could not save: ${(e as Error).message}`);
    session.hasVault().then(has => setPhase(has ? 'locked' : 'new'));
    // Coming back from Google/Dropbox sign-in: finish it now; the link is saved once the vault opens.
    void handleOAuthReturn();
    // Listen before unlock so a message that cold-starts the app waits in memory until the vault opens.
    return onAppUrl(url => { acceptCaptureUrl(url); });
  }, []);

  const open = useCallback((data: VaultData) => {
    const result = catchUp(data);
    const s = new VaultStore(result.data, d => session.save(d));
    if (result.changed) session.save(result.data);
    setStore(s);
    setLastCatchUp(result.report);
    setPhase('unlocked');
    applyTheme(result.data.settings.theme);
    setScreenProtection(true);
    remind(result.data);
    // Web: ask the browser to keep the vault even under storage pressure.
    requestPersistentStorage();
    void attachCloud(s);
    const msg = describe(result.report);
    if (msg) setTimeout(() => toast.info(msg), 600);
  }, []);

  const lock = useCallback(async () => {
    detachCloud();
    await session.lock();
    setStore(null);
    setPhase('locked');
    applyTheme('dark');
  }, []);

  const reset = useCallback(async () => {
    detachCloud();
    await session.erase();
    setStore(null);
    setPhase('new');
  }, []);

  // Auto-lock after N minutes in the background, and save before the OS can suspend us.
  useEffect(() => {
    return onAppState(active => {
      const s = storeRef.current;
      if (!active) {
        backgroundAt.current = Date.now();
        if (s) {
          // Keep today's snapshot current with whatever changed while the app was open.
          const d = s.get();
          s.replace({ ...d, snapshots: upsertMany(d.snapshots, [snapshotFor(d, today())]) });
          remind(s.get());
        }
        session.flush().catch(() => {});
        return;
      }
      const away = backgroundAt.current ? Date.now() - backgroundAt.current : 0;
      backgroundAt.current = null;
      if (!s) return;
      const minutes = s.get().settings.autoLockMinutes;
      if (minutes >= 0 && away > minutes * 60_000) {
        lock();
        return;
      }
      // A new day while the app sat open: run the catch-up again.
      if (s.get().meta.lastCatchUpDate !== today()) {
        const result = catchUp(s.get());
        if (result.changed) s.replace(result.data);
      }
    });
  }, [lock]);

  const value = useMemo(() => ({ phase, store, lastCatchUp, open, lock, reset }), [phase, store, lastCatchUp, open, lock, reset]);
  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
};

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault outside VaultProvider');
  return ctx;
}

export function useStore(): VaultStore {
  const { store } = useVault();
  if (!store) throw new Error('Vault is locked');
  return store;
}

export function useData(): VaultData {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.get);
}

let memo: { holdings: unknown; txns: unknown; day: string; positions: Position[] } | null = null;

/** Positions are recomputed only when holdings or transactions change. */
export function usePositions(): Position[] {
  const data = useData();
  const d = today();
  if (!memo || memo.holdings !== data.holdings || memo.txns !== data.txns || memo.day !== d) {
    memo = { holdings: data.holdings, txns: data.txns, day: d, positions: computePositions(data) };
  }
  return memo.positions;
}
