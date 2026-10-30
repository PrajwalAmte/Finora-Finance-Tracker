import { toB64 } from '../vault/crypto';
import type { ProviderId } from './types';

/** PKCE (RFC 7636): random verifier, SHA-256 challenge, both base64url. */
export function base64url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function newVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(48)));
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** Why the user left for the provider's sign-in page: link an open vault, or set up a new device. */
export type OAuthPurpose = 'connect' | 'restore';

interface Pending {
  provider: ProviderId;
  state: string;
  verifier: string;
  purpose: OAuthPurpose;
}

const KEY = 'finora.oauth';

/**
 * The verifier and state survive the round trip to the provider in sessionStorage (this tab only,
 * cleared on use). They are single-use and useless without the provider's one-time code.
 */
export function savePending(p: Pending): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Private mode without storage: the sign-in will simply fail and can be retried.
  }
}

export function takePending(state: string): Pending | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pending;
    return p.state === state ? p : null;
  } catch {
    return null;
  }
}

export function redirectUri(): string {
  return `${location.origin}/`;
}

/** Reads ?code=&state= (or ?error=) left by the provider and removes them from the address bar. */
export function readRedirect(): { code?: string; state?: string; error?: string } | null {
  const params = new URLSearchParams(location.search);
  const code = params.get('code') ?? undefined;
  const state = params.get('state') ?? undefined;
  const error = params.get('error') ?? undefined;
  if (!state || (!code && !error)) return null;
  history.replaceState(null, '', `${location.pathname}${location.hash}`);
  return { code, state, error };
}
