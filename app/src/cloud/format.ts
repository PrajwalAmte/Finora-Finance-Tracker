import { fromB64, toB64, type Keyring } from '../vault/crypto';

/**
 * The single file kept in Google Drive or Dropbox. It holds the keyring (data key wrapped by the
 * passphrase and recovery code) and the vault encrypted with that data key, so the provider only
 * ever stores ciphertext, and any device that knows the passphrase can open it.
 */
export interface CloudFile {
  format: 'finora-cloud';
  version: 1;
  updatedAt: string;
  deviceId: string;
  keyring: Keyring;
  vault: string;
}

export const CLOUD_FILE_NAME = 'Finora vault.finora-sync';

export function encodeCloudFile(keyring: Keyring, vault: Uint8Array, deviceId: string, updatedAt: string): Uint8Array<ArrayBuffer> {
  const file: CloudFile = { format: 'finora-cloud', version: 1, updatedAt, deviceId, keyring, vault: toB64(vault) };
  return new TextEncoder().encode(JSON.stringify(file));
}

export function decodeCloudFile(bytes: Uint8Array): { file: CloudFile; vault: Uint8Array<ArrayBuffer> } {
  let file: CloudFile;
  try {
    file = JSON.parse(new TextDecoder().decode(bytes)) as CloudFile;
  } catch {
    throw new Error('The cloud file is not a Finora vault');
  }
  if (file?.format !== 'finora-cloud' || file.version !== 1 || !file.keyring || typeof file.vault !== 'string') {
    throw new Error('The cloud file is not a Finora vault (or was made by a newer version)');
  }
  return { file, vault: fromB64(file.vault) };
}
