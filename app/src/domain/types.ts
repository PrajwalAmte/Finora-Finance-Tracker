import type { Dec } from './money';
import type { ISODate } from './dates';

/** Every stored record carries these so that two devices can merge exports. */
export interface Base {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Deletion marker: deleted records stay in the vault so the delete reaches other devices on import. */
  deletedAt?: string;
}

export interface Owner extends Base {
  name: string;
  relation: 'SELF' | 'SPOUSE' | 'PARENT' | 'CHILD' | 'OTHER';
}

export type AssetType = 'MUTUAL_FUND' | 'STOCK' | 'ETF' | 'BOND' | 'GOLD' | 'FD' | 'OTHER';

/** How capital gains are taxed. Drives holding-period and rate lookups in the tax rules table. */
export type TaxClass = 'EQUITY' | 'DEBT' | 'OTHER';

export interface Holding extends Base {
  ownerId: string;
  name: string;
  type: AssetType;
  taxClass: TaxClass;
  symbol?: string;
  isin?: string;
  schemeCode?: string;
  folio?: string;
  broker?: string;
  amc?: string;
  /** Latest known price per unit. */
  currentPrice?: Dec;
  priceDate?: ISODate;
  /** Fair market value per unit on 31 Jan 2018, for grandfathered equity bought before 1 Feb 2018. */
  fmv2018?: Dec;
  nominee?: string;
  notes?: string;
  importSource?: string;
}

export type TxnKind = 'BUY' | 'SELL' | 'DIVIDEND';

/** Holdings are derived from these; quantity and cost are never stored on the holding. */
export interface Txn extends Base {
  holdingId: string;
  date: ISODate;
  kind: TxnKind;
  units: Dec;
  price: Dec;
  /** Gross cash amount of the transaction (units × price for buys/sells, cash received for dividends). */
  amount: Dec;
  charges?: Dec;
  sipId?: string;
  /** True when recorded automatically at an approximate NAV; a statement import replaces it. */
  estimated?: boolean;
  source?: 'MANUAL' | 'SIP_AUTO' | 'IMPORT';
}

export type SipStatus = 'ACTIVE' | 'PAUSED' | 'STOPPED';

export interface Sip extends Base {
  ownerId: string;
  name: string;
  holdingId?: string;
  schemeCode?: string;
  isin?: string;
  amount: Dec;
  dayOfMonth: number;
  startDate: ISODate;
  endDate?: ISODate;
  status: SipStatus;
  /** Record installments automatically on app open, at the latest known NAV. */
  autoRecord: boolean;
  /** Date of the last installment that was recorded or skipped. */
  lastInstallment?: ISODate;
}

export type InterestType = 'SIMPLE' | 'COMPOUND';
export type Compounding = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export interface Loan extends Base {
  ownerId: string;
  name: string;
  lender?: string;
  accountRef?: string;
  principal: Dec;
  /** Annual rate in percent, e.g. "8.5". */
  annualRate: Dec;
  interestType: InterestType;
  compounding: Compounding;
  startDate: ISODate;
  tenureMonths: number;
  emi: Dec;
  emiDay: number;
  /** Moratorium: no EMI falls due before this date (education loans). Interest keeps building until then. */
  firstEmiDate?: ISODate;
  /** Outstanding balance as of `balanceAsOf`; the catch-up engine moves it forward. */
  balance: Dec;
  balanceAsOf: ISODate;
  closedAt?: ISODate;
  notes?: string;
}

export type LoanEventKind = 'EMI' | 'PREPAYMENT' | 'RATE_CHANGE';

export interface LoanEvent extends Base {
  loanId: string;
  date: ISODate;
  kind: LoanEventKind;
  amount: Dec;
  interest?: Dec;
  principal?: Dec;
  balanceAfter?: Dec;
  newRate?: Dec;
  auto?: boolean;
}

export type EntryKind = 'EXPENSE' | 'INCOME';
export type EntrySource = 'MANUAL' | 'QUICK_ADD' | 'OCR' | 'SMS' | 'IMPORT' | 'RECURRING';

/** A cash movement: an expense or an income. */
export interface Entry extends Base {
  ownerId: string;
  kind: EntryKind;
  date: ISODate;
  amount: Dec;
  description: string;
  category: string;
  paymentMethod: string;
  merchant?: string;
  source: EntrySource;
  /** Dedupe key from the capture source (SMS hash, statement row hash). */
  sourceRef?: string;
  recurringId?: string;
}

export interface Recurring extends Base {
  name: string;
  kind: EntryKind;
  amount: Dec;
  dayOfMonth: number;
  category: string;
  active: boolean;
}

export interface Goal extends Base {
  name: string;
  /** Target in today's money; inflation is applied up to the target date. */
  targetAmount: Dec;
  targetDate: ISODate;
  inflationPct: Dec;
  expectedReturnPct: Dec;
  holdingIds: string[];
  sipIds: string[];
}

export interface MerchantRule extends Base {
  /** Normalised merchant key, also the record id suffix. */
  key: string;
  category: string;
  paymentMethod?: string;
  hits: number;
}

export interface Snapshot extends Base {
  date: ISODate;
  assets: Dec;
  liabilities: Dec;
  netWorth: Dec;
  invested: Dec;
  byType: Record<string, Dec>;
}

export interface Settings {
  updatedAt: string;
  categories: string[];
  incomeCategories: string[];
  paymentMethods: string[];
  autoLockMinutes: number;
  privacyMode: boolean;
  theme: 'system' | 'light' | 'dark';
  /** Marginal slab rate in percent used for slab-taxed gains. */
  slabRatePct: Dec;
  /** Money set aside each month before "safe to spend". */
  monthlySavingsTarget: Dec;
  dismissedInsights: string[];
  smsCaptureEnabled: boolean;
  /** Epoch ms of the newest SMS already scanned. */
  lastSmsScanAt?: number;
  lastExportAt?: string;
  lastPriceRefreshAt?: string;
  biometricEnabled: boolean;
  emergencyNotes?: string;
}

export interface Meta {
  schemaVersion: 2;
  deviceId: string;
  createdAt: string;
  lastCatchUpDate?: ISODate;
}

export interface VaultData {
  owners: Owner[];
  holdings: Holding[];
  txns: Txn[];
  sips: Sip[];
  loans: Loan[];
  loanEvents: LoanEvent[];
  entries: Entry[];
  recurring: Recurring[];
  goals: Goal[];
  merchantRules: MerchantRule[];
  snapshots: Snapshot[];
  settings: Settings;
  meta: Meta;
}

export type CollectionName = {
  [K in keyof VaultData]: VaultData[K] extends Base[] ? K : never;
}[keyof VaultData];

export const COLLECTIONS: CollectionName[] = [
  'owners', 'holdings', 'txns', 'sips', 'loans', 'loanEvents',
  'entries', 'recurring', 'goals', 'merchantRules', 'snapshots',
];
