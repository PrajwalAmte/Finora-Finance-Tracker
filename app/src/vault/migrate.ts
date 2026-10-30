import { D, dec, price, units } from '../domain/money';
import { addMonths, isISODate, today } from '../domain/dates';
import { create } from '../domain/records';
import { emiFor, monthlyRate } from '../domain/loans';
import type { AssetType, Compounding, Entry, Holding, InterestType, Loan, Sip, TaxClass, Txn, VaultData } from '../domain/types';
import { SCHEMA_VERSION, SELF_OWNER_ID, emptyVault, normalize } from './schema';

/* Shapes written by the old web app (local vault .enc files and server backups). */
interface V1Expense { id?: number; description: string; amount: number; date: string; category: string; paymentMethod: string }
interface V1Investment { id?: number; name: string; symbol?: string; type?: string; quantity: number; purchasePrice: number; currentPrice?: number; purchaseDate?: string; lastUpdated?: string; isin?: string; importSource?: string }
interface V1Loan { id?: number; name: string; principalAmount: number; interestRate: number; interestType?: string; compoundingFrequency?: string; startDate: string; tenureMonths: number; emiAmount?: number; currentBalance?: number; lastUpdated?: string }
interface V1Sip { id?: number; name: string; schemeCode?: string; monthlyAmount: number; startDate: string; durationMonths?: number; currentNav?: number; totalUnits?: number; lastInvestmentDate?: string; isin?: string; totalInvested?: number; investmentId?: number }
interface V1Data { expenses?: V1Expense[]; investments?: V1Investment[]; loans?: V1Loan[]; sips?: V1Sip[] }

const ASSET_TYPES: AssetType[] = ['MUTUAL_FUND', 'STOCK', 'ETF', 'BOND', 'GOLD', 'FD', 'OTHER'];

function assetType(t?: string): AssetType {
  return ASSET_TYPES.includes(t as AssetType) ? (t as AssetType) : 'OTHER';
}

function taxClassFor(type: AssetType): TaxClass {
  if (type === 'BOND' || type === 'FD') return 'DEBT';
  if (type === 'GOLD' || type === 'OTHER') return 'OTHER';
  return 'EQUITY';
}

const day = (d: string | undefined, fallback: string) => (d && isISODate(d.slice(0, 10)) ? d.slice(0, 10) : fallback);

export function isV2(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as { meta?: { schemaVersion?: number } }).meta?.schemaVersion === SCHEMA_VERSION;
}

/**
 * Convert old web-app data into the v2 model. Ids are derived from the old numeric ids, so importing
 * the same old file twice merges instead of duplicating. Old investments become one holding plus a
 * single opening BUY at the average price.
 */
export function migrateV1(raw: unknown, deviceId: string): VaultData {
  const root = raw as { data?: V1Data } & V1Data;
  const src: V1Data = root.data ?? root;
  const out = emptyVault(deviceId);
  const fallbackDate = today();

  const holdings: Holding[] = [];
  const txns: Txn[] = [];
  const holdingByOldId = new Map<number, Holding>();

  for (const inv of src.investments ?? []) {
    const type = assetType(inv.type);
    const h = create<Holding>({
      id: `v1-inv-${inv.id ?? holdings.length}`,
      ownerId: SELF_OWNER_ID, name: inv.name, type, taxClass: taxClassFor(type),
      symbol: inv.symbol || undefined, isin: inv.isin || undefined,
      currentPrice: inv.currentPrice ? price(inv.currentPrice) : undefined,
      priceDate: inv.lastUpdated ? day(inv.lastUpdated, fallbackDate) : undefined,
      importSource: inv.importSource || 'WEB_V1',
      notes: 'Imported from the old app with an average-price opening balance.',
    });
    holdings.push(h);
    if (inv.id !== undefined) holdingByOldId.set(inv.id, h);
    if (inv.quantity > 0) {
      txns.push(create<Txn>({
        id: `v1-inv-${inv.id ?? holdings.length}-open`,
        holdingId: h.id, date: day(inv.purchaseDate, fallbackDate), kind: 'BUY',
        units: units(inv.quantity), price: price(inv.purchasePrice), amount: dec(D(inv.quantity).times(inv.purchasePrice)),
        source: 'IMPORT',
      }));
    }
  }

  const sips: Sip[] = [];
  for (const s of src.sips ?? []) {
    let holding = s.investmentId !== undefined ? holdingByOldId.get(s.investmentId) : undefined;
    const last = s.lastInvestmentDate ? day(s.lastInvestmentDate, fallbackDate) : undefined;
    if (!holding && (s.totalUnits ?? 0) > 0) {
      holding = create<Holding>({
        id: `v1-sip-${s.id}-holding`, ownerId: SELF_OWNER_ID, name: s.name, type: 'MUTUAL_FUND', taxClass: 'EQUITY',
        schemeCode: s.schemeCode || undefined, isin: s.isin || undefined,
        currentPrice: s.currentNav ? price(s.currentNav) : undefined, importSource: 'WEB_V1',
      });
      holdings.push(holding);
      const invested = D(s.totalInvested ?? 0);
      txns.push(create<Txn>({
        id: `v1-sip-${s.id}-open`, holdingId: holding.id, date: last ?? fallbackDate, kind: 'BUY',
        units: units(s.totalUnits), price: price(invested.div(D(s.totalUnits))), amount: dec(invested), source: 'IMPORT',
      }));
    }
    const next = day(s.startDate, fallbackDate);
    sips.push(create<Sip>({
      id: `v1-sip-${s.id}`, ownerId: SELF_OWNER_ID, name: s.name, holdingId: holding?.id,
      schemeCode: s.schemeCode || undefined, isin: s.isin || undefined,
      amount: dec(s.monthlyAmount), dayOfMonth: Number(next.slice(8, 10)),
      startDate: last ?? next,
      endDate: s.durationMonths ? addMonths(last ?? next, s.durationMonths) : undefined,
      status: 'ACTIVE', autoRecord: false,
      // The old app advanced startDate to the next due date, so everything before it was handled.
      lastInstallment: addMonths(next, -1),
    }));
  }

  const loans: Loan[] = [];
  for (const l of src.loans ?? []) {
    const interestType: InterestType = l.interestType === 'SIMPLE' ? 'SIMPLE' : 'COMPOUND';
    const compounding: Compounding = (['MONTHLY', 'QUARTERLY', 'YEARLY'] as const).find(c => c === l.compoundingFrequency) ?? 'MONTHLY';
    const startDate = day(l.startDate, fallbackDate);
    const emi = l.emiAmount && l.emiAmount > 0 ? D(l.emiAmount) : emiFor(l.principalAmount, monthlyRate(l.interestRate, interestType, compounding), l.tenureMonths);
    loans.push(create<Loan>({
      id: `v1-loan-${l.id}`, ownerId: SELF_OWNER_ID, name: l.name,
      principal: dec(l.principalAmount), annualRate: dec(l.interestRate, 4), interestType, compounding,
      startDate, tenureMonths: l.tenureMonths, emi: dec(emi), emiDay: Number(startDate.slice(8, 10)),
      balance: dec(l.currentBalance ?? l.principalAmount), balanceAsOf: day(l.lastUpdated, startDate),
    }));
  }

  const categories = new Set(out.settings.categories);
  const methods = new Set(out.settings.paymentMethods);
  const entries: Entry[] = (src.expenses ?? []).map((e, i) => {
    if (e.category) categories.add(e.category);
    if (e.paymentMethod) methods.add(e.paymentMethod);
    return create<Entry>({
      id: `v1-exp-${e.id ?? i}`, ownerId: SELF_OWNER_ID, kind: 'EXPENSE', date: day(e.date, fallbackDate),
      amount: dec(e.amount), description: e.description, category: e.category || 'Other',
      paymentMethod: e.paymentMethod || 'Other', source: 'IMPORT',
    });
  });

  return {
    ...out,
    holdings, txns, sips, loans, entries,
    settings: { ...out.settings, categories: [...categories], paymentMethods: [...methods] },
  };
}

/** Accept any supported file content and return current-schema data. */
export function toCurrent(raw: unknown, deviceId: string): VaultData {
  return isV2(raw) ? normalize(raw, deviceId) : migrateV1(raw, deviceId);
}
