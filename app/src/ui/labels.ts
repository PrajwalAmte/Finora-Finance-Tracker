import type { AssetType } from '../domain/types';

export const TYPE_LABEL: Record<AssetType, string> = {
  MUTUAL_FUND: 'Mutual funds', STOCK: 'Stocks', ETF: 'ETFs', BOND: 'Bonds', GOLD: 'Gold', FD: 'Fixed deposits', OTHER: 'Other',
};

/** Rough passphrase strength: length and character variety. Shown, not enforced beyond 8 characters. */
export function strength(p: string): { score: 0 | 1 | 2 | 3; label: string } {
  let s = 0;
  if (p.length >= 10) s++;
  if (p.length >= 14) s++;
  if (/[a-z]/.test(p) && /[A-Z0-9]/.test(p) && /[^a-zA-Z0-9]/.test(p)) s++;
  if (/\s/.test(p) && p.split(/\s+/).length >= 4) s = 3;
  const score = Math.min(3, s) as 0 | 1 | 2 | 3;
  return { score, label: ['Too easy to guess', 'Okay', 'Good', 'Strong'][score] };
}

