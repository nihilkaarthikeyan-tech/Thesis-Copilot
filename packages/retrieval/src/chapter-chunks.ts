/**
 * Chapter chunking for the coherence engine — PRD Appendix D.1.1, PHASES v2 B1.1.
 *
 *   "Re-chunk and re-embed changed chapters into `ChapterChunk` (≈ 300-token chunks,
 *    paragraph-aligned; store `from`/`to` PM positions)."
 *
 * Paragraph-aligned matters: a flag points at a range the student can be scrolled to, and a chunk
 * that starts mid-sentence produces a "Go to" that lands in the middle of a word. Positions follow
 * ProseMirror's own accounting, the same walk `packages/citations` uses for citation nodes, so a
 * chunk's `from`/`to` are positions the editor can select without translation.
 */

import { approxTokens } from './text.js';

/** ~300 tokens, as D.1.1 asks. Paragraphs are kept whole, so a chunk overshoots rather than splits. */
export const CHAPTER_CHUNK_TOKENS = 300;

export type ChapterChunkInput = {
  ordinal: number;
  from: number;
  to: number;
  text: string;
  tokenCount: number;
};

type Node = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
};

/** One block of a chapter with the positions it occupies. */
export type Block = { from: number; to: number; text: string; type: string };

/**
 * Every top-level block of a chapter, with ProseMirror positions.
 *
 * A `citation` node is an inline atom: it takes one position and contributes no text, because its
 * label is rendered from storage and is not in the document (FR-5.1). Including the label here
 * would make a chunk's text disagree with what a style switch shows.
 */
export function blocksOf(doc: unknown): Block[] {
  const out: Block[] = [];
  const textOf = (node: Node | undefined, pos: number): { text: string; next: number } => {
    if (!node) return { text: '', next: pos };
    if (node.type === 'text')
      return { text: node.text ?? '', next: pos + (node.text?.length ?? 0) };
    if (node.type === 'citation') return { text: '', next: pos + 1 };
    let inner = pos + 1;
    let text = '';
    for (const child of node.content ?? []) {
      const part = textOf(child, inner);
      text += part.text;
      inner = part.next;
    }
    return { text, next: inner + 1 };
  };

  let pos = 0;
  for (const block of (doc as Node | undefined)?.content ?? []) {
    const start = pos;
    const { text, next } = textOf(block, pos);
    pos = next;
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      out.push({ from: start, to: next, text: trimmed, type: block.type ?? 'paragraph' });
    }
  }
  return out;
}

/**
 * Blocks grouped into ~300-token chunks. A block longer than the budget becomes its own chunk
 * rather than being cut: the alternative is a range that starts mid-sentence.
 */
export function chunkChapter(doc: unknown, budget = CHAPTER_CHUNK_TOKENS): ChapterChunkInput[] {
  const blocks = blocksOf(doc);
  const chunks: ChapterChunkInput[] = [];
  let current: Block[] = [];
  let tokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0] as Block;
    const last = current[current.length - 1] as Block;
    const text = current.map((b) => b.text).join('\n\n');
    chunks.push({
      ordinal: chunks.length,
      from: first.from,
      to: last.to,
      text,
      tokenCount: approxTokens(text),
    });
    current = [];
    tokens = 0;
  };

  for (const block of blocks) {
    const size = approxTokens(block.text);
    if (tokens > 0 && tokens + size > budget) flush();
    current.push(block);
    tokens += size;
    if (tokens >= budget) flush();
  }
  flush();
  return chunks;
}

// ---------------------------------------------------------------------------------------------
// Sentences (the unit three of the five checks work in)
// ---------------------------------------------------------------------------------------------

export type ChapterSentence = {
  /** `ch3#s12` — short and stable within one request, which is what the prompts refer to. */
  id: string;
  chapterId: string;
  text: string;
  from: number;
  to: number;
  /** True when a `citation` node sits inside this sentence's range. */
  hasCitation: boolean;
};

/** Abbreviations that end in a full stop without ending a sentence. */
const NOT_A_BREAK =
  /\b(?:e\.g|i\.e|etc|cf|vs|Fig|fig|Eq|eq|No|no|Dr|Prof|Mr|Mrs|Ms|St|al|approx|Ch|Sec|pp|vol)\.$/;

/**
 * Sentences of a chapter with their ProseMirror positions.
 *
 * The split is deliberately simple — a full stop, question mark or exclamation followed by a space
 * and a capital — with an abbreviation guard. A cleverer splitter would be wrong in different
 * places; this one is wrong in predictable ones, and every consumer shows the sentence to the
 * student before acting on it.
 */
export function sentencesOf(
  chapterId: string,
  doc: unknown,
  citationPositions: readonly number[] = [],
): ChapterSentence[] {
  const out: ChapterSentence[] = [];
  const cites = [...citationPositions].sort((a, b) => a - b);

  for (const block of blocksOf(doc)) {
    // The block's text starts one position after the block's own opening token.
    const base = block.from + 1;
    let offset = 0;
    let buffer = '';
    const parts = block.text.split(/(?<=[.!?])\s+/);
    for (const part of parts) {
      buffer = buffer ? `${buffer} ${part}` : part;
      if (NOT_A_BREAK.test(buffer)) continue;
      const from = base + offset;
      const to = from + buffer.length;
      out.push({
        id: `${chapterId.slice(0, 8)}#s${out.length}`,
        chapterId,
        text: buffer.trim(),
        from,
        to,
        hasCitation: cites.some((p) => p >= from && p <= to),
      });
      offset += buffer.length + 1;
      buffer = '';
    }
    if (buffer.trim()) {
      const from = base + offset;
      out.push({
        id: `${chapterId.slice(0, 8)}#s${out.length}`,
        chapterId,
        text: buffer.trim(),
        from,
        to: from + buffer.length,
        hasCitation: cites.some((p) => p >= from && p <= from + buffer.length),
      });
    }
  }
  return out;
}
