import { nowStamp } from '../domain/dates';
import { COLLECTIONS, type Settings, type VaultData } from '../domain/types';

export const SCHEMA_VERSION = 2;
export const SELF_OWNER_ID = 'self';

export const DEFAULT_CATEGORIES = [
  'Food', 'Groceries', 'Transport', 'Shopping', 'Bills & Utilities', 'Rent', 'Health',
  'Entertainment', 'Travel', 'Education', 'Personal Care', 'Gifts', 'Fuel', 'Other',
];

export const DEFAULT_INCOME_CATEGORIES = ['Salary', 'Business', 'Interest', 'Dividend', 'Refund', 'Gift', 'Other Income'];

export const DEFAULT_PAYMENT_METHODS = ['UPI', 'Cash', 'Debit Card', 'Credit Card', 'Net Banking', 'Wallet', 'Other'];

export function defaultSettings(): Settings {
  return {
    updatedAt: nowStamp(),
    categories: DEFAULT_CATEGORIES,
    incomeCategories: DEFAULT_INCOME_CATEGORIES,
    paymentMethods: DEFAULT_PAYMENT_METHODS,
    autoLockMinutes: 2,
    privacyMode: false,
    theme: 'dark',
    slabRatePct: '30',
    monthlySavingsTarget: '0',
    dismissedInsights: [],
    smsCaptureEnabled: false,
    biometricEnabled: false,
  };
}

export function emptyVault(deviceId: string, ownerName = 'Me'): VaultData {
  const stamp = nowStamp();
  return {
    owners: [{ id: SELF_OWNER_ID, name: ownerName, relation: 'SELF', createdAt: stamp, updatedAt: stamp }],
    holdings: [],
    txns: [],
    sips: [],
    loans: [],
    loanEvents: [],
    entries: [],
    recurring: [],
    goals: [],
    merchantRules: [],
    snapshots: [],
    settings: defaultSettings(),
    meta: { schemaVersion: SCHEMA_VERSION, deviceId, createdAt: stamp },
  };
}

/**
 * Light structural check on data coming from disk or an import file: every collection must be an
 * array of objects with string ids. Missing collections are filled in; anything else is rejected.
 */
export function normalize(raw: unknown, deviceId: string): VaultData {
  if (!raw || typeof raw !== 'object') throw new Error('Vault data is not an object');
  const input = raw as Record<string, unknown>;
  const base = emptyVault(deviceId);
  const out = { ...base } as VaultData;
  for (const name of COLLECTIONS) {
    const list = input[name];
    if (list === undefined) continue;
    if (!Array.isArray(list)) throw new Error(`Vault field "${name}" is not a list`);
    for (const item of list) {
      if (!item || typeof item !== 'object' || typeof (item as { id?: unknown }).id !== 'string') {
        throw new Error(`Vault field "${name}" has a record without an id`);
      }
    }
    (out as unknown as Record<string, unknown>)[name] = list;
  }
  if (input.settings && typeof input.settings === 'object') {
    out.settings = { ...base.settings, ...(input.settings as Partial<Settings>) };
  }
  if (input.meta && typeof input.meta === 'object') {
    out.meta = { ...base.meta, ...(input.meta as object), schemaVersion: SCHEMA_VERSION };
  }
  if (!out.owners.some(o => o.id === SELF_OWNER_ID)) out.owners = [...base.owners, ...out.owners];
  return out;
}
