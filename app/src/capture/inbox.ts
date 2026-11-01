import { stableHash } from '../domain/records';
import { today } from '../domain/dates';
import { parseBankSms, type CapturedTxn } from './textParsers';

/**
 * Text handed to the app from outside (the iOS Shortcuts automation that forwards bank SMS).
 * Held in memory only, until the vault is unlocked and the user confirms or dismisses it.
 */
type Listener = () => void;
const queue: string[] = [];
const listeners = new Set<Listener>();

const MAX_TEXT = 1000;

/** Accepts finora://capture?text=<url-encoded message>. Anything else is ignored. */
export function acceptCaptureUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'finora:' || (parsed.host || parsed.pathname.replace(/^\/+/, '')) !== 'capture') return false;
  const text = parsed.searchParams.get('text')?.trim();
  if (!text) return false;
  queue.push(text.slice(0, MAX_TEXT));
  listeners.forEach(l => l());
  return true;
}

export function nextCapture(): string | undefined {
  return queue.shift();
}

export function pendingCaptures(): number {
  return queue.length;
}

export function onCapture(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Parse forwarded SMS text. The dedupe key depends only on the text, so the same message forwarded
 * twice (automation retried, or both "debited" and "spent" automations fired) is caught.
 */
export function parseForwardedSms(text: string): CapturedTxn | null {
  const t = parseBankSms(text, 'SMS', Date.now());
  if (!t) return null;
  return { ...t, date: t.date || today(), sourceRef: `sms-fwd-${stableHash(text.replace(/\s+/g, ' ').trim())}` };
}
