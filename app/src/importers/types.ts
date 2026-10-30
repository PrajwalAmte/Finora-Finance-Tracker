import type { ISODate } from '../domain/dates';
import type { AssetType, EntryKind, TxnKind } from '../domain/types';

export interface ParsedTxn {
  date: ISODate;
  kind: TxnKind;
  units: string;
  price: string;
  amount: string;
  description: string;
  /** Statement says this was a SIP installment. */
  systematic: boolean;
}

export interface ParsedHolding {
  type: AssetType;
  name: string;
  isin?: string;
  symbol?: string;
  schemeCode?: string;
  folio?: string;
  amc?: string;
  units: string;
  /** Average cost per unit, when the statement gives one. */
  avgCost?: string;
  /** Latest price/NAV per unit, when the statement gives one. */
  price?: string;
  /** Full history (CAMS/KFintech detailed statements). When present it replaces avgCost. */
  transactions: ParsedTxn[];
  /** Units implied by the transactions differ from the closing balance (history incomplete). */
  historyMismatch?: boolean;
}

export type StatementSource = 'CAS_MF' | 'CAS_DEMAT' | 'BROKER_SHEET';

export interface StatementPreview {
  source: StatementSource;
  holdings: ParsedHolding[];
  warnings: string[];
  statementDate?: ISODate;
}

export interface ParsedBankTxn {
  date: ISODate;
  narration: string;
  amount: string;
  kind: EntryKind;
  balance?: string;
}

export interface BankPreview {
  bankName?: string;
  transactions: ParsedBankTxn[];
  warnings: string[];
}

export class ImportError extends Error {
  constructor(message: string, readonly code: 'PASSWORD_NEEDED' | 'PASSWORD_WRONG' | 'UNREADABLE' | 'UNRECOGNISED' = 'UNRECOGNISED') {
    super(message);
    this.name = 'ImportError';
  }
}
