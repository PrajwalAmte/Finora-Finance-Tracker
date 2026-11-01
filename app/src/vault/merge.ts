import { COLLECTIONS, type Base, type CollectionName, type VaultData } from '../domain/types';

export interface CollectionStats {
  added: number;
  updated: number;
  deleted: number;
  /** Records where this device had the newer version, so the incoming copy was ignored. */
  keptLocal: number;
}

export interface MergePreview {
  data: VaultData;
  stats: Record<CollectionName, CollectionStats>;
  totals: CollectionStats;
  settingsUpdated: boolean;
}

function mergeList<T extends Base>(local: T[], incoming: T[], stats: CollectionStats): T[] {
  const index = new Map(local.map((r, i) => [r.id, i]));
  const out = local.slice();
  for (const rec of incoming) {
    const i = index.get(rec.id);
    if (i === undefined) {
      if (rec.deletedAt) {
        // A delete for something we never had: keep the marker so it propagates further.
        out.push(rec);
        continue;
      }
      index.set(rec.id, out.length);
      out.push(rec);
      stats.added++;
      continue;
    }
    const mine = out[i];
    if (rec.updatedAt > mine.updatedAt) {
      out[i] = rec;
      if (rec.deletedAt && !mine.deletedAt) stats.deleted++;
      else if (!rec.deletedAt) stats.updated++;
    } else if (rec.updatedAt < mine.updatedAt && JSON.stringify(rec) !== JSON.stringify(mine)) {
      stats.keptLocal++;
    }
  }
  return out;
}

/**
 * Merge an imported vault into this one. Records are matched by id and the newer `updatedAt` wins,
 * including deletion markers. Nothing is lost: the losing version of a record is simply not applied.
 */
export function merge(local: VaultData, incoming: VaultData): MergePreview {
  const stats = {} as Record<CollectionName, CollectionStats>;
  const totals: CollectionStats = { added: 0, updated: 0, deleted: 0, keptLocal: 0 };
  const data = { ...local } as VaultData;

  for (const name of COLLECTIONS) {
    const s: CollectionStats = { added: 0, updated: 0, deleted: 0, keptLocal: 0 };
    (data as unknown as Record<string, Base[]>)[name] = mergeList(local[name] as Base[], incoming[name] as Base[], s);
    stats[name] = s;
    totals.added += s.added;
    totals.updated += s.updated;
    totals.deleted += s.deleted;
    totals.keptLocal += s.keptLocal;
  }

  const settingsUpdated = incoming.settings.updatedAt > local.settings.updatedAt;
  if (settingsUpdated) {
    // Device-specific choices stay with the device.
    data.settings = {
      ...incoming.settings,
      biometricEnabled: local.settings.biometricEnabled,
      smsCaptureEnabled: local.settings.smsCaptureEnabled,
      lastExportAt: local.settings.lastExportAt,
    };
  }
  data.meta = local.meta;
  return { data, stats, totals, settingsUpdated };
}

/** Replace everything with the import, keeping this device's identity. */
export function replaceAll(local: VaultData, incoming: VaultData): VaultData {
  return { ...incoming, meta: { ...incoming.meta, deviceId: local.meta.deviceId } };
}
