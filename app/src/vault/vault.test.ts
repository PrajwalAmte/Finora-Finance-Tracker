import { describe, expect, it } from 'vitest';
import {
  createKeyring, decryptExport, decryptVault, encryptExport, encryptVault, formatRecoveryCode, importDataKey,
  parseRecoveryCode, randomBytes, unlockWithPassphrase, unlockWithRecovery, changePassphrase, WrongSecretError,
} from './crypto';
import { migrateV1 } from './migrate';
import { merge } from './merge';
import { emptyVault } from './schema';
import { create, remove, touch } from '../domain/records';
import type { Entry } from '../domain/types';

const FAST = 1000;

describe('recovery code', () => {
  it('round-trips 32 bytes through 13 groups of 4 and tolerates case and look-alikes', () => {
    const bytes = randomBytes(32);
    const code = formatRecoveryCode(bytes);
    expect(code.split('-')).toHaveLength(13);
    expect(Array.from(parseRecoveryCode(code.toLowerCase()))).toEqual(Array.from(bytes));
    expect(Array.from(parseRecoveryCode(code.replace(/0/g, 'O').replace(/1/g, 'I')))).toEqual(Array.from(bytes));
  });
});

describe('keyring', () => {
  it('unlocks the same data key with the passphrase or the recovery code', async () => {
    const { keyring, dataKey, recoveryCode } = await createKeyring('correct horse', FAST);
    expect(Array.from(await unlockWithPassphrase(keyring, 'correct horse'))).toEqual(Array.from(dataKey));
    expect(Array.from(await unlockWithRecovery(keyring, recoveryCode))).toEqual(Array.from(dataKey));
    await expect(unlockWithPassphrase(keyring, 'wrong')).rejects.toBeInstanceOf(WrongSecretError);
  });

  it('changing the passphrase keeps the data key', async () => {
    const { keyring, dataKey } = await createKeyring('one', FAST);
    const next = await changePassphrase(keyring, dataKey, 'two');
    expect(Array.from(await unlockWithPassphrase(next, 'two'))).toEqual(Array.from(dataKey));
    await expect(unlockWithPassphrase(next, 'one')).rejects.toThrow();
  });

  it('encrypts and decrypts vault.bin with the data key', async () => {
    const key = await importDataKey(randomBytes(32));
    const blob = await encryptVault(key, '{"hello":"world"}');
    expect(await decryptVault(key, blob)).toBe('{"hello":"world"}');
  });
});

describe('export files', () => {
  it('round-trips the .finora format', async () => {
    const bytes = await encryptExport('{"a":1}', 'pass', FAST);
    expect(await decryptExport(bytes, 'pass')).toEqual({ json: '{"a":1}', format: 'v2' });
    await expect(decryptExport(bytes, 'nope')).rejects.toBeInstanceOf(WrongSecretError);
  });

  it('opens files written by the old web app (salt‖iv‖ciphertext, PBKDF2-310k)', async () => {
    // Same steps as the old local-vault-crypto.ts encryptVault.
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode('legacy'), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, new TextEncoder().encode('{"v":1}')));
    const file = new Uint8Array(16 + 12 + ct.length);
    file.set(salt, 0); file.set(iv, 16); file.set(ct, 28);
    expect(await decryptExport(file, 'legacy')).toEqual({ json: '{"v":1}', format: 'v1' });
  });
});

describe('migrateV1', () => {
  it('turns old investments into holdings with an opening buy, and keeps loans, SIPs and expenses', () => {
    const v1 = {
      version: '1.0',
      data: {
        expenses: [{ id: 7, description: 'Chai', amount: 20, date: '2025-05-01', category: 'Coffee', paymentMethod: 'UPI' }],
        investments: [{ id: 3, name: 'Infosys', symbol: 'INFY', type: 'STOCK', quantity: 10, purchasePrice: 1500, currentPrice: 1800, purchaseDate: '2023-02-01' }],
        loans: [{ id: 1, name: 'Car', principalAmount: 500000, interestRate: 9, interestType: 'COMPOUND', compoundingFrequency: 'MONTHLY', startDate: '2024-01-10', tenureMonths: 60, emiAmount: 10379, currentBalance: 420000, lastUpdated: '2025-01-10' }],
        sips: [{ id: 2, name: 'Index SIP', schemeCode: '120716', monthlyAmount: 5000, startDate: '2025-06-05', totalUnits: 100, totalInvested: 5000, investmentId: 3 }],
      },
    };
    const v2 = migrateV1(v1, 'dev');
    expect(v2.holdings).toHaveLength(1);
    expect(v2.holdings[0]).toMatchObject({ id: 'v1-inv-3', taxClass: 'EQUITY', currentPrice: '1800' });
    expect(v2.txns[0]).toMatchObject({ kind: 'BUY', units: '10', price: '1500', amount: '15000', date: '2023-02-01' });
    expect(v2.loans[0]).toMatchObject({ balance: '420000', balanceAsOf: '2025-01-10', emi: '10379', emiDay: 10 });
    expect(v2.sips[0]).toMatchObject({ holdingId: 'v1-inv-3', dayOfMonth: 5, lastInstallment: '2025-05-05', autoRecord: false });
    expect(v2.entries[0]).toMatchObject({ id: 'v1-exp-7', amount: '20', kind: 'EXPENSE' });
    expect(v2.settings.categories).toContain('Coffee');
  });

  it('reads the old server backup layout (collections at the top level)', () => {
    const v2 = migrateV1({ metadata: {}, expenses: [{ id: 1, description: 'x', amount: 5, date: '2025-01-01', category: 'Food', paymentMethod: 'Cash' }], ledgerEvents: [{}] }, 'dev');
    expect(v2.entries).toHaveLength(1);
  });
});

describe('merge', () => {
  const entry = (fields: Partial<Entry> = {}) => create<Entry>({ ownerId: 'self', kind: 'EXPENSE', date: '2026-10-01', amount: '100', description: 'x', category: 'Food', paymentMethod: 'UPI', source: 'MANUAL', ...fields });

  it('adds new records, applies newer edits and deletes, and keeps newer local edits', async () => {
    const a = entry({ description: 'a' });
    const b = entry({ description: 'b' });
    const c = entry({ description: 'c' });
    const local = { ...emptyVault('phone-a'), entries: [a, b, c] };

    await new Promise(r => setTimeout(r, 5));
    const remote = {
      ...emptyVault('phone-b'),
      owners: local.owners,
      entries: [touch(a, { description: 'a-edited' }), ...remove([b], b.id), c, entry({ description: 'new' })],
    };
    await new Promise(r => setTimeout(r, 5));
    const localNewer = { ...local, entries: [a, b, touch(c, { description: 'c-local' })] };

    const res = merge(localNewer, remote);
    const byDesc = res.data.entries.filter(e => !e.deletedAt).map(e => e.description).sort();
    expect(byDesc).toEqual(['a-edited', 'c-local', 'new']);
    expect(res.totals).toEqual({ added: 1, updated: 1, deleted: 1, keptLocal: 1 });
    expect(res.data.meta.deviceId).toBe('phone-a');
  });

  it('is idempotent', () => {
    const local = { ...emptyVault('a'), entries: [entry()] };
    const once = merge(local, local);
    expect(once.totals).toEqual({ added: 0, updated: 0, deleted: 0, keptLocal: 0 });
  });
});
