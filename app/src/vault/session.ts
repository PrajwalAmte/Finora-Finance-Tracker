import { newId } from '../domain/records';
import { nowStamp } from '../domain/dates';
import type { VaultData } from '../domain/types';
import * as files from '../platform/files';
import * as secure from '../platform/secure';
import {
  changePassphrase, createKeyring, decryptExport, decryptVault, encryptExport, encryptVault, fromB64,
  importDataKey, newRecoveryCode, toB64, unlockWithPassphrase, unlockWithRecovery, type Keyring,
} from './crypto';
import { emptyVault, normalize } from './schema';
import { toCurrent } from './migrate';

const KEYRING = 'keyring.json';
const VAULT = 'vault.bin';

type Bytes = Uint8Array<ArrayBuffer>;

/**
 * Owns the on-disk vault and the unlocked data key. Everything outside this module sees only
 * plaintext VaultData while unlocked and nothing while locked.
 */
export class VaultSession {
  private keyring: Keyring | null = null;
  private rawKey: Bytes | null = null;
  private key: CryptoKey | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: VaultData | null = null;
  private saving: Promise<void> = Promise.resolve();
  onSaveError: (e: unknown) => void = () => {};

  async hasVault(): Promise<boolean> {
    return files.exists(KEYRING);
  }

  get unlocked(): boolean {
    return this.key !== null;
  }

  private async loadKeyring(): Promise<Keyring> {
    if (this.keyring) return this.keyring;
    const text = await files.readText(KEYRING);
    if (!text) throw new Error('No vault on this device');
    this.keyring = JSON.parse(text) as Keyring;
    return this.keyring;
  }

  private async useKey(raw: Bytes): Promise<VaultData> {
    this.rawKey = raw;
    this.key = await importDataKey(raw);
    return this.readVault();
  }

  private async readVault(): Promise<VaultData> {
    const tryRead = async (name: string) => {
      const bytes = await files.readBytes(name);
      if (!bytes) return null;
      return JSON.parse(await decryptVault(this.key!, bytes)) as unknown;
    };
    let raw: unknown = null;
    try {
      raw = await tryRead(VAULT);
    } catch {
      // Damaged main file: fall back to the previous good copy.
      raw = await tryRead(`${VAULT}.bak`);
    }
    if (!raw) raw = await tryRead(`${VAULT}.bak`);
    if (!raw) throw new Error('The vault file could not be read');
    return toCurrent(raw, (raw as VaultData).meta?.deviceId ?? newId());
  }

  /** Create a new vault. Returns the recovery code, which is shown once and never stored. */
  async create(passphrase: string, ownerName: string, initial?: VaultData): Promise<{ data: VaultData; recoveryCode: string }> {
    const { keyring, dataKey, recoveryCode } = await createKeyring(passphrase);
    await files.writeAtomic(KEYRING, JSON.stringify(keyring));
    this.keyring = keyring;
    this.rawKey = dataKey;
    this.key = await importDataKey(dataKey);
    const data = initial ?? emptyVault(newId(), ownerName);
    await this.writeNow(data);
    return { data, recoveryCode };
  }

  async unlockWithPassphrase(passphrase: string): Promise<VaultData> {
    return this.useKey(await unlockWithPassphrase(await this.loadKeyring(), passphrase));
  }

  async unlockWithRecovery(code: string): Promise<VaultData> {
    return this.useKey(await unlockWithRecovery(await this.loadKeyring(), code));
  }

  /** Returns null when biometrics are off, cancelled or unavailable. */
  async unlockWithBiometric(): Promise<VaultData | null> {
    const stored = await secure.loadDataKey();
    if (!stored) return null;
    if (!(await secure.promptBiometric('Unlock your vault'))) return null;
    return this.useKey(fromB64(stored));
  }

  async enableBiometric(): Promise<boolean> {
    if (!this.rawKey) throw new Error('Vault is locked');
    if (!(await secure.promptBiometric('Turn on biometric unlock'))) return false;
    await secure.storeDataKey(toB64(this.rawKey));
    return true;
  }

  async disableBiometric(): Promise<void> {
    await secure.clearDataKey();
  }

  async changePassphrase(current: string, next: string): Promise<void> {
    const keyring = await this.loadKeyring();
    const raw = await unlockWithPassphrase(keyring, current);
    this.keyring = await changePassphrase(keyring, raw, next);
    await files.writeAtomic(KEYRING, JSON.stringify(this.keyring));
  }

  async regenerateRecoveryCode(): Promise<string> {
    if (!this.rawKey) throw new Error('Vault is locked');
    const res = await newRecoveryCode(await this.loadKeyring(), this.rawKey);
    this.keyring = res.keyring;
    await files.writeAtomic(KEYRING, JSON.stringify(this.keyring));
    return res.recoveryCode;
  }

  /** Debounced autosave; call on every change. */
  save(data: VaultData): void {
    this.pending = data;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush().catch(this.onSaveError);
    }, 600);
  }

  /** Write any pending change immediately (on background, lock, before export). */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const data = this.pending;
    this.pending = null;
    if (data) this.saving = this.saving.then(() => this.writeNow(data));
    await this.saving;
  }

  private async writeNow(data: VaultData): Promise<void> {
    if (!this.key) throw new Error('Vault is locked');
    await files.writeAtomic(VAULT, await encryptVault(this.key, JSON.stringify(data)), true);
  }

  async lock(): Promise<void> {
    await this.flush().catch(this.onSaveError);
    this.key = null;
    this.rawKey = null;
  }

  /** Encrypted export for the share sheet. */
  async exportFile(data: VaultData, passphrase: string): Promise<Bytes> {
    return encryptExport(JSON.stringify({ ...data, meta: { ...data.meta }, exportedAt: nowStamp() }), passphrase);
  }

  /** Decrypt and upgrade an import. Accepts .finora and the old web app's .enc files. */
  async readImport(bytes: Bytes, passphrase: string, deviceId: string): Promise<{ data: VaultData; format: 'v2' | 'v1' }> {
    const { json, format } = await decryptExport(bytes, passphrase);
    const parsed = JSON.parse(json) as unknown;
    return { data: format === 'v2' ? normalize(parsed, deviceId) : toCurrent(parsed, deviceId), format };
  }

  /** Erase the vault from this device. */
  async erase(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.pending = null;
    this.key = null;
    this.rawKey = null;
    this.keyring = null;
    await secure.clearDataKey();
    for (const name of [KEYRING, VAULT, `${VAULT}.bak`, `${VAULT}.tmp`]) await files.removeFile(name);
  }
}

export const session = new VaultSession();
