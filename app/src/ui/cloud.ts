import { useSyncExternalStore } from 'react';
import { nowStamp } from '../domain/dates';
import { session } from '../vault/session';
import type { VaultStore } from '../vault/store';
import { encodeCloudFile, decodeCloudFile, type CloudFile } from '../cloud/format';
import { readRedirect, takePending, type OAuthPurpose } from '../cloud/oauth';
import { beginSignIn, completeSignIn, freshTokens, providerLabel, storageFor } from '../cloud/providers';
import { replaceRemote, syncOnce, type SyncIO } from '../cloud/sync';
import { AuthError, type Connection, type ProviderId } from '../cloud/types';
import { onAppState, platform } from '../platform/device';

/**
 * Optional cloud copy of the vault for the PWA (Google Drive or Dropbox). The provider stores one
 * encrypted file; this device keeps its sign-in tokens in the device-only encrypted secrets file.
 */
export type CloudStatus = 'off' | 'idle' | 'syncing' | 'error' | 'auth' | 'foreign';

export interface CloudState {
  connection: Omit<Connection, 'tokens'> | null;
  status: CloudStatus;
  error?: string;
  /** Set when the cloud holds a different vault; the user decides what happens. */
  foreignRev?: string;
  /** Sign-in finished for "set up this device from the cloud" and is waiting for the passphrase. */
  restore?: { provider: ProviderId; account: string; file: CloudFile | null; rev: string | null; checking: boolean; error?: string };
}

interface Secrets {
  connection: Connection | null;
}

let state: CloudState = { connection: null, status: 'off' };
let connection: Connection | null = null;
/** Sign-in that completed before the vault was unlocked (the page reloads on return from the provider). */
let pending: { connection: Connection; purpose: OAuthPurpose } | null = null;
let store: VaultStore | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
let running: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<CloudState>) {
  state = { ...state, ...next };
  listeners.forEach(l => l());
}

export function cloudSupported(): boolean {
  return platform() === 'web';
}

export function useCloud(): CloudState {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => state,
  );
}

function publicConnection(c: Connection | null): CloudState['connection'] {
  if (!c) return null;
  const { tokens: _tokens, ...rest } = c;
  return rest;
}

async function persist(): Promise<void> {
  await session.writeDeviceSecrets(connection ? ({ connection } satisfies Secrets) : null);
}

async function withStorage<T>(fn: (s: ReturnType<typeof storageFor>) => Promise<T>): Promise<T> {
  if (!connection) throw new Error('Not connected');
  const tokens = await freshTokens(connection.provider, connection.tokens);
  if (tokens !== connection.tokens) {
    connection = { ...connection, tokens };
    await persist();
  }
  return fn(storageFor(connection.provider, tokens.accessToken));
}

function io(s: ReturnType<typeof storageFor>): SyncIO {
  const st = store!;
  return {
    storage: s,
    local: () => st.get(),
    apply: data => st.replace(data),
    seal: async data => {
      const { keyring, vault } = await session.sealForCloud(data);
      return encodeCloudFile(keyring, vault, data.meta.deviceId, nowStamp());
    },
    open: vault => session.openWithCurrentKey(vault, st.get().meta.deviceId),
  };
}

/** Run one sync now (coalesces with one already running). */
export function syncNow(): Promise<void> {
  if (!connection || !store) return Promise.resolve();
  if (running) return running;
  running = (async () => {
    set({ status: 'syncing', error: undefined });
    try {
      await session.flush();
      const res = await withStorage(s => syncOnce(io(s)));
      if (res.kind === 'foreign') {
        set({ status: 'foreign', foreignRev: res.rev });
        return;
      }
      connection = { ...connection!, lastRev: res.rev, lastSyncAt: nowStamp() };
      await persist();
      set({ status: 'idle', connection: publicConnection(connection), foreignRev: undefined });
    } catch (e) {
      if (e instanceof AuthError) set({ status: 'auth', error: e.message });
      else set({ status: 'error', error: navigator.onLine === false ? 'Offline. Will sync when you are back online.' : (e as Error).message });
    } finally {
      running = null;
    }
  })();
  return running;
}

function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void syncNow(); }, ms);
}

/** Called when the vault opens. Loads this device's link (or the one just made) and syncs. */
/** A failed sign-in is reported after the vault unlocks, so it must outlive the unlock. */
let returnError: string | undefined;

export async function attachCloud(s: VaultStore): Promise<void> {
  if (!cloudSupported()) return;
  store = s;
  const saved = await session.readDeviceSecrets<Secrets>();
  connection = pending?.connection ?? saved?.connection ?? null;
  if (pending) {
    pending = null;
    await persist();
  }
  set({ connection: publicConnection(connection), status: connection ? 'idle' : returnError ? 'error' : 'off', error: connection ? undefined : returnError, restore: undefined });
  returnError = undefined;
  unsubscribe?.();
  // Edits sync 15 s after they stop; leaving the app syncs at once.
  const offStore = s.subscribe(() => { if (connection) schedule(15_000); });
  const offApp = onAppState(active => { if (connection) { if (!active) void syncNow(); else schedule(1_000); } });
  const onOnline = () => { if (connection) schedule(500); };
  window.addEventListener('online', onOnline);
  unsubscribe = () => { offStore(); offApp(); window.removeEventListener('online', onOnline); };
  if (connection) void syncNow();
}

export function detachCloud(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (timer) clearTimeout(timer);
  timer = null;
  store = null;
  connection = null;
  set({ connection: null, status: 'off', error: undefined, foreignRev: undefined });
}

export async function connectCloud(provider: ProviderId, purpose: OAuthPurpose = 'connect'): Promise<void> {
  if (purpose === 'connect') await session.flush();
  await beginSignIn(provider, purpose);
}

export async function disconnectCloud(): Promise<void> {
  connection = null;
  await persist();
  set({ connection: null, status: 'off', error: undefined, foreignRev: undefined });
}

/** The cloud holds a different vault: replace it with this device's vault. */
export async function replaceCloudWithLocal(): Promise<void> {
  if (!connection || !store) return;
  set({ status: 'syncing' });
  try {
    const rev = await withStorage(s => replaceRemote(io(s), state.foreignRev ?? null));
    connection = { ...connection, lastRev: rev, lastSyncAt: nowStamp() };
    await persist();
    set({ status: 'idle', foreignRev: undefined, connection: publicConnection(connection) });
  } catch (e) {
    set({ status: 'error', error: (e as Error).message });
  }
}

/**
 * On app start: if we are coming back from the provider's sign-in page, finish the sign-in. The
 * tokens wait in memory until the vault is unlocked (connect) or opened from the cloud (restore).
 */
export async function handleOAuthReturn(): Promise<void> {
  if (!cloudSupported()) return;
  const back = readRedirect();
  if (!back?.state) return;
  const p = takePending(back.state);
  if (!p) {
    returnError = 'Sign-in could not be finished because this app lost its place. Open Finora from the Home Screen and try again.';
    set({ status: 'error', error: returnError });
    return;
  }
  if (back.error || !back.code) {
    returnError = back.error === 'access_denied' ? 'Sign-in was cancelled' : `Sign-in failed (${back.error ?? 'no code'})`;
    set({ status: 'error', error: returnError });
    return;
  }
  try {
    const { tokens, account } = await completeSignIn(p.provider, back.code, p.verifier);
    const conn: Connection = { provider: p.provider, account, tokens };
    pending = { connection: conn, purpose: p.purpose };
    if (p.purpose === 'restore') {
      set({ restore: { provider: p.provider, account, file: null, rev: null, checking: true } });
      connection = conn;
      try {
        const remote = await withStorage(s => s.download());
        const file = remote ? decodeCloudFile(remote.bytes).file : null;
        set({ restore: { provider: p.provider, account, file, rev: remote?.rev ?? null, checking: false } });
      } catch (e) {
        set({ restore: { provider: p.provider, account, file: null, rev: null, checking: false, error: (e as Error).message } });
      } finally {
        connection = null;
      }
    } else {
      set({ status: 'idle', connection: publicConnection(conn) });
    }
  } catch (e) {
    returnError = (e as Error).message;
    set({ status: 'error', error: returnError });
  }
}

/** Set up this device from the cloud vault found during restore. */
export async function adoptFromCloud(passphrase: string, deviceId: string) {
  const r = state.restore;
  if (!r?.file || !pending) throw new Error('No cloud vault to open');
  const { file, vault } = decodeCloudFile(new TextEncoder().encode(JSON.stringify(r.file)));
  const data = await session.adoptCloudVault(file.keyring, vault, passphrase, deviceId);
  pending = { ...pending, connection: { ...pending.connection, lastRev: r.rev ?? undefined } };
  return data;
}

export function cancelRestore(): void {
  set({ restore: undefined });
}

export function describeCloud(c: CloudState['connection']): string {
  return c ? `${providerLabel(c.provider)} · ${c.account}` : '';
}
