import { describe, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extractPdfLines } from '../src/importers/pdfText';
import { parseCasLines } from '../src/importers/cas';
import { maskLines } from './mask';

/**
 * Local diagnostic for a real statement. Skipped unless STATEMENT is set, so normal test runs
 * never touch it:
 *
 *   read -s -p "Statement password: " STATEMENT_PASSWORD; export STATEMENT_PASSWORD
 *   STATEMENT="$HOME/Downloads/cas.pdf" npx vitest run tools/inspect-statement.test.ts
 *
 * Everything stays on this machine. It writes tools/out/statement-masked.txt (layout only: names,
 * PAN, email, phone and all digits hidden; safe to share) and prints a parse summary to the terminal
 * with the real numbers, for you to compare against the statement. The password is never written.
 */
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const path = env.STATEMENT;
const password = env.STATEMENT_PASSWORD;

describe.skipIf(!path)('inspect a real statement', () => {
  it('extracts, masks and parses it', async () => {
    const bytes = new Uint8Array(readFileSync(path!));
    const lines = await extractPdfLines(bytes, password);
    mkdirSync('tools/out', { recursive: true });
    writeFileSync('tools/out/statement-masked.txt', maskLines(lines).join('\n') + '\n');

    const res = parseCasLines(lines);
    const rows = res.holdings.map(h => ({
      scheme: h.name.slice(0, 48),
      isin: h.isin,
      folio: h.folio ? h.folio.replace(/\d/g, '9') : '',
      units: h.units,
      txns: h.transactions.length,
      mismatch: h.historyMismatch ? 'yes' : '',
    }));
    const out = [
      `lines extracted : ${lines.length}`,
      `parsed as       : ${res.source}`,
      `holdings found  : ${res.holdings.length}`,
      `transactions    : ${res.holdings.reduce((s, h) => s + h.transactions.length, 0)}`,
      `warnings        : ${res.warnings.length}`,
      ...res.warnings.slice(0, 10).map(w => '  - ' + w.replace(/\d/g, '9')),
    ].join('\n');
    // Shown in the terminal only.
    console.log('\n' + out + '\n');
    console.table(rows);
    console.log('Masked layout written to app/tools/out/statement-masked.txt');
  });
});
