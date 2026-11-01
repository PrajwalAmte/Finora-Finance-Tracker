import { describe, expect, it } from 'vitest';
import { syncOnce, replaceRemote, type SyncIO } from './sync';
import { encodeCloudFile } from './format';
import { ConflictError, type CloudStorage, type RemoteFile } from './types';
import { createKeyring, decryptVault, encryptVault, importDataKey } from '../vault/crypto';
import { emptyVault } from '../vault/schema';
import { create, touch } from '../domain/records';
import { challengeFor } from './oauth';
import type { Entry, VaultData } from '../domain/types';

/** In-memory provider with revisions and conditional writes, like Dropbox. */
class MemoryCloud implements CloudStorage {
  file: RemoteFile | null = null;
  n = 0;
  /** Simulate another device writing between our read and write. */
  interleave?: () => void;
  async download() { return this.file ? { bytes: this.file.bytes, rev: this.file.rev } : null; }
  async upload(bytes: Uint8Array, rev: string | null) {
    this.interleave?.();
    this.interleave = undefined;
    if ((this.file?.rev ?? null) !== rev) throw new ConflictError();
    this.file = { bytes: new Uint8Array(bytes), rev: `r${++this.n}` };
    return this.file.rev;
  }
}

const entry = (description: string) => create<Entry>({ ownerId: 'self', kind: 'EXPENSE', date: '2026-10-01', amount: '100', description, category: 'Food', paymentMethod: 'UPI', source: 'MANUAL' });
const tick = () => new Promise(r => setTimeout(r, 3));

async function device(cloud: CloudStorage, raw: Uint8Array<ArrayBuffer>, keyring: Awaited<ReturnType<typeof createKeyring>>['keyring'], id: string, initial: VaultData) {
  const key = await importDataKey(raw);
  let data = initial;
  const io: SyncIO = {
    storage: cloud,
    local: () => data,
    apply: d => { data = d; },
    seal: async d => encodeCloudFile(keyring, await encryptVault(key, JSON.stringify(d)), id, new Date().toISOString()),
    open: async v => { try { return JSON.parse(await decryptVault(key, v)) as VaultData; } catch { return null; } },
  };
  return { io, get data() { return data; }, set data(d: VaultData) { data = d; } };
}

describe('syncOnce', () => {
  it('uploads the first copy, then merges edits from two devices both ways', async () => {
    const cloud = new MemoryCloud();
    const { keyring, dataKey } = await createKeyring('pass phrase', 1000);
    const base = emptyVault('a');
    const a = await device(cloud, dataKey, keyring, 'a', { ...base, entries: [entry('tea')] });
    expect(await syncOnce(a.io)).toMatchObject({ kind: 'synced', pushed: true, pulled: 0 });

    const b = await device(cloud, dataKey, keyring, 'b', { ...emptyVault('b'), owners: base.owners, settings: base.settings });
    expect(await syncOnce(b.io)).toMatchObject({ kind: 'synced', pulled: 1, pushed: false });
    expect(b.data.entries.map(e => e.description)).toEqual(['tea']);

    await tick();
    b.data = { ...b.data, entries: [...b.data.entries, entry('lunch')] };
    a.data = { ...a.data, entries: [touch(a.data.entries[0], { description: 'masala tea' })] };
    await syncOnce(b.io);
    const res = await syncOnce(a.io);
    expect(res).toMatchObject({ kind: 'synced', pulled: 1, pushed: true });
    await syncOnce(b.io);
    const names = (d: VaultData) => d.entries.map(e => e.description).sort();
    expect(names(a.data)).toEqual(['lunch', 'masala tea']);
    expect(names(b.data)).toEqual(['lunch', 'masala tea']);
  });

  it('nothing to do when both sides match', async () => {
    const cloud = new MemoryCloud();
    const { keyring, dataKey } = await createKeyring('p', 1000);
    const a = await device(cloud, dataKey, keyring, 'a', { ...emptyVault('a'), entries: [entry('x')] });
    await syncOnce(a.io);
    const before = cloud.n;
    expect(await syncOnce(a.io)).toMatchObject({ pushed: false, pulled: 0 });
    expect(cloud.n).toBe(before);
  });

  it('re-reads and merges when another device saved in between', async () => {
    const cloud = new MemoryCloud();
    const { keyring, dataKey } = await createKeyring('p', 1000);
    const base = emptyVault('a');
    const a = await device(cloud, dataKey, keyring, 'a', { ...base, entries: [entry('one')] });
    await syncOnce(a.io);
    const b = await device(cloud, dataKey, keyring, 'b', { ...base, entries: [] });
    await syncOnce(b.io);
    await tick();
    a.data = { ...a.data, entries: [...a.data.entries, entry('from a')] };
    b.data = { ...b.data, entries: [...b.data.entries, entry('from b')] };
    // b saves its copy just as a is about to write: a's conditional write conflicts, so a re-reads,
    // merges b's entry and writes again.
    const bBytes = await b.io.seal(b.data);
    cloud.interleave = () => { cloud.file = { bytes: new Uint8Array(bBytes), rev: `r${++cloud.n}` }; };
    await syncOnce(a.io);
    await syncOnce(b.io);
    expect(a.data.entries.map(e => e.description).sort()).toEqual(['from a', 'from b', 'one']);
    expect(b.data.entries.map(e => e.description).sort()).toEqual(['from a', 'from b', 'one']);
  });

  it('reports a cloud vault that belongs to someone else instead of merging or overwriting it', async () => {
    const cloud = new MemoryCloud();
    const other = await createKeyring('other', 1000);
    const x = await device(cloud, other.dataKey, other.keyring, 'x', { ...emptyVault('x'), entries: [entry('theirs')] });
    await syncOnce(x.io);
    const mine = await createKeyring('mine', 1000);
    const me = await device(cloud, mine.dataKey, mine.keyring, 'me', { ...emptyVault('me'), entries: [entry('mine')] });
    const res = await syncOnce(me.io);
    expect(res.kind).toBe('foreign');
    expect(me.data.entries.map(e => e.description)).toEqual(['mine']);
    // The user chose "Replace with this device's vault".
    await replaceRemote(me.io, res.rev);
    expect((await syncOnce(me.io)).kind).toBe('synced');
  });
});

describe('PKCE', () => {
  it('matches the RFC 7636 test vector', async () => {
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});
