/**
 * Masks a statement's extracted text so its layout can be shared without personal data.
 * Digits become 9, PAN/email/phone are replaced, and lines that are not part of the statement's
 * structure (investor name, address, bank details…) lose their letters. Scheme lines, folio lines,
 * transactions and totals keep their words, since those are what the parser reads.
 */

const ISIN = /\bIN[A-Z0-9]{10}\b/g;

/** Lines whose words are statement structure or public fund names, not personal details. */
const STRUCTURAL = [
  /^\s*\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4}\b/, // transaction rows start with a date
  /\bISIN\b/i,
  /\(IN[A-Z0-9]{10}\)/,
  /\bfolio\b/i,
  /\b(opening|closing)\b.*\b(balance|unit)/i,
  /\b(nav|cost value|market value|invested|total)\b/i,
  /\b(mutual fund|mf)\s*$/i,
  /\b(registrar|advisor|statement|consolidated)\b/i,
  /\b(balance|quantity|units?)\b/i,
];

function maskLetters(text: string): string {
  return text.replace(/[A-Za-z]/g, c => (c === c.toUpperCase() ? 'X' : 'x'));
}

export function maskLine(line: string): string {
  // Keep ISINs (public) through the masking passes.
  const isins: string[] = [];
  let out = line.replace(ISIN, m => {
    isins.push(m);
    // A private-use character: the digit and letter masks below leave it alone.
    return String.fromCharCode(0xe000 + isins.length - 1);
  });

  out = out
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, 'AAAAA9999A') // PAN
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, 'xxxx@xxxx.xxx') // email
    .replace(/(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{9}(?!\d)/g, '9999999999'); // mobile

  const structural = STRUCTURAL.some(re => re.test(line));
  if (!structural) out = maskLetters(out);
  out = out.replace(/\d/g, '9');

  return out.replace(/[\ue000-\uf8ff]/g, c => isins[c.charCodeAt(0) - 0xe000]);
}

export function maskLines(lines: string[]): string[] {
  return lines.map(maskLine);
}
