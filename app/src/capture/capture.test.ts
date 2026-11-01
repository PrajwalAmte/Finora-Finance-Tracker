import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from './quickAdd';
import { parseBankSms, parsePaymentScreenshot } from './textParsers';
import { learn, merchantKey, suggestCategory } from './categorize';
import { vault } from '../domain/testFixtures';

const TODAY = '2026-10-29'; // a Thursday

describe('parseQuickAdd', () => {
  it.each([
    ['200 chai upi yesterday', { amount: '200', description: 'Chai', paymentMethod: 'UPI', date: '2026-10-28', kind: 'EXPENSE' }],
    ['spent 1,250 on groceries at dmart via card', { amount: '1250', description: 'Groceries dmart', paymentMethod: 'Debit Card', date: TODAY }],
    ['+50k salary', { amount: '50000', kind: 'INCOME', description: 'Salary' }],
    ['uber 450 3 oct', { amount: '450', description: 'Uber', date: '2026-10-03' }],
    ['₹99 netflix cc 01/10', { amount: '99', description: 'Netflix', paymentMethod: 'Credit Card', date: '2026-10-01' }],
    ['lunch 320 monday', { amount: '320', description: 'Lunch', date: '2026-10-26' }],
    ['rent 25000 28 dec', { amount: '25000', date: '2025-12-28' }],
    ['refund 499 amazon', { kind: 'INCOME', amount: '499' }],
  ])('%s', (text, expected) => {
    expect(parseQuickAdd(text, TODAY)).toMatchObject(expected);
  });

  it('returns no amount when there is none', () => {
    expect(parseQuickAdd('coffee', TODAY).amount).toBeNull();
  });
});

describe('categorize', () => {
  it('uses keywords first, then what the user taught it', () => {
    const data = vault();
    expect(suggestCategory(data, 'Swiggy order', 'EXPENSE').category).toBe('Food');
    expect(suggestCategory(data, 'Sharma Stores', 'EXPENSE').category).toBe('Other');
    const taught = learn(data, 'Sharma Stores 1234', 'Groceries', 'UPI');
    expect(suggestCategory(taught, 'SHARMA STORES #99', 'EXPENSE')).toMatchObject({ category: 'Groceries', paymentMethod: 'UPI', learned: true });
  });

  it('normalises merchant names', () => {
    expect(merchantKey('UPI/SWIGGY*ORDER/123456/Payment')).toBe('swiggy order');
  });
});

describe('parsePaymentScreenshot', () => {
  it('reads a GPay-style receipt', () => {
    const text = ['₹450', 'Paid to', 'Chai Point', 'Completed', '12 Oct 2026, 10:32 pm', 'UPI transaction ID: 429187364521'].join('\n');
    expect(parsePaymentScreenshot(text, TODAY)).toMatchObject({
      kind: 'EXPENSE', amount: '450', merchant: 'Chai Point', date: '2026-10-12', paymentMethod: 'UPI', sourceRef: 'ocr-429187364521',
    });
  });

  it('reads Apple Vision output where the rupee sign comes back as "·"', () => {
    // Exact lines returned by TextRecognizer.swift for a rendered GPay-style receipt.
    const text = ['·450', 'Paid to', 'Chai Point', 'Completed', '12 Oct 2026, 10:32 pm', 'UPI transaction ID', '429187364521', 'To: chaipoint@okicici'].join('\n');
    expect(parsePaymentScreenshot(text, TODAY)).toMatchObject({ amount: '450', merchant: 'Chai Point', date: '2026-10-12', sourceRef: 'ocr-429187364521' });
  });

  it('reads a received payment and ignores failed ones', () => {
    expect(parsePaymentScreenshot('Received from\nRahul Kumar\n₹2,000\nSuccessful', TODAY)).toMatchObject({ kind: 'INCOME', amount: '2000', merchant: 'Rahul Kumar' });
    expect(parsePaymentScreenshot('₹200\nPayment failed', TODAY)).toBeNull();
  });
});

describe('parseBankSms', () => {
  const at = new Date('2026-10-12T10:00:00').getTime();

  it.each([
    ['Rs.450.00 debited from A/c XX1234 on 12-10-26 to VPA chaipoint@okicici. UPI Ref 1234567890', { kind: 'EXPENSE', amount: '450', paymentMethod: 'UPI', date: '2026-10-12' }],
    ['INR 2,499.00 spent on HDFC Bank Credit Card xx5678 at AMAZON on 2026-10-11. Avl limit: INR 1,00,000', { kind: 'EXPENSE', amount: '2499', paymentMethod: 'Credit Card', merchant: 'AMAZON', date: '2026-10-11' }],
    ['Your a/c no. XXXXXX9012 is credited by Rs.85,000.00 on 01-Oct-26 by ACME CORP SALARY', { kind: 'INCOME', amount: '85000', date: '2026-10-01' }],
  ])('%s', (body, expected) => {
    expect(parseBankSms(body, 'HDFCBK', at)).toMatchObject(expected);
  });

  it.each([
    'Your OTP for txn of Rs 500 is 123456',
    'Get a pre-approved loan of Rs 5,00,000. Apply now!',
    'Rs 1,200 will be debited on 15-10-26 for your SIP',
    'Your credit card bill of Rs 12,000 is due on 20-10-26',
  ])('ignores: %s', body => {
    expect(parseBankSms(body, 'HDFCBK', at)).toBeNull();
  });

  it('gives the same dedupe key for the same message', () => {
    const body = 'Rs.450.00 debited from A/c XX1234 on 12-10-26';
    expect(parseBankSms(body, 'X', at)!.sourceRef).toBe(parseBankSms(body, 'X', at)!.sourceRef);
  });
});

describe('forwarded SMS (iOS Shortcuts)', () => {
  it('queues finora://capture links and ignores anything else', async () => {
    const { acceptCaptureUrl, nextCapture } = await import('./inbox');
    const sms = 'Rs.450.00 debited from A/c XX1234 on 12-10-26 to VPA chaipoint@okicici';
    expect(acceptCaptureUrl(`finora://capture?text=${encodeURIComponent(sms)}`)).toBe(true);
    expect(acceptCaptureUrl('finora://settings?text=x')).toBe(false);
    expect(acceptCaptureUrl('https://evil.example/capture?text=x')).toBe(false);
    expect(acceptCaptureUrl('finora://capture?text=')).toBe(false);
    expect(nextCapture()).toBe(sms);
    expect(nextCapture()).toBeUndefined();
  });

  it('gives the same dedupe key when the same message is forwarded twice', async () => {
    const { parseForwardedSms } = await import('./inbox');
    const sms = 'INR 2,499.00 spent on HDFC Bank Credit Card xx5678 at AMAZON on 2026-10-11.';
    const a = parseForwardedSms(sms)!;
    const b = parseForwardedSms(`${sms} `)!;
    expect(a).toMatchObject({ amount: '2499', kind: 'EXPENSE', date: '2026-10-11' });
    expect(a.sourceRef).toBe(b.sourceRef);
    expect(parseForwardedSms('Your OTP is 123456')).toBeNull();
  });
});
