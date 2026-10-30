import { nowStamp } from '../domain/dates';
import { create, remove, touch, upsert } from '../domain/records';
import type { Base, CollectionName, Settings, VaultData } from '../domain/types';
import type { VaultStore } from '../vault/store';
import { toast } from './toast';

export function patchSettings(settings: Settings, changes: Partial<Settings>): Settings {
  return { ...settings, ...changes, updatedAt: nowStamp() };
}

type Rec<K extends CollectionName> = VaultData[K][number];

/** Create or update a record in one collection. */
export function save<K extends CollectionName>(store: VaultStore, name: K, record: Rec<K>): void {
  store.update(d => ({ ...d, [name]: upsert(d[name] as Base[], record) }) as VaultData);
}

export function saveNew<K extends CollectionName>(store: VaultStore, name: K, fields: Omit<Rec<K>, keyof Base> & Partial<Base>): Rec<K> {
  const rec = create(fields as never) as Rec<K>;
  save(store, name, rec);
  return rec;
}

export function edit<K extends CollectionName>(store: VaultStore, name: K, record: Rec<K>, changes: Partial<Rec<K>>): void {
  save(store, name, touch(record as Base, changes as Partial<Base>) as Rec<K>);
}

/** Delete with an undo snackbar instead of a confirmation dialog. */
export function removeWithUndo<K extends CollectionName>(store: VaultStore, name: K, id: string, label: string, also?: (d: VaultData) => VaultData): void {
  store.update(d => {
    const next = { ...d, [name]: remove(d[name] as Base[], id) } as VaultData;
    return also ? also(next) : next;
  }, label);
  toast.info(label, { label: 'Undo', onClick: () => store.undo() });
}

export function setSettings(store: VaultStore, changes: Partial<Settings>): void {
  store.update(d => ({ ...d, settings: patchSettings(d.settings, changes) }));
}
