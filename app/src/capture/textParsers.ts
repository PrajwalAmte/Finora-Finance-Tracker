import { toISODate, today, type ISODate } from '../domain/dates';
import { stableHash } from '../domain/records';
import type { EntryKind } from '../domain/types';

export interface CapturedTxn {
  kind: EntryKind;
  amount: string;
  date: ISODate;
  merchant: string;
  paymentMethod: string;
  /** Account/card tail, UPI ref, etc. Shown to the user, never sent anywhere. */
  reference?: string;
  /** Dedupe key so the same SMS or screenshot is never added twice. */
  sourceRef: string;
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

const AMOUNT = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i;

/** A line that is just an amount, optionally after one stray symbol where OCR mangled the ₹. */
const RUPEE_LINE = /^(?:[^\w\s]|[ZzR])?\s?(\d[\d,]*(?:\.\d{1,2})?)$/;

function cleanAmount(s: string): string | null {
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? String(n) : null;
}

/** Dates as Indian banks and UPI apps print them: 12-10-26, 12/10/2026, 12 Oct 2026, 12-Oct-26, 2026-10-12. */
export function parseLooseDate(text: string, fallback: ISODate = today()): ISODate {
  let m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(/\b(\d{1,2})[\s-]+([A-Za-z]{3,4})[a-z]*[\s,-]+(\d{2,4})\b/);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return toISODate(new Date(y, MONTHS[m[2].toLowerCase()], Number(m[1])));
  }
  m = text.match(/\b([A-Za-z]{3,4})[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m && MONTHS[m[1].toLowerCase()] !== undefined) {
    return toISODate(new Date(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2])));
  }
  m = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(y, Number(m[2]) - 1, Number(m[1]));
    if (!Number.isNaN(d.getTime()) && Number(m[2]) <= 12) return toISODate(d);
  }
  return fallback;
}

// ── Payment-app screenshots (GPay, PhonePe, Paytm, BHIM, bank apps) ─────────

/**
 * Pull a payment out of OCR text from a UPI receipt screenshot. Returns null when the text does not
 * look like a completed payment.
 */
export function parsePaymentScreenshot(text: string, asOf: ISODate = today()): CapturedTxn | null {
  const flat = text.replace(/\r/g, '');
  if (/\b(failed|declined|pending|cancelled)\b/i.test(flat) && !/\b(successful|completed|paid)\b/i.test(flat)) return null;

  // Big "₹450" heading first. OCR often misreads or drops the rupee sign (Apple Vision returns
  // "·450", ML Kit sometimes "*450" or "%450"), leaving a number alone on its line.
  let amount: string | null = null;
  const sym = flat.match(AMOUNT);
  if (sym) amount = cleanAmount(sym[1]);
  if (!amount) {
    // Under ₹10 crore, so a 12-digit UPI reference on its own line is never taken for the amount.
    const bare = flat.split('\n').map(l => l.trim()).find(l => RUPEE_LINE.test(l) && Number(l.match(RUPEE_LINE)![1].replace(/,/g, '')) < 1e8);
    if (bare) amount = cleanAmount(bare.match(RUPEE_LINE)![1]);
  }
  if (!amount) return null;

  const received = /\b(received from|credited|money received|you received)\b/i.test(flat);
  const lines = flat.split('\n').map(l => l.trim()).filter(Boolean);
  let merchant = '';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(?:paid to|to|sent to|payment to|received from|from)\s*:?\s*(.*)$/i);
    if (m) {
      merchant = (m[1] || lines[i + 1] || '').trim();
      if (merchant) break;
    }
  }
  if (!merchant) {
    const vpa = flat.match(/\b([\w.-]+)@[a-z]+\b/i);
    if (vpa) merchant = vpa[1];
  }
  merchant = merchant.replace(/\s*(banking name|upi id).*$/i, '').slice(0, 60) || 'UPI payment';

  const ref = flat.match(/\b(?:upi (?:transaction )?(?:id|ref(?:erence)?(?: no)?)|utr|transaction id)[:\s]*([A-Z0-9]{8,})/i)?.[1];
  const date = parseLooseDate(flat, asOf);
  return {
    kind: received ? 'INCOME' : 'EXPENSE',
    amount,
    date,
    merchant,
    paymentMethod: 'UPI',
    reference: ref,
    sourceRef: `ocr-${ref ?? stableHash(`${amount}|${date}|${merchant}`)}`,
  };
}

// ── Bank SMS ─────────────────────────────────────────────────────────────────

const SKIP_SMS = /\b(otp|one time password|verification code|offer|cashback upto|pre-?approved|apply now|loan offer|win|congratulations|is due on|minimum amount due|will be debited|request(ed)? (money|payment)|collect request)\b/i;
const DEBIT = /\b(debited|spent|paid|withdrawn|sent|purchase|debit(ed)? for|txn of|used at|dr\b)/i;
const CREDIT = /\b(credited|received|deposited|refund(ed)?|cr\b)/i;

function smsMerchant(body: string): string {
  const patterns = [
    /\b(?:at|to)\s+([A-Za-z0-9 &.'*-]{3,40}?)(?:\s+on\b|\s+ref\b|\s+via\b|\.|,|\s+upi\b|\s+avl\b|$)/i,
    /\bVPA\s+([\w.-]+@[\w]+)/i,
    /\b(?:by|from)\s+([A-Za-z0-9 &.'*-]{3,40}?)(?:\s+on\b|\.|,|\s+ref\b|$)/i,
    /\binfo[:\s]+([A-Za-z0-9 *&./-]{3,40})/i,
  ];
  for (const re of patterns) {
    const m = body.match(re);
    if (m && !/^(your|a\/c|ac|acct|account|card|xx)/i.test(m[1])) return m[1].replace(/\*+/g, ' ').trim();
  }
  return 'Bank transaction';
}

/**
 * Parse a transactional bank/card/UPI SMS. Promotional, OTP, reminder and "will be debited" messages
 * are ignored, as are messages without an amount.
 */
export function parseBankSms(body: string, sender: string, receivedAt: number): CapturedTxn | null {
  if (SKIP_SMS.test(body)) return null;
  const amt = body.match(AMOUNT);
  if (!amt) return null;
  const amount = cleanAmount(amt[1]);
  if (!amount) return null;

  const isDebit = DEBIT.test(body);
  const isCredit = CREDIT.test(body);
  if (!isDebit && !isCredit) return null;
  // "debited ... credited to X" is a debit from the user's point of view.
  const kind: EntryKind = isDebit ? 'EXPENSE' : 'INCOME';

  let paymentMethod = 'Net Banking';
  if (/\bupi\b|vpa/i.test(body)) paymentMethod = 'UPI';
  else if (/credit card|\bcc\b/i.test(body)) paymentMethod = 'Credit Card';
  else if (/debit card|\bcard\b|pos\b/i.test(body)) paymentMethod = 'Debit Card';
  else if (/\batm\b|withdrawn/i.test(body)) paymentMethod = 'Cash';

  const account = body.match(/(?:a\/c|ac|acct|card)\s*(?:no\.?)?\s*[x*]*\s*(\d{3,6})/i)?.[1];
  const fallback = toISODate(new Date(receivedAt));
  return {
    kind,
    amount,
    date: parseLooseDate(body, fallback),
    merchant: smsMerchant(body),
    paymentMethod,
    reference: account ? `${sender} ••${account}` : sender,
    sourceRef: `sms-${stableHash(`${sender}|${receivedAt}|${body}`)}`,
  };
}
