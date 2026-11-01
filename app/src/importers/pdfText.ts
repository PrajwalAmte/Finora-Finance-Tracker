import { ImportError } from './types';

interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

type PdfJs = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfJs> | null = null;

/**
 * Load pdf.js lazily: it is large and only needed when the user imports a PDF.
 *
 * This is the "legacy" build on purpose. It bundles polyfills for newer JavaScript features
 * (Uint8Array.toHex, Math.sumPrecise, Map.getOrInsert…). The regular build assumes a very recent
 * browser and fails on every PDF elsewhere with errors like "toHex is not a function", which is
 * what an older iPhone or Android WebView hits.
 */
async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs;
      // Tests run in Node, where pdf.js uses its built-in fake worker.
      if (import.meta.env.MODE !== 'test') {
        const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      }
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

/**
 * Read a page's text items with a plain stream reader. pdf.js's own `page.getTextContent()` loops
 * with `for await … of` over the stream, and Safari on many iPhones cannot iterate a ReadableStream
 * that way: it fails with "undefined is not a function".
 */
async function readTextItems(page: { streamTextContent(): ReadableStream<{ items: unknown[] }> }): Promise<TextItem[]> {
  const reader = page.streamTextContent().getReader();
  const items: TextItem[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    items.push(...(value.items as TextItem[]));
  }
  return items;
}

/** The worker and library need `Promise.withResolvers` (iOS 17.4 and newer, current Android Chrome). */
function assertSupported(): void {
  if (typeof (Promise as { withResolvers?: unknown }).withResolvers !== 'function') {
    throw new ImportError('PDF import needs a newer phone software version (iOS 17.4 or later). Update iOS, or import the statement on another device and move your data with a backup file.', 'UNREADABLE');
  }
}

/**
 * Extract text as visual lines, top to bottom and left to right, like PDFBox's sort-by-position.
 * Items whose baselines are within 2pt are treated as one line, and wide horizontal gaps become
 * double spaces so column boundaries survive.
 */
export async function extractPdfLines(bytes: Uint8Array, password?: string): Promise<string[]> {
  assertSupported();
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), password: password || undefined, useSystemFonts: false, verbosity: 0 });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    const err = e as { name?: string; code?: number; message?: string };
    if (err.name === 'PasswordException') {
      throw err.code === 2
        ? new ImportError('That password did not open the PDF.', 'PASSWORD_WRONG')
        : new ImportError('This PDF is password protected.', 'PASSWORD_NEEDED');
    }
    throw new ImportError(`Could not read the PDF: ${err.message ?? 'unknown error'}`, 'UNREADABLE');
  }

  const lines: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const items = (await readTextItems(page)).filter(i => typeof i.str === 'string' && i.str.trim() !== '');
      const rows: { y: number; items: TextItem[] }[] = [];
      for (const item of items) {
        const y = item.transform[5];
        const row = rows.find(r => Math.abs(r.y - y) < 2);
        if (row) row.items.push(item); else rows.push({ y, items: [item] });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const row of rows) {
        row.items.sort((a, b) => a.transform[4] - b.transform[4]);
        let text = '';
        let lastEnd: number | null = null;
        for (const it of row.items) {
          const x = it.transform[4];
          if (lastEnd !== null) text += x - lastEnd > 15 ? '  ' : x - lastEnd > 1 ? ' ' : '';
          text += it.str;
          lastEnd = x + it.width;
        }
        const clean = text.replace(/\s+$/, '');
        if (clean) lines.push(clean);
      }
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return lines;
}
