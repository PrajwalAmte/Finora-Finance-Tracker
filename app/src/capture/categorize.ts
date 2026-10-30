import { create, live, touch } from '../domain/records';
import type { EntryKind, MerchantRule, VaultData } from '../domain/types';

/** Built-in keyword → category hints, used until the user's own corrections take over. */
const KEYWORDS: [RegExp, string][] = [
  [/\b(swiggy|zomato|chai|tea|coffee|cafe|starbucks|restaurant|lunch|dinner|breakfast|snacks?|pizza|burger|dominos|kfc|mcdonald|biryani|food)\b/i, 'Food'],
  [/\b(bigbasket|blinkit|zepto|dmart|grocer(y|ies)|vegetables?|fruits?|milk|kirana|instamart|jiomart|more supermarket)\b/i, 'Groceries'],
  [/\b(uber|ola|rapido|metro|bus|auto|cab|taxi|train|irctc|parking|toll|fastag)\b/i, 'Transport'],
  [/\b(petrol|diesel|fuel|hpcl|bpcl|iocl|indian oil|shell)\b/i, 'Fuel'],
  [/\b(amazon|flipkart|myntra|ajio|meesho|nykaa|shopping|clothes|shoes|decathlon)\b/i, 'Shopping'],
  [/\b(electricity|bescom|msedcl|tata power|water bill|gas bill|broadband|wifi|jio|airtel|vi |vodafone|recharge|dth|postpaid|bill)\b/i, 'Bills & Utilities'],
  [/\b(rent|landlord|maintenance|society)\b/i, 'Rent'],
  [/\b(pharmacy|medicine|medical|hospital|doctor|clinic|apollo|1mg|pharmeasy|netmeds|lab test|dental)\b/i, 'Health'],
  [/\b(netflix|prime video|hotstar|spotify|movie|pvr|inox|bookmyshow|concert|gaming|steam|youtube premium)\b/i, 'Entertainment'],
  [/\b(flight|hotel|airbnb|makemytrip|goibibo|indigo|air india|vistara|oyo|trip|holiday)\b/i, 'Travel'],
  [/\b(school|college|tuition|course|udemy|coursera|books?|fees)\b/i, 'Education'],
  [/\b(salon|haircut|spa|parlour|grooming)\b/i, 'Personal Care'],
  [/\b(gift|donation|charity)\b/i, 'Gifts'],
];

const INCOME_KEYWORDS: [RegExp, string][] = [
  [/\b(salary|payroll|stipend)\b/i, 'Salary'],
  [/\b(interest|int\.? pd|sb int)\b/i, 'Interest'],
  [/\b(dividend|div)\b/i, 'Dividend'],
  [/\b(refund|cashback|reversal)\b/i, 'Refund'],
];

/** "Swiggy*Order 1234 Bangalore" → "swiggy order". Digits and punctuation vary per transaction. */
export function merchantKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\b(upi|pos|imps|neft|rtgs|ach|nach|txn|ref|payment|paid|to|from|via|at|the|pvt|ltd|private|limited|india|in)\b/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1)
    .slice(0, 2)
    .join(' ');
}

export function suggestCategory(data: VaultData, text: string, kind: EntryKind): { category: string; paymentMethod?: string; learned: boolean } {
  const key = merchantKey(text);
  if (key) {
    const rule = live(data.merchantRules).find(r => r.key === key);
    if (rule) return { category: rule.category, paymentMethod: rule.paymentMethod, learned: true };
  }
  const table = kind === 'INCOME' ? INCOME_KEYWORDS : KEYWORDS;
  for (const [re, category] of table) if (re.test(text)) return { category, learned: false };
  return { category: kind === 'INCOME' ? 'Other Income' : 'Other', learned: false };
}

/**
 * Remember the user's choice for this merchant. Called when an entry is saved; the rule id is
 * derived from the merchant key so the same rule learned on two phones merges into one.
 */
export function learn(data: VaultData, text: string, category: string, paymentMethod?: string): VaultData {
  const key = merchantKey(text);
  if (!key) return data;
  const id = `rule-${key.replace(/\s/g, '-')}`;
  const existing = data.merchantRules.find(r => r.id === id);
  if (existing && !existing.deletedAt && existing.category === category && existing.paymentMethod === paymentMethod) {
    return data;
  }
  const rule = existing
    ? touch(existing, { category, paymentMethod, hits: existing.hits + 1, deletedAt: undefined })
    : create<MerchantRule>({ id, key, category, paymentMethod, hits: 1 });
  const rules = existing ? data.merchantRules.map(r => (r.id === id ? rule : r)) : [...data.merchantRules, rule];
  return { ...data, merchantRules: rules };
}
