/**
 * Section-aware chunker — PRD FR-2.4 and PHASES 1-W2 task 2.7.
 *
 *   "text → chunks (~350 tokens, 15% overlap, section-aware) → embeddings → `SourceChunk` with
 *    page number and character offsets"
 *   AC: "a chunk can be re-located in the PDF viewer by page + offset."
 *
 * Rules the tests pin:
 *   - never split mid-sentence
 *   - a chunk never spans two sections
 *   - consecutive chunks in a section overlap by ~15% of the budget, measured in whole sentences
 *   - `charStart`/`charEnd` index the ORIGINAL text, so a chunk can be found again in the PDF
 *   - `page` is the page the chunk starts on
 *
 * A sentence longer than the budget is emitted as its own chunk rather than being cut: an
 * over-long chunk costs a little more to embed, a cut one is unciteable.
 */

import { approxTokens, splitSentences } from './text.js';

/** Where a page begins and ends in the extracted text (the extractor supplies these). */
export type PageSpan = { page: number; start: number; end: number };

/** A heading and the span of text beneath it. */
export type SectionSpan = { section: string; start: number; end: number };

export type ChunkInput = {
  text: string;
  /** Page boundaries; omit for sources with no pagination (an abstract, say). */
  pages?: readonly PageSpan[];
  /** Section spans; omit to treat the whole text as one section. */
  sections?: readonly SectionSpan[];
};

export type ChunkOptions = {
  /** Target size in tokens (FR-2.4: ~350). */
  targetTokens?: number;
  /** Overlap as a fraction of the target (FR-2.4: 15%). */
  overlapRatio?: number;
  /** Chunks shorter than this are folded into the previous chunk rather than emitted alone. */
  minTokens?: number;
  /**
   * ADR-0071: keep chunks that are not prose (heading runs, contents pages, reference lists).
   * Off by default; on only for tests that pin the raw split.
   */
  keepNonProse?: boolean;
};

export type Chunk = {
  ordinal: number;
  text: string;
  charStart: number;
  charEnd: number;
  page: number | null;
  section: string | null;
  tokenCount: number;
};

export const DEFAULT_TARGET_TOKENS = 350;
export const DEFAULT_OVERLAP_RATIO = 0.15;

function pageAt(offset: number, pages: readonly PageSpan[] | undefined): number | null {
  if (!pages || pages.length === 0) return null;
  for (const span of pages) {
    if (offset >= span.start && offset < span.end) return span.page;
  }
  return pages[pages.length - 1]?.page ?? null;
}

/** Section spans covering the whole text; gaps between headings become unlabelled spans. */
function sectionSpans(input: ChunkInput): SectionSpan[] {
  const provided = [...(input.sections ?? [])].sort((a, b) => a.start - b.start);
  if (provided.length === 0) return [{ section: '', start: 0, end: input.text.length }];

  const spans: SectionSpan[] = [];
  let cursor = 0;
  for (const span of provided) {
    if (span.start > cursor) spans.push({ section: '', start: cursor, end: span.start });
    spans.push(span);
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < input.text.length)
    spans.push({ section: '', start: cursor, end: input.text.length });
  return spans.filter((s) => s.end > s.start);
}

export function chunkText(input: ChunkInput, options: ChunkOptions = {}): Chunk[] {
  const target = options.targetTokens ?? DEFAULT_TARGET_TOKENS;
  const overlapTokens = Math.round(target * (options.overlapRatio ?? DEFAULT_OVERLAP_RATIO));
  const minTokens = options.minTokens ?? Math.max(1, Math.round(target * 0.1));

  const chunks: Chunk[] = [];

  for (const span of sectionSpans(input)) {
    const sectionText = input.text.slice(span.start, span.end);
    // Offsets are relative to the section; `span.start` maps them back to the original text.
    const sentences = splitSentences(sectionText);
    if (sentences.length === 0) continue;

    let index = 0;
    while (index < sentences.length) {
      let tokens = 0;
      let end = index;

      // Take whole sentences until the budget is met. Always take at least one.
      while (end < sentences.length) {
        const sentence = sentences[end];
        if (!sentence) break;
        const sentenceTokens = approxTokens(sentence.text);
        if (end > index && tokens + sentenceTokens > target) break;
        tokens += sentenceTokens;
        end++;
      }

      const first = sentences[index];
      const last = sentences[end - 1];
      if (!first || !last) break;

      const charStart = span.start + first.start;
      const charEnd = span.start + last.end;
      const text = input.text.slice(charStart, charEnd);

      const isTail = end >= sentences.length;
      const previous = chunks.at(-1);
      const tooSmall = approxTokens(text.trim()) < minTokens;

      if (isTail && tooSmall && previous && previous.section === (span.section || null)) {
        // A short trailing remainder joins the previous chunk instead of standing alone.
        previous.text = input.text.slice(previous.charStart, charEnd);
        previous.charEnd = charEnd;
        previous.tokenCount = approxTokens(previous.text);
      } else if (text.trim().length > 0) {
        chunks.push({
          ordinal: chunks.length,
          text,
          charStart,
          charEnd,
          page: pageAt(charStart, input.pages),
          section: span.section || null,
          tokenCount: approxTokens(text),
        });
      }

      if (isTail) break;

      // Step back far enough to overlap by ~overlapTokens, measured in whole sentences, but always
      // advance by at least one sentence so the loop terminates.
      let back = 0;
      let overlap = 0;
      while (index + back < end - 1) {
        const sentence = sentences[end - 1 - back];
        if (!sentence) break;
        const next = overlap + approxTokens(sentence.text);
        if (next > overlapTokens) break;
        overlap = next;
        back++;
      }
      index = Math.max(index + 1, end - back);
    }
  }

  // ADR-0071: a chunk that is a run of headings, a contents page or a reference list is not
  // evidence for anything, but it sits close to any vague query ("Chapter 1.") and the draft then
  // described the paper's headings as findings. Dropped here, unless that would leave nothing.
  const prose = options.keepNonProse ? chunks : chunks.filter(isProseChunk);
  return (prose.length > 0 ? prose : chunks).map((chunk, ordinal) => ({ ...chunk, ordinal }));
}

/** Sections whose text is never evidence: the paper's own apparatus. */
const APPARATUS_SECTION =
  /^(\d+(\.\d+)*\.?\s*)?(references|bibliography|works cited|literature cited|reference list|acknowledge?ments?|table of contents|contents|list of (figures|tables|abbreviations))\b/i;

/** Fewer words than this is a fragment, not a passage. */
export const MIN_PROSE_WORDS = 12;

/**
 * Whether a chunk reads as prose a sentence could be grounded in (ADR-0071). Not prose:
 *   - a chunk in the references, acknowledgements or contents section;
 *   - a fragment of fewer than `MIN_PROSE_WORDS` words;
 *   - a run of short lines with no sentence in them (headings, a contents page, a figure list);
 *   - a block dominated by reference entries (years in brackets, "et al.", DOIs).
 */
export function isProseChunk(chunk: { text: string; section: string | null }): boolean {
  if (chunk.section && APPARATUS_SECTION.test(chunk.section.trim())) return false;
  const text = chunk.text.trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < MIN_PROSE_WORDS) return false;

  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sentenceEnds = (text.match(/[a-z0-9)\]][.!?](\s|$)/gi) ?? []).length;
  // A heading is a handful of words. A PDF wraps prose every ten or so words, and those lines end
  // without punctuation too, so the bar is six words, not ten (measured on the dev library).
  const shortLines = lines.filter(
    (line) => line.split(/\s+/).length <= 6 && !/[.!?:;,]$/.test(line),
  );
  if (lines.length >= 4 && shortLines.length / lines.length >= 0.7 && sentenceEnds < 2) {
    return false;
  }

  const referenceMarks =
    (text.match(/\(\d{4}[a-z]?\)/g) ?? []).length +
    (text.match(/\bet al\./g) ?? []).length +
    (text.match(/\bdoi\.org\/|\bdoi:/gi) ?? []).length;
  if (referenceMarks >= 6 && referenceMarks / words.length > 0.08) return false;

  return true;
}

/** Splits chunks into batches for the embedding provider (PHASES 2.7: batches of 64). */
export function batched<T>(items: readonly T[], size = 64): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}
