/**
 * Prompt context — the document-memory block (A.0.1) and the §10.4 passages, in one place.
 *
 * Both the API (Assist, citation suggestion) and the worker (draft mode) need exactly this, and
 * the two must agree: a draft retrieved from a different candidate set than the Assist call beside
 * it would cite different sources for the same chapter. Sharing the code is what keeps them
 * honest, so this takes a bare Prisma-shaped client rather than living in either app.
 */

import {
  buildMemoryBlock,
  type GlossaryEntry,
  type MemoryBlock,
  type MemoryScope,
  type PromptPassage,
  type StyleProfile,
} from '@tc/ai';
import { findOutlineNode, readOutline } from '@tc/types';
import { findCandidates, type RawClient } from './pgvector.js';
import { buildQueryText, type RetrievalAction, rerank, topK } from './rank.js';

/** The Prisma surface this module uses. Structural, so either app's client satisfies it. */
export type ContextClient = RawClient & {
  documentMemory: {
    findUnique(args: {
      where: { documentId: string };
      select: Record<string, boolean>;
    }): Promise<Record<string, unknown> | null>;
  };
  chapterSourcePin: {
    findMany(args: {
      where: { chapterId: string };
      select: { sourceId: true };
    }): Promise<Array<{ sourceId: string }>>;
  };
};

export type ContextChapter = {
  id: string;
  documentId: string;
  outlineNodeId: string;
  title: string;
  scopeNote: string | null;
  content: unknown;
  /** §2.2: `Document.language`, so every prompt built from this chapter answers in it. */
  language?: string | null;
};

export type RetrievedPassage = PromptPassage & {
  sourceId: string;
  chunkId: string;
  score: number;
  /**
   * The raw cosine similarity, before §10.4's sub-theme and full-text boosts.
   *
   * Carried separately from `score` because the boosts are worth up to +0.25, which is more than
   * the whole gap between "this is about the question" and "this is not". Any relevance decision
   * has to read this one; `score` is for ordering.
   */
  cosine: number;
};

export type RetrievalResult = {
  passages: RetrievedPassage[];
  /** Short prompt id → real ids, for resolving `{{cite:…}}` in the output. */
  byKey: Map<string, { sourceId: string; chunkId: string; shortRef: string }>;
  pinned: number;
  candidates: number;
};

/** ProseMirror JSON → plain text; A.0.1's glossary trimming needs the chapter as prose. */
export function docToText(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return '';
  const parts: string[] = [];
  const blocks = new Set([
    'paragraph',
    'heading',
    'blockquote',
    'codeBlock',
    'listItem',
    'bulletList',
    'orderedList',
    'tableRow',
    'tableCell',
    'tableHeader',
    'draftBlock',
  ]);

  const visit = (node: { type?: string; text?: string; content?: unknown[] }): void => {
    if (typeof node.text === 'string') {
      parts.push(node.text);
      return;
    }
    if (node.type === 'hardBreak') {
      parts.push('\n');
      return;
    }
    for (const child of (node.content ?? []) as Array<Parameters<typeof visit>[0]>) visit(child);
    if (node.type && blocks.has(node.type)) parts.push('\n');
  };

  visit(doc as Parameters<typeof visit>[0]);
  return parts
    .join('')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** The A.0.1 block for a chapter, built from `DocumentMemory`. */
export async function buildChapterMemory(
  db: ContextClient,
  chapter: ContextChapter,
): Promise<MemoryBlock> {
  const memory = await db.documentMemory.findUnique({
    where: { documentId: chapter.documentId },
    select: { scope: true, outline: true, glossary: true, styleProfile: true },
  });

  return buildMemoryBlock({
    scope: readScope(memory?.scope),
    outline: readOutline(memory?.outline),
    glossary: readGlossary(memory?.glossary),
    styleProfile: readStyleProfile(memory?.styleProfile),
    chapter: { outlineNodeId: chapter.outlineNodeId, text: docToText(chapter.content) },
    ...(chapter.language ? { language: chapter.language } : {}),
  });
}

/**
 * §10.4 end to end: query → candidates (pins honoured) → rerank → top_k.
 *
 * Passage ids are short and per request (`S1#c1`), the form §10.4's example shows. A UUID pair per
 * passage would cost around 25 tokens each and is exactly the kind of string a model mis-copies;
 * the map back to the real ids is returned alongside.
 */
export async function retrievePassages(
  db: ContextClient,
  embed: (texts: readonly string[]) => Promise<number[][]>,
  chapter: ContextChapter,
  queryFrom: string,
  action: RetrievalAction,
): Promise<RetrievalResult> {
  const [pins, memory] = await Promise.all([
    db.chapterSourcePin.findMany({ where: { chapterId: chapter.id }, select: { sourceId: true } }),
    db.documentMemory.findUnique({
      where: { documentId: chapter.documentId },
      select: { outline: true },
    }),
  ]);
  const pinnedSourceIds = pins.map((pin) => pin.sourceId);
  const empty: RetrievalResult = {
    passages: [],
    byKey: new Map(),
    pinned: pinnedSourceIds.length,
    candidates: 0,
  };

  const queryText = buildQueryText(queryFrom, chapter.scopeNote);
  if (queryText.trim().length === 0) return empty;

  const [embedding] = await embed([queryText]);
  if (!embedding) return empty;

  const candidates = await findCandidates(db, embedding, {
    documentId: chapter.documentId,
    pinnedSourceIds,
  });

  const node = findOutlineNode(readOutline(memory?.outline), chapter.outlineNodeId);
  const ranked = topK(rerank(candidates, node?.subTheme), action);

  const sourceNumber = new Map<string, number>();
  const chunkCounter = new Map<string, number>();
  const byKey: RetrievalResult['byKey'] = new Map();

  const passages = ranked.map((candidate): RetrievedPassage => {
    if (!sourceNumber.has(candidate.sourceId)) {
      sourceNumber.set(candidate.sourceId, sourceNumber.size + 1);
    }
    const s = sourceNumber.get(candidate.sourceId) as number;
    const c = (chunkCounter.get(candidate.sourceId) ?? 0) + 1;
    chunkCounter.set(candidate.sourceId, c);

    const id = `S${s}#c${c}`;
    const shortRef = candidate.shortRef ?? 'Source';
    byKey.set(id, { sourceId: candidate.sourceId, chunkId: candidate.chunkId, shortRef });
    return {
      id,
      shortRef,
      page: candidate.page,
      text: candidate.text,
      sourceId: candidate.sourceId,
      chunkId: candidate.chunkId,
      score: candidate.score,
      cosine: candidate.cosine,
    };
  });

  return { passages, byKey, pinned: pinnedSourceIds.length, candidates: candidates.length };
}

// ---------------------------------------------------------------------------------------------
// The JSON columns, read defensively: `DocumentMemory` starts as `{}` / `[]`, and a malformed
// value must degrade the prompt rather than fail the request.
// ---------------------------------------------------------------------------------------------

function readScope(value: unknown): MemoryScope {
  const v = (value ?? {}) as Partial<Record<keyof MemoryScope, unknown>>;
  return {
    workingTitle: typeof v.workingTitle === 'string' ? v.workingTitle : '',
    problemStatement: typeof v.problemStatement === 'string' ? v.problemStatement : '',
    objectives: Array.isArray(v.objectives)
      ? v.objectives.filter((o): o is string => typeof o === 'string')
      : [],
    whyOpen: typeof v.whyOpen === 'string' ? v.whyOpen : '',
  };
}

function readGlossary(value: unknown): Record<string, GlossaryEntry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, GlossaryEntry> = {};
  for (const [term, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Partial<GlossaryEntry>;
    if (typeof e.definition !== 'string') continue;
    out[term] = {
      definition: e.definition,
      ...(typeof e.usageNote === 'string' ? { usageNote: e.usageNote } : {}),
    };
  }
  return out;
}

function readStyleProfile(value: unknown): StyleProfile | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<StyleProfile>;
  if (typeof v.voiceNote !== 'string' || typeof v.avgSentenceLen !== 'number') return null;
  return {
    avgSentenceLen: v.avgSentenceLen,
    register: typeof v.register === 'string' ? v.register : '',
    voice: typeof v.voice === 'string' ? v.voice : '',
    transitions: Array.isArray(v.transitions)
      ? v.transitions.filter((t): t is string => typeof t === 'string')
      : [],
    voiceNote: v.voiceNote,
  };
}
