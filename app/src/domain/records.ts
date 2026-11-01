import { nowStamp } from './dates';
import type { Base } from './types';

export function newId(): string {
  return crypto.randomUUID();
}

/** Fill in id and timestamps for a new record. Pass `id` for records that must be identical across devices. */
export function create<T extends Base>(fields: Omit<T, keyof Base> & Partial<Base>): T {
  const stamp = nowStamp();
  return { createdAt: stamp, ...fields, id: fields.id ?? newId(), updatedAt: stamp } as T;
}

export function touch<T extends Base>(record: T, changes: Partial<T>): T {
  return { ...record, ...changes, id: record.id, updatedAt: nowStamp() };
}

export function tombstone<T extends Base>(record: T): T {
  const stamp = nowStamp();
  return { ...record, deletedAt: stamp, updatedAt: stamp };
}

export function live<T extends Base>(records: T[]): T[] {
  return records.filter(r => !r.deletedAt);
}

export function byId<T extends Base>(records: T[]): Map<string, T> {
  return new Map(live(records).map(r => [r.id, r]));
}

/** Insert or replace by id, keeping order stable. */
export function upsert<T extends Base>(records: T[], record: T): T[] {
  const idx = records.findIndex(r => r.id === record.id);
  if (idx === -1) return [...records, record];
  const next = records.slice();
  next[idx] = record;
  return next;
}

export function upsertMany<T extends Base>(records: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return records;
  const index = new Map(records.map((r, i) => [r.id, i]));
  const next = records.slice();
  for (const record of incoming) {
    const idx = index.get(record.id);
    if (idx === undefined) {
      index.set(record.id, next.length);
      next.push(record);
    } else {
      next[idx] = record;
    }
  }
  return next;
}

export function remove<T extends Base>(records: T[], id: string): T[] {
  return records.map(r => (r.id === id && !r.deletedAt ? tombstone(r) : r));
}

/** Short stable hash for deterministic ids (FNV-1a, 52-bit safe). Not for security. */
export function stableHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}
