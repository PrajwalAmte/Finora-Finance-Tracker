import { emptyVault } from '../vault/schema';
import { create } from './records';
import type { Holding, Txn, VaultData } from './types';

/** Shared builders for domain tests. */
export function vault(overrides: Partial<VaultData> = {}): VaultData {
  return { ...emptyVault('test-device'), ...overrides };
}

export function holding(fields: Partial<Holding> = {}): Holding {
  return create<Holding>({ ownerId: 'self', name: 'Test Fund', type: 'MUTUAL_FUND', taxClass: 'EQUITY', ...fields });
}

export function buy(holdingId: string, date: string, units: string, price: string, extra: Partial<Txn> = {}): Txn {
  return create<Txn>({ holdingId, date, kind: 'BUY', units, price, amount: (Number(units) * Number(price)).toFixed(2), ...extra });
}

export function sell(holdingId: string, date: string, units: string, price: string, extra: Partial<Txn> = {}): Txn {
  return create<Txn>({ holdingId, date, kind: 'SELL', units, price, amount: (Number(units) * Number(price)).toFixed(2), ...extra });
}
