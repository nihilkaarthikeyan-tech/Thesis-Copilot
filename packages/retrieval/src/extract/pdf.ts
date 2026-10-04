/**
 * PDF text extraction — PRD FR-1.7 (`unpdf`, Node, no Python) and PHASES 1-W2 task 2.2.
 *
 *   "page-aware text; keep page boundaries as markers. Two-column heuristics: if `unpdf` returns
 *    interleaved columns, use its per-item positions to reorder by column (check what the library
 *    exposes before assuming; note findings in the log)."
 *
 * What unpdf 1.8.1 actually exposes, checked in `node_modules/unpdf/dist/index.d.mts` before use
 * (§0.3 rule 1):
 *   - `extractText(data, { mergePages: false })` → `{ totalPages, text: string[] }`, one entry per
 *     page, but in the PDF's own item order — which interleaves the columns of a two-column paper.
 *   - `extractTextItems(data)` → `{ totalPages, items: StructuredTextItem[][] }` where each item
 *     carries `str`, `x`, `y` (origin bottom-left), `width`, `height`, `fontSize` and `hasEOL`.
 * The positions are what make column reordering possible, so extraction goes through
 * `extractTextItems` and reconstructs the reading order itself; `extractText` is the fallback.
 */

export type ExtractedPage = { page: number; text: string };

export type PdfExtraction = {
  totalPages: number;
  pages: ExtractedPage[];
  /** Pages where two columns were detected and reordered. Reported so the log can say so. */
  twoColumnPages: number[];
  /** True when the positional path failed and the plain reading order was used instead. */
  usedFallback: boolean;
};

/** The shape unpdf returns; redeclared so this module does not depend on its type export path. */
export type TextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  hasEOL: boolean;
};

/** Items on one horizontal line, left to right. */
type Line = { y: number; items: TextItem[] };

/** Two items belong to the same line when their baselines are within this fraction of the font size. */
const LINE_TOLERANCE = 0.5;

/** A gutter must be at least this fraction of the page width to count as a column separator. */
const MIN_GUTTER_RATIO = 0.03;

/** Each column must hold at least this share of the page's items for the split to be believed. */
const MIN_COLUMN_SHARE = 0.2;

function groupIntoLines(items: readonly TextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];

  for (const item of sorted) {
    const tolerance = Math.max(item.fontSize, 1) * LINE_TOLERANCE;
    const line = lines.find((l) => Math.abs(l.y - item.y) <= tolerance);
    if (line) {
      line.items.push(item);
      // Keep the line's y as the mean, so a tall item does not drag the band.
      line.y = line.items.reduce((sum, i) => sum + i.y, 0) / line.items.length;
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }

  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => b.y - a.y);
}

/**
 * Finds a vertical gutter that splits the page into two columns.
 *
 * Scans candidate x positions across the middle half of the page and picks the widest band that no
 * item crosses, provided both sides hold a fair share of the items. Returns null for a single
 * column, which is the common case and must not be mangled.
 */
export function detectGutter(items: readonly TextItem[]): number | null {
  if (items.length < 12) return null;

  const left = Math.min(...items.map((i) => i.x));
  const right = Math.max(...items.map((i) => i.x + i.width));
  const pageWidth = right - left;
  if (pageWidth <= 0) return null;

  const searchFrom = left + pageWidth * 0.3;
  const searchTo = left + pageWidth * 0.7;
  const step = pageWidth / 200;

  let best: { centre: number; width: number } | null = null;
  let runStart: number | null = null;

  for (let x = searchFrom; x <= searchTo; x += step) {
    const crossed = items.some((i) => i.x < x && i.x + i.width > x);
    if (!crossed) {
      runStart ??= x;
    } else if (runStart !== null) {
      const width = x - runStart;
      if (!best || width > best.width) best = { centre: runStart + width / 2, width };
      runStart = null;
    }
  }
  if (runStart !== null) {
    const width = searchTo - runStart;
    if (!best || width > best.width) best = { centre: runStart + width / 2, width };
  }

  if (!best || best.width < pageWidth * MIN_GUTTER_RATIO) return null;

  const leftCount = items.filter((i) => i.x + i.width <= best.centre).length;
  const rightCount = items.filter((i) => i.x >= best.centre).length;
  const share = Math.min(leftCount, rightCount) / items.length;
  if (share < MIN_COLUMN_SHARE) return null;

  return best.centre;
}

/**
 * Rejoins a word split across a line break: "adop-\ntion" becomes "adoption". Conservative — only
 * when a lowercase letter precedes the hyphen and follows the break, so "well-\nknown" and a line
 * ending in a real dash are left alone.
 */
function dehyphenate(text: string): string {
  return text.replace(/(\p{Ll})-\n(\p{Ll})/gu, '$1$2');
}

function linesToText(lines: readonly Line[]): string {
  return lines
    .map((line) => {
      let text = '';
      let previous: TextItem | null = null;
      for (const item of line.items) {
        if (previous) {
          const gap = item.x - (previous.x + previous.width);
          // A gap wider than a quarter of the font size is a space the PDF did not encode.
          const needsSpace = gap > Math.max(previous.fontSize, 1) * 0.25;
          if (needsSpace && !/\s$/.test(text) && !/^\s/.test(item.str)) text += ' ';
        }
        text += item.str;
        previous = item;
      }
      return text.trimEnd();
    })
    .filter((line) => line.length > 0)
    .join('\n');
}

/** Reading order for one page: single column, or left column then right column. */
export function pageText(items: readonly TextItem[]): { text: string; twoColumn: boolean } {
  const withText = items.filter((i) => i.str.length > 0);
  if (withText.length === 0) return { text: '', twoColumn: false };

  const gutter = detectGutter(withText);
  if (gutter === null) {
    return { text: dehyphenate(linesToText(groupIntoLines(withText))), twoColumn: false };
  }

  // A heading or figure spanning the gutter belongs above both columns; keep it with the left one
  // so it is not lost or duplicated.
  const spanning = withText.filter((i) => i.x < gutter && i.x + i.width > gutter);
  const leftItems = withText.filter((i) => i.x + i.width <= gutter);
  const rightItems = withText.filter((i) => i.x >= gutter);

  const text = [
    linesToText(groupIntoLines([...spanning, ...leftItems])),
    linesToText(groupIntoLines(rightItems)),
  ]
    .filter(Boolean)
    .join('\n');

  return { text: dehyphenate(text), twoColumn: true };
}

/**
 * Extracts a PDF page by page, reordering two-column pages into reading order.
 *
 * `loaders` is injected so tests can drive the pure reconstruction without a PDF, and so a future
 * GROBID upgrade (FR-1.7, behind the `grobid` flag) can replace the loader rather than this module.
 */
export async function extractPdf(
  data: Uint8Array,
  loaders?: {
    extractTextItems?: (d: Uint8Array) => Promise<{ totalPages: number; items: TextItem[][] }>;
    extractText?: (d: Uint8Array) => Promise<{ totalPages: number; text: string[] }>;
  },
): Promise<PdfExtraction> {
  // A plain copy, never the caller's bytes as given: pdf.js refuses a Node `Buffer` ("Please
  // provide binary data as `Uint8Array`, rather than `Buffer`"), and every PDF read from storage
  // arrives as one — so a student's uploaded PDF was never read (found 2026-10-04 by the
  // read-beside e2e). Copying also keeps pdf.js from detaching a buffer the caller still holds.
  const bytes = new Uint8Array(data);
  const unpdf = loaders ? null : await import('unpdf');
  const itemsOf =
    loaders?.extractTextItems ??
    ((d: Uint8Array) =>
      (
        unpdf as {
          extractTextItems: (x: Uint8Array) => Promise<{ totalPages: number; items: TextItem[][] }>;
        }
      ).extractTextItems(d));

  try {
    const { totalPages, items } = await itemsOf(bytes);
    const twoColumnPages: number[] = [];
    const pages = items.map((pageItems, index) => {
      const { text, twoColumn } = pageText(pageItems ?? []);
      if (twoColumn) twoColumnPages.push(index + 1);
      return { page: index + 1, text };
    });
    return { totalPages, pages, twoColumnPages, usedFallback: false };
  } catch {
    // Positional extraction failed (an unusual producer, a damaged file). Fall back to unpdf's own
    // per-page text: column order may be wrong, but losing the paper entirely is worse.
    const textOf =
      loaders?.extractText ??
      ((d: Uint8Array) =>
        (
          unpdf as {
            extractText: (
              x: Uint8Array,
              o: { mergePages: false },
            ) => Promise<{ totalPages: number; text: string[] }>;
          }
        ).extractText(d, { mergePages: false }));
    const { totalPages, text } = await textOf(bytes);
    return {
      totalPages,
      pages: text.map((t, index) => ({ page: index + 1, text: dehyphenate(t) })),
      twoColumnPages: [],
      usedFallback: true,
    };
  }
}

/** Page count without extracting text — used to enforce the per-plan page limit (PRD §11.3). */
export async function pdfPageCount(data: Uint8Array): Promise<number> {
  const { getDocumentProxy } = await import('unpdf');
  const document = await getDocumentProxy(data);
  return document.numPages;
}
