import { parseLooseDate } from '../capture/textParsers';
import { stampDate, type ISODate } from '../domain/dates';

export const AMFI_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt';

const ISIN = /^IN[A-Z0-9]{10}$/;

export interface Scheme {
  code: string;
  name: string;
  nav: string;
  date: ISODate;
  isins: string[];
  /** Fund house, from the section headers in the feed. */
  amc?: string;
}

export interface NavIndex {
  fetchedAt: string;
  schemes: Scheme[];
}

/**
 * Parse AMFI's daily NAVAll.txt. Two layouts are in the wild:
 *   6 columns: Scheme Code;ISIN Growth;ISIN Reinvestment;Scheme Name;Net Asset Value;Date
 *   8 columns: Scheme Code;ISIN Growth;ISIN Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date
 * so NAV and date are read from the end and anything between name and NAV (plan, option) is
 * appended to the name. Lines without ';' are category or fund-house headers.
 */
export function parseNavAll(text: string, fetchedAt: string): NavIndex {
  const schemes: Scheme[] = [];
  let amc: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.includes(';')) {
      if (/mutual fund/i.test(line)) amc = line;
      continue;
    }
    const parts = line.split(';').map(p => p.trim());
    if (parts.length < 6) continue;
    const [code, isin1, isin2] = parts;
    const nav = parts[parts.length - 2];
    const date = parts[parts.length - 1];
    const name = parts.slice(3, -2).filter(p => p && p !== '-').join(' - ');
    if (!/^\d+$/.test(code) || !nav || Number.isNaN(Number(nav))) continue;
    const isins = [isin1, isin2].map(s => s.toUpperCase()).filter((s, i, a) => ISIN.test(s) && a.indexOf(s) === i);
    schemes.push({ code, name, nav, date: parseLooseDate(date, stampDate(fetchedAt)), isins, amc });
  }
  return { fetchedAt, schemes };
}

export interface NavLookup {
  byCode: Map<string, Scheme>;
  byIsin: Map<string, Scheme>;
  schemes: Scheme[];
}

export function lookup(index: NavIndex): NavLookup {
  const byCode = new Map<string, Scheme>();
  const byIsin = new Map<string, Scheme>();
  for (const s of index.schemes) {
    byCode.set(s.code, s);
    for (const i of s.isins) byIsin.set(i, s);
  }
  return { byCode, byIsin, schemes: index.schemes };
}

/** Name search: every word must appear; Direct-Growth plans rank first since most investors hold those. */
export function searchSchemes(l: NavLookup, query: string, limit = 20): Scheme[] {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0 || query.trim().length < 2) return [];
  const hits: Scheme[] = [];
  for (const s of l.schemes) {
    const n = s.name.toLowerCase();
    if (words.every(w => n.includes(w))) hits.push(s);
  }
  const score = (s: Scheme) => (/direct/i.test(s.name) ? 0 : 2) + (/growth/i.test(s.name) ? 0 : 1);
  return hits.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name)).slice(0, limit);
}
