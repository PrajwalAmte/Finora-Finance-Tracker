import { extractPdfLines } from './pdfText';
import { parseCasLines } from './cas';
import { parseBankSheet, parseHoldingsSheet } from './sheets';
import { ImportError, type BankPreview, type StatementPreview } from './types';

export * from './types';

const isPdf = (bytes: Uint8Array) => bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF

/**
 * Investment statements: CAMS/KFintech or CDSL/NSDL CAS PDFs (usually password protected), or a
 * broker holdings export (.xlsx/.xls/.csv). Everything is parsed on the device.
 */
export async function parseInvestmentStatement(bytes: Uint8Array, password?: string): Promise<StatementPreview> {
  if (isPdf(bytes)) {
    const lines = await extractPdfLines(bytes, password);
    if (lines.length === 0) throw new ImportError('The PDF has no readable text (it may be a scanned image).', 'UNREADABLE');
    return parseCasLines(lines);
  }
  return parseHoldingsSheet(bytes);
}

export async function parseBankStatement(bytes: Uint8Array): Promise<BankPreview> {
  if (isPdf(bytes)) {
    throw new ImportError('Bank statement PDFs are not supported yet. Download the statement as Excel or CSV from net banking.', 'UNRECOGNISED');
  }
  return parseBankSheet(bytes);
}
