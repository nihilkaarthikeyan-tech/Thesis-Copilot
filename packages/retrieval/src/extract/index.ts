/**
 * Document extraction — PRD FR-1.7 and PHASES 1-W2 task 2.2.
 *
 * Turns an uploaded `.pdf` or `.docx` into the shape the rest of the pipeline needs: one text
 * blob, page spans so a chunk can be re-located in the viewer (FR-2.4 AC), and section spans so a
 * chunk never straddles two headings.
 */

import type { PageSpan, SectionSpan } from '../chunker.js';
import { extractPdf, type PdfExtraction } from './pdf.js';

export type DocumentKind = 'pdf' | 'docx';

export type ExtractedDocument = {
  kind: DocumentKind;
  text: string;
  pages: PageSpan[];
  sections: SectionSpan[];
  totalPages: number;
  /** Two-column pages that were reordered, and whether the positional path had to fall back. */
  twoColumnPages: number[];
  usedFallback: boolean;
};

/** Page break marker kept in the text so a human reading the blob can see where pages end. */
export const PAGE_BREAK = '\n\n';

/**
 * Headings, recognised structurally rather than by a keyword list, so the extractor is not tied to
 * one discipline's section names: a short line, no terminal full stop, that is not a sentence.
 * Numbered headings ("3.1 Method") and all-caps headings both qualify.
 */
const HEADING_MAX_LENGTH = 90;

export function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > HEADING_MAX_LENGTH) return false;
  if (/[.!?,;:]$/.test(trimmed)) return false;
  // A reference entry or a figure caption is not a section heading.
  if (/^\[\d+\]|^\(\d+\)|^(figure|fig\.|table)\s+\d/i.test(trimmed)) return false;

  const numbered = /^\d+(\.\d+)*\.?\s+\p{L}/u.test(trimmed);
  const capitalised = /^\p{Lu}/u.test(trimmed);
  const allCaps = trimmed === trimmed.toUpperCase() && /\p{Lu}/u.test(trimmed);
  const words = trimmed.split(/\s+/).length;

  return (numbered || allCaps || (capitalised && words <= 10)) && words >= 1;
}

/** Section spans derived from heading lines; every byte of `text` falls in exactly one span. */
export function detectSections(text: string): SectionSpan[] {
  const spans: SectionSpan[] = [];
  let offset = 0;
  let current: { section: string; start: number } | null = null;

  for (const line of text.split('\n')) {
    const lineStart = offset;
    offset += line.length + 1;

    if (!looksLikeHeading(line)) continue;
    if (current) spans.push({ section: current.section, start: current.start, end: lineStart });
    current = { section: line.trim(), start: lineStart };
  }

  if (current) spans.push({ section: current.section, start: current.start, end: text.length });
  else if (text.length > 0) spans.push({ section: '', start: 0, end: text.length });

  // Text before the first heading (title block, abstract) is its own unlabelled span.
  const first = spans[0];
  if (first && first.start > 0) spans.unshift({ section: '', start: 0, end: first.start });

  return spans;
}

/** Joins per-page text into one blob and records where each page starts and ends. */
export function joinPages(pages: ReadonlyArray<{ page: number; text: string }>): {
  text: string;
  spans: PageSpan[];
} {
  const spans: PageSpan[] = [];
  let text = '';

  for (const page of pages) {
    const start = text.length;
    text += page.text;
    spans.push({ page: page.page, start, end: text.length });
    text += PAGE_BREAK;
  }

  return { text: text.trimEnd(), spans };
}

export async function extractDocx(data: Uint8Array): Promise<{ text: string }> {
  const mammoth = await import('mammoth');
  // `extractRawText` keeps paragraph breaks and drops styling, which is what the extraction prompt
  // wants; `convertToHtml` would add markup the model would have to ignore.
  const result = await mammoth.extractRawText({ buffer: Buffer.from(data) });
  return { text: result.value };
}

/** Extracts by file kind. `.docx` has no pages, so it reports one span covering the whole text. */
export async function extractDocument(
  data: Uint8Array,
  kind: DocumentKind,
): Promise<ExtractedDocument> {
  if (kind === 'docx') {
    const { text } = await extractDocx(data);
    return {
      kind,
      text,
      pages: text.length > 0 ? [{ page: 1, start: 0, end: text.length }] : [],
      sections: detectSections(text),
      totalPages: 1,
      twoColumnPages: [],
      usedFallback: false,
    };
  }

  const extraction: PdfExtraction = await extractPdf(data);
  const { text, spans } = joinPages(extraction.pages);
  return {
    kind,
    text,
    pages: spans,
    sections: detectSections(text),
    totalPages: extraction.totalPages,
    twoColumnPages: extraction.twoColumnPages,
    usedFallback: extraction.usedFallback,
  };
}

export {
  detectGutter,
  type ExtractedPage,
  extractPdf,
  type PdfExtraction,
  pageText,
  pdfPageCount,
  type TextItem,
} from './pdf.js';
