/**
 * Examiner review — ADR-0056. The chapter build's examiner (ADR-0039, `examiner.md`), pointed at a
 * chapter the student wrote: the saved chapter is split into sections by its headings, each
 * section's sentences go to the examiner with the passages its citations point at, and every issue
 * comes back pinned to one sentence.
 *
 * This file is the pure half: reading the ProseMirror document into sections of sentences with
 * exact positions, and the request. The worker (`apps/worker/src/jobs/examiner-review.ts`) loads
 * the chapter and the passages, makes the calls and writes the flags; the API uses
 * `ownSentenceCount` to refuse a chapter too short to review before it takes a unit.
 *
 * Two rules from the rest of the product are held here:
 *
 * - **A pending AI draft is not the student's text** (FR-4.10, B.6). A `draftBlock` still waiting
 *   for a decision is skipped, however much it contains; it is neither reviewed nor counted.
 * - **A flag points at a range** (Appendix D.1.3). Every sentence carries the ProseMirror
 *   positions it occupies, computed by the same node-size accounting the editor uses, so the
 *   examiner's sentence id maps back to a range without matching text.
 */

import type { LlmRequest } from '../types.js';
import { buildExaminerRequest, CHAPTER_BUILD, type ExaminerInput } from './chapter-build.js';
import { splitSentences } from './quality.js';

export const EXAMINER_REVIEW = {
  /** Mirrors `EXAMINER_REVIEW_MAX_SECTIONS` in `@tc/config`, which the cost row is priced on. */
  maxSections: 8,
  /** A section longer than this is sent in parts, so one call stays near the priced shape. */
  maxSentencesPerSection: 50,
  /** Sections reviewed at once. */
  concurrency: 3,
  /** Fewer sentences of the student's own than this, and there is nothing to examine. */
  minSentences: 3,
  /** Characters of one cited passage sent to the examiner. */
  passageChars: 1_200,
  /** Chunks read for a citation that names no passage (`chunkId` null). */
  chunksPerUncitedSource: 2,
  /** One call may take this long; past it the section is reported as not reviewed. */
  callTimeoutMs: CHAPTER_BUILD.callTimeoutMs,
} as const;

type PmNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
};

/** Nodes that occupy one position and hold no content (`atom` in the editor's schema). */
const LEAF_NODES = new Set([
  'citation',
  'crossRef',
  'footnote',
  'mathInline',
  'mathBlock',
  'needsSourceNote',
  'hardBreak',
  'horizontalRule',
  'image',
  'tableOfContents', // R28 (ADR-0119): the contents block, an atom
]);

/** Blocks whose text is not prose an examiner reads. */
const SKIPPED_BLOCKS = new Set(['codeBlock', 'mathBlock', 'table', 'image', 'horizontalRule']);

/** ProseMirror's `nodeSize` for a JSON node. */
function nodeSize(node: PmNode): number {
  if (node.type === 'text') return node.text?.length ?? 0;
  if (LEAF_NODES.has(node.type ?? '')) return 1;
  let inner = 0;
  for (const child of node.content ?? []) inner += nodeSize(child);
  return inner + 2;
}

const isPendingDraft = (node: PmNode): boolean =>
  node.type === 'draftBlock' && (node.attrs?.status ?? 'pending') !== 'accepted';

export type ReviewCitation = {
  sourceId: string | null;
  chunkId: string | null;
};

export type ReviewSentence = {
  /** The sentence with `{{cite:cN}}` where a citation sits; N indexes `ReviewChapter.citations`. */
  marked: string;
  /** The sentence as the student reads it, citations left out. */
  plain: string;
  from: number;
  to: number;
  /** Indexes into `ReviewChapter.citations` of the citations inside this sentence. */
  citations: number[];
};

export type ReviewSection = {
  title: string;
  isSummary: boolean;
  sentences: ReviewSentence[];
};

export type ReviewChapter = {
  sections: ReviewSection[];
  citations: ReviewCitation[];
  /** Sections past `maxSections` that were not sent, and the sentences in them. */
  omittedSections: number;
  omittedSentences: number;
};

type Item =
  | { kind: 'heading'; level: number; title: string }
  | { kind: 'sentence'; sentence: ReviewSentence };

/** One textblock's sentences, with exact positions. `start` is the position of its first child. */
function textblockSentences(
  block: PmNode,
  start: number,
  citations: ReviewCitation[],
): ReviewSentence[] {
  let text = '';
  const posOf: number[] = [];
  const citeAt: Array<number | null> = [];
  const push = (chunk: string, pos: (i: number) => number, cite: number | null) => {
    for (let i = 0; i < chunk.length; i++) {
      text += chunk[i];
      posOf.push(pos(i));
      citeAt.push(cite);
    }
  };

  let pos = start;
  const walkInline = (node: PmNode) => {
    if (node.type === 'text') {
      const at = pos;
      push(node.text ?? '', (i) => at + i, null);
      pos += node.text?.length ?? 0;
      return;
    }
    if (node.type === 'citation') {
      const index = citations.length;
      citations.push({
        sourceId: (node.attrs?.sourceId as string | null | undefined) ?? null,
        chunkId: (node.attrs?.chunkId as string | null | undefined) ?? null,
      });
      const at = pos;
      push(`{{cite:c${index}}}`, () => at, index);
      pos += 1;
      return;
    }
    if (node.type === 'hardBreak') {
      const at = pos;
      push(' ', () => at, null);
      pos += 1;
      return;
    }
    if (node.type === 'mathInline' || node.type === 'crossRef') {
      const at = pos;
      push(node.type === 'mathInline' ? '[equation]' : '[cross-reference]', () => at, null);
      pos += 1;
      return;
    }
    if (LEAF_NODES.has(node.type ?? '')) {
      // A footnote or a stray note: one position, nothing an examiner reads in the sentence.
      pos += 1;
      return;
    }
    // An unknown inline wrapper: walk into it.
    pos += 1;
    for (const child of node.content ?? []) walkInline(child);
    pos += 1;
  };
  for (const child of block.content ?? []) walkInline(child);

  const out: ReviewSentence[] = [];
  let cursor = 0;
  for (const sentence of splitSentences(text)) {
    const at = text.indexOf(sentence, cursor);
    if (at < 0) continue;
    const end = at + sentence.length;
    cursor = end;
    const plain = sentence
      .replace(/\{\{cite:[^}]+\}\}/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
      .trim();
    const cited = new Set<number>();
    for (let i = at; i < end; i++) {
      const c = citeAt[i];
      if (c !== null && c !== undefined) cited.add(c);
    }
    out.push({
      marked: sentence,
      plain,
      from: posOf[at] as number,
      to: (posOf[end - 1] as number) + 1,
      citations: [...cited],
    });
  }
  return out;
}

const isTextblock = (node: PmNode): boolean =>
  node.type === 'paragraph' ||
  node.type === 'heading' ||
  (node.content ?? []).some((c) => c.type === 'text' || c.type === 'citation');

/** Walks one block (at position `pos`) into `items`. */
function walkBlock(node: PmNode, pos: number, items: Item[], citations: ReviewCitation[]): void {
  if (isPendingDraft(node) || SKIPPED_BLOCKS.has(node.type ?? '')) return;
  if (node.type === 'heading') {
    const title = (node.content ?? [])
      .map((c) => c.text ?? '')
      .join('')
      .trim();
    const level = Number(node.attrs?.level ?? 1);
    if (title) items.push({ kind: 'heading', level: Number.isFinite(level) ? level : 1, title });
    return;
  }
  if (isTextblock(node)) {
    for (const sentence of textblockSentences(node, pos + 1, citations)) {
      items.push({ kind: 'sentence', sentence });
    }
    return;
  }
  // A container (list, blockquote, an accepted draft block): its children are blocks.
  let inner = pos + 1;
  for (const child of node.content ?? []) {
    walkBlock(child, inner, items, citations);
    inner += nodeSize(child);
  }
}

const SUMMARY_TITLE = /\b(summary|conclusions?|concluding)\b/i;

function buildSections(items: readonly Item[], splitAt: number, fallbackTitle: string) {
  const sections: ReviewSection[] = [];
  let current: ReviewSection = { title: fallbackTitle, isSummary: false, sentences: [] };
  for (const item of items) {
    if (item.kind === 'heading') {
      if (item.level > splitAt) continue;
      if (current.sentences.length > 0) sections.push(current);
      current = { title: item.title, isSummary: SUMMARY_TITLE.test(item.title), sentences: [] };
      continue;
    }
    current.sentences.push(item.sentence);
  }
  if (current.sentences.length > 0) sections.push(current);
  return sections;
}

/**
 * A chapter as the examiner reads it: sections by heading (a chapter without subheadings is one
 * section), each a list of the student's own sentences with positions.
 *
 * At most `maxSections` sections are sent. When the headings make more, the chapter is split at
 * its top heading level only; a section over `maxSentencesPerSection` is sent in parts; small
 * neighbours are merged; and only then is the rest left out, and counted, so the student is told.
 */
export function reviewChapter(doc: unknown, chapterTitle = 'This chapter'): ReviewChapter {
  const items: Item[] = [];
  const citations: ReviewCitation[] = [];
  let pos = 0;
  for (const block of (doc as PmNode | undefined)?.content ?? []) {
    walkBlock(block, pos, items, citations);
    pos += nodeSize(block);
  }
  const own = (s: ReviewSentence) => s.plain.length >= CHAPTER_BUILD.minSentenceChars;
  const kept: Item[] = items.filter((i) => i.kind === 'heading' || own(i.sentence));

  const levels = kept.flatMap((i) => (i.kind === 'heading' ? [i.level] : []));
  const deepest = levels.length ? Math.max(...levels) : 1;
  const shallowest = levels.length ? Math.min(...levels) : 1;
  let sections = buildSections(kept, deepest, chapterTitle);
  if (sections.length > EXAMINER_REVIEW.maxSections) {
    sections = buildSections(kept, shallowest, chapterTitle);
  }

  // Long sections in parts.
  const max = EXAMINER_REVIEW.maxSentencesPerSection;
  const parts: ReviewSection[] = [];
  for (const section of sections) {
    if (section.sentences.length <= max) {
      parts.push(section);
      continue;
    }
    for (let i = 0; i < section.sentences.length; i += max) {
      const n = i / max + 1;
      parts.push({
        title: n === 1 ? section.title : `${section.title} (part ${n})`,
        isSummary: section.isSummary,
        sentences: section.sentences.slice(i, i + max),
      });
    }
  }

  // The smallest neighbours together, one pair at a time, while a pair still fits one call.
  const merged = [...parts];
  while (merged.length > EXAMINER_REVIEW.maxSections) {
    let best = -1;
    for (let i = 0; i + 1 < merged.length; i++) {
      const size = (merged[i]?.sentences.length ?? 0) + (merged[i + 1]?.sentences.length ?? 0);
      const bestSize =
        best < 0
          ? Number.POSITIVE_INFINITY
          : (merged[best]?.sentences.length ?? 0) + (merged[best + 1]?.sentences.length ?? 0);
      if (size <= max && size < bestSize) best = i;
    }
    if (best < 0) break;
    const a = merged[best] as ReviewSection;
    const b = merged[best + 1] as ReviewSection;
    merged.splice(best, 2, {
      title: `${a.title}; ${b.title}`,
      isSummary: a.isSummary || b.isSummary,
      sentences: [...a.sentences, ...b.sentences],
    });
  }

  const sent = merged.slice(0, EXAMINER_REVIEW.maxSections);
  const left = merged.slice(EXAMINER_REVIEW.maxSections);
  return {
    sections: sent,
    citations,
    omittedSections: left.length,
    omittedSentences: left.reduce((n, s) => n + s.sentences.length, 0),
  };
}

/** The student's own sentences in a chapter — what the API counts before taking a unit. */
export function ownSentenceCount(doc: unknown): number {
  const chapter = reviewChapter(doc);
  return chapter.sections.reduce((n, s) => n + s.sentences.length, 0) + chapter.omittedSentences;
}

export type ReviewPassage = { key: string; text: string };

/**
 * One section's examiner input: sentence ids `s1…`, its citations renumbered `P1…` in order of
 * appearance against the passages that could be read, and a citation whose passage could not be
 * read taken out of the sentence — judging a citation against nothing would be a guess.
 *
 * `passageFor` returns the passage a citation points at (its key is shared between citations of
 * the same passage), or null when there is none.
 */
export function sectionInput(
  section: ReviewSection,
  citations: readonly ReviewCitation[],
  passageFor: (citation: ReviewCitation) => ReviewPassage | null,
): {
  sentences: Array<{ id: string; text: string; sentence: ReviewSentence }>;
  passages: Array<{ id: string; text: string }>;
} {
  const ids = new Map<string, string>();
  const passages: Array<{ id: string; text: string }> = [];
  const sentences = section.sentences.map((sentence, i) => {
    const text = sentence.marked
      .replace(/\{\{cite:c(\d+)\}\}/g, (_m, n: string) => {
        const citation = citations[Number(n)];
        const passage = citation ? passageFor(citation) : null;
        if (!passage) return '';
        let id = ids.get(passage.key);
        // The examiner sees at most `maxPassages`; a marker past them would point at nothing.
        if (!id && ids.size >= CHAPTER_BUILD.maxPassages) return '';
        if (!id) {
          id = `P${ids.size + 1}`;
          ids.set(passage.key, id);
          passages.push({ id, text: passage.text });
        }
        return `{{cite:${id}}}`;
      })
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
      .trim();
    return { id: `s${i + 1}`, text, sentence };
  });
  return { sentences, passages };
}

/** The chapter build's examiner request, metered and logged as `EXAMINER_REVIEW`. */
export function buildExaminerReviewRequest(input: ExaminerInput): Omit<LlmRequest, 'schema'> {
  return { ...buildExaminerRequest(input), action: 'EXAMINER_REVIEW' };
}
