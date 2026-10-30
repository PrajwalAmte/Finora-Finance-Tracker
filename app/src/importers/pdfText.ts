import { ImportError } from './types';

interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

type PdfJs = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfJs> | null = null;

/** Load pdf.js lazily: it is large and only needed when the user imports a PDF. */
async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      if (import.meta.env.MODE === 'test') {
        // Tests run in Node, which needs the legacy build and no worker.
        return (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs;
      }
      const pdfjs = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

/**
 * Extract text as visual lines, top to bottom and left to right, like PDFBox's sort-by-position.
 * Items whose baselines are within 2pt are treated as one line, and wide horizontal gaps become
 * double spaces so column boundaries survive.
 */
export async function extractPdfLines(bytes: Uint8Array, password?: string): Promise<string[]> {
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
      const content = await page.getTextContent();
      const items = (content.items as TextItem[]).filter(i => typeof i.str === 'string' && i.str.trim() !== '');
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
