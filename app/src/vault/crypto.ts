/**
 * Key hierarchy
 *
 *   passphrase ──PBKDF2──▶ passphrase key ─┐
 *   recovery code ──HKDF──▶ recovery key ──┼─wraps─▶ data key (random AES-256) ──encrypts──▶ vault.bin
 *   Keychain/Keystore (biometric) ─────────┘ holds a copy
 *
 * Autosave only uses the data key, so saving is fast. PBKDF2 runs only on unlock and passphrase change.
 * Export files are independent: they are encrypted with a key derived from the export passphrase.
 */

export const PBKDF2_ITERATIONS = 310_000;
const SALT_LEN = 16;
const IV_LEN = 12;
const VAULT_MAGIC = [0x46, 0x4e, 0x56, 0x32]; // "FNV2"
const EXPORT_MAGIC = [0x46, 0x4e, 0x52, 0x58]; // "FNRX"
const EXPORT_VERSION = 2;

const enc = new TextEncoder();
const dec = new TextDecoder();

type Bytes = Uint8Array<ArrayBuffer>;

export function randomBytes(n: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function fromB64(b64: string): Bytes {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pbkdf2Key(passphrase: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function hkdfKey(secret: Bytes, salt: Bytes, info: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function importDataKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function seal(key: CryptoKey, plain: Bytes): Promise<{ iv: Bytes; ct: Bytes }> {
  const iv = randomBytes(IV_LEN);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, plain));
  return { iv, ct };
}

async function open(key: CryptoKey, iv: Bytes, ct: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, ct));
}

// ── Recovery code ────────────────────────────────────────────────────────────

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 256 random bits as 52 Crockford base32 characters in groups of four. */
export function formatRecoveryCode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join('-');
}

export function parseRecoveryCode(code: string): Bytes {
  const clean = code.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (clean.length !== 52) throw new Error('A recovery code has 52 characters');
  const out = new Uint8Array(32);
  let bits = 0;
  let value = 0;
  let idx = 0;
  for (const ch of clean) {
    const v = CROCKFORD.indexOf(ch);
    if (v === -1) throw new Error(`"${ch}" is not valid in a recovery code`);
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      if (idx < 32) out[idx++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
    value &= 0xff;
  }
  return out;
}

// ── Keyring ──────────────────────────────────────────────────────────────────

interface Wrapped {
  salt: string;
  iv: string;
  ct: string;
}

/** Stored next to vault.bin. Contains no secrets in the clear. */
export interface Keyring {
  version: 1;
  iterations: number;
  passphrase: Wrapped;
  recovery: Wrapped;
}

async function wrapWithPassphrase(dataKey: Bytes, passphrase: string, iterations: number): Promise<Wrapped> {
  const salt = randomBytes(SALT_LEN);
  const { iv, ct } = await seal(await pbkdf2Key(passphrase, salt, iterations), dataKey);
  return { salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
}

async function wrapWithRecovery(dataKey: Bytes, recovery: Bytes): Promise<Wrapped> {
  const salt = randomBytes(SALT_LEN);
  const { iv, ct } = await seal(await hkdfKey(recovery, salt, 'finora-recovery-v1'), dataKey);
  return { salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
}

export async function createKeyring(passphrase: string, iterations = PBKDF2_ITERATIONS): Promise<{ keyring: Keyring; dataKey: Bytes; recoveryCode: string }> {
  const dataKey = randomBytes(32);
  const recovery = randomBytes(32);
  const keyring: Keyring = {
    version: 1,
    iterations,
    passphrase: await wrapWithPassphrase(dataKey, passphrase, iterations),
    recovery: await wrapWithRecovery(dataKey, recovery),
  };
  return { keyring, dataKey, recoveryCode: formatRecoveryCode(recovery) };
}

export class WrongSecretError extends Error {
  constructor(what: string) {
    super(`That ${what} is not correct`);
    this.name = 'WrongSecretError';
  }
}

export async function unlockWithPassphrase(keyring: Keyring, passphrase: string): Promise<Bytes> {
  const w = keyring.passphrase;
  try {
    return await open(await pbkdf2Key(passphrase, fromB64(w.salt), keyring.iterations), fromB64(w.iv), fromB64(w.ct));
  } catch {
    throw new WrongSecretError('passphrase');
  }
}

export async function unlockWithRecovery(keyring: Keyring, code: string): Promise<Bytes> {
  const recovery = parseRecoveryCode(code);
  const w = keyring.recovery;
  try {
    return await open(await hkdfKey(recovery, fromB64(w.salt), 'finora-recovery-v1'), fromB64(w.iv), fromB64(w.ct));
  } catch {
    throw new WrongSecretError('recovery code');
  }
}

export async function changePassphrase(keyring: Keyring, dataKey: Bytes, newPassphrase: string): Promise<Keyring> {
  return { ...keyring, passphrase: await wrapWithPassphrase(dataKey, newPassphrase, keyring.iterations) };
}

export async function newRecoveryCode(keyring: Keyring, dataKey: Bytes): Promise<{ keyring: Keyring; recoveryCode: string }> {
  const recovery = randomBytes(32);
  return { keyring: { ...keyring, recovery: await wrapWithRecovery(dataKey, recovery) }, recoveryCode: formatRecoveryCode(recovery) };
}

// ── vault.bin ────────────────────────────────────────────────────────────────

export async function encryptVault(dataKey: CryptoKey, json: string): Promise<Bytes> {
  const { iv, ct } = await seal(dataKey, enc.encode(json));
  const out = new Uint8Array(4 + IV_LEN + ct.length);
  out.set(VAULT_MAGIC, 0);
  out.set(iv, 4);
  out.set(ct, 4 + IV_LEN);
  return out;
}

export async function decryptVault(dataKey: CryptoKey, bytes: Bytes): Promise<string> {
  if (!VAULT_MAGIC.every((b, i) => bytes[i] === b)) throw new Error('Not a Finora vault file');
  return dec.decode(await open(dataKey, bytes.slice(4, 4 + IV_LEN), bytes.slice(4 + IV_LEN)));
}

// ── Export files (.finora) ───────────────────────────────────────────────────

export async function encryptExport(json: string, passphrase: string, iterations = PBKDF2_ITERATIONS): Promise<Bytes> {
  const salt = randomBytes(SALT_LEN);
  const { iv, ct } = await seal(await pbkdf2Key(passphrase, salt, iterations), enc.encode(json));
  const header = 4 + 1 + 4 + SALT_LEN + IV_LEN;
  const out = new Uint8Array(header + ct.length);
  out.set(EXPORT_MAGIC, 0);
  out[4] = EXPORT_VERSION;
  new DataView(out.buffer).setUint32(5, iterations);
  out.set(salt, 9);
  out.set(iv, 9 + SALT_LEN);
  out.set(ct, header);
  return out;
}

/**
 * Decrypt an export. Accepts the current .finora format and the old web app's .enc vault/backup
 * format (salt‖iv‖ciphertext with PBKDF2-310k), which carried no header.
 */
export async function decryptExport(bytes: Bytes, passphrase: string): Promise<{ json: string; format: 'v2' | 'v1' }> {
  try {
    if (EXPORT_MAGIC.every((b, i) => bytes[i] === b)) {
      const iterations = new DataView(bytes.buffer, bytes.byteOffset).getUint32(5);
      const salt = bytes.slice(9, 9 + SALT_LEN);
      const iv = bytes.slice(9 + SALT_LEN, 9 + SALT_LEN + IV_LEN);
      const ct = bytes.slice(9 + SALT_LEN + IV_LEN);
      return { json: dec.decode(await open(await pbkdf2Key(passphrase, salt, iterations), iv, ct)), format: 'v2' };
    }
    if (bytes.length < SALT_LEN + IV_LEN + 16) throw new Error('File is too small');
    const salt = bytes.slice(0, SALT_LEN);
    const iv = bytes.slice(SALT_LEN, SALT_LEN + IV_LEN);
    const ct = bytes.slice(SALT_LEN + IV_LEN);
    return { json: dec.decode(await open(await pbkdf2Key(passphrase, salt, PBKDF2_ITERATIONS), iv, ct)), format: 'v1' };
  } catch (e) {
    if (e instanceof Error && e.message === 'File is too small') throw e;
    throw new WrongSecretError('passphrase (or the file is not a Finora export)');
  }
}
