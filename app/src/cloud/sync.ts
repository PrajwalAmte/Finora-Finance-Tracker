import { merge } from '../vault/merge';
import type { VaultData } from '../domain/types';
import { decodeCloudFile } from './format';
import { ConflictError, type CloudStorage } from './types';

export interface SyncIO {
  storage: CloudStorage;
  /** Current local data. */
  local(): VaultData;
  /** Replace local data with the merged result. */
  apply(data: VaultData): void;
  /** Encrypt for upload (cloud file bytes). */
  seal(data: VaultData): Promise<Uint8Array>;
  /** Decrypt a remote vault with this device's key; null when it belongs to another vault. */
  open(vault: Uint8Array<ArrayBuffer>): Promise<VaultData | null>;
}

export type SyncResult =
  | { kind: 'synced'; rev: string; pulled: number; pushed: boolean }
  /** The cloud already holds a different Finora vault (created elsewhere with another key). */
  | { kind: 'foreign'; rev: string; remoteUpdatedAt: string };

const changes = (t: { added: number; updated: number; deleted: number }) => t.added + t.updated + t.deleted;

/**
 * One sync round: pull the cloud copy, merge it into local data (newer edit wins per record, the
 * same rule as file import), then push the result if the cloud is missing anything. The write is
 * conditional on the revision we read, so two devices saving at once never overwrite each other:
 * the loser re-reads, re-merges and tries again.
 */
export async function syncOnce(io: SyncIO, maxAttempts = 4): Promise<SyncResult> {
  for (let attempt = 1; ; attempt++) {
    const remote = await io.storage.download();
    let data = io.local();
    let pulled = 0;
    if (remote) {
      const { file, vault } = decodeCloudFile(remote.bytes);
      const remoteData = await io.open(vault);
      if (!remoteData) return { kind: 'foreign', rev: remote.rev, remoteUpdatedAt: file.updatedAt };
      const incoming = merge(data, remoteData);
      pulled = changes(incoming.totals);
      if (pulled || incoming.settingsUpdated) {
        io.apply(incoming.data);
        data = incoming.data;
      }
      const outgoing = merge(remoteData, data);
      if (!changes(outgoing.totals) && !outgoing.settingsUpdated) return { kind: 'synced', rev: remote.rev, pulled, pushed: false };
    }
    try {
      const rev = await io.storage.upload(await io.seal(data), remote?.rev ?? null);
      return { kind: 'synced', rev, pulled, pushed: true };
    } catch (e) {
      if (e instanceof ConflictError && attempt < maxAttempts) continue;
      throw e;
    }
  }
}

/** Overwrite whatever is in the cloud with this device's vault (after the user confirms). */
export async function replaceRemote(io: SyncIO, rev: string | null): Promise<string> {
  return io.storage.upload(await io.seal(io.local()), rev);
}
