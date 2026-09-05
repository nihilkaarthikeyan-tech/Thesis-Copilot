/**
 * Assist context — the two halves of an A.1 request the service itself does not know how to make:
 * the cached document-memory block (A.0.1, §10.3) and the retrieved passages (§10.4).
 *
 * PHASES 3.3, verbatim:
 *   "Query = last sentence of `before` + scope note; pins filter; top 24 → rerank → top 6;
 *    passages rendered with `shortRef` (first author, year, venue) and page."
 *
 * Passage ids are short and per request (`S1#c1`, `S1#c2`, `S2#c1`), the form §10.4's example
 * shows. A UUID pair per passage would cost ~25 tokens each and is exactly the kind of string a
 * model mis-copies; the map back to real ids lives here for the life of one request and the
 * accepted citation node stores the real ids (task 3.5).
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildMemoryBlock,
  type GlossaryEntry,
  type MemoryBlock,
  type MemoryScope,
  type PromptPassage,
  type Providers,
  type StyleProfile,
} from '@tc/ai';
import {
  buildQueryText,
  findCandidates,
  type RawClient,
  type RetrievalAction,
  rerank,
  topK,
} from '@tc/retrieval';
import { findOutlineNode, readOutline } from '@tc/types';
import { PrismaService } from '../../common/prisma.service.js';
import { PROVIDERS } from '../ai/ai.module.js';
import { docToText } from './doc-text.js';

export type ChapterForContext = {
  id: string;
  documentId: string;
  outlineNodeId: string;
  title: string;
  scopeNote: string | null;
  content: unknown;
};

/** One retrieved passage plus the real ids behind its short prompt id. */
export type RetrievedPassage = PromptPassage & {
  sourceId: string;
  chunkId: string;
  score: number;
};

export type RetrievalResult = {
  passages: RetrievedPassage[];
  /** Short prompt id → real ids, for resolving `{{cite:…}}` in the output. */
  byKey: Map<string, { sourceId: string; chunkId: string; shortRef: string }>;
  pinned: number;
  candidates: number;
};

@Injectable()
export class ContextService {
  private readonly logger = new Logger(ContextService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROVIDERS) private readonly providers: Providers,
  ) {}

  /**
   * The A.0.1 block for this chapter. Reads `DocumentMemory` once and hands the whole thing to
   * the builder; logs when the builder had to trim (§10.3: "logs when it trims").
   */
  async memoryBlock(chapter: ChapterForContext): Promise<MemoryBlock> {
    const memory = await this.prisma.documentMemory.findUnique({
      where: { documentId: chapter.documentId },
      select: { scope: true, outline: true, glossary: true, styleProfile: true },
    });

    const scope = readScope(memory?.scope);
    const block = buildMemoryBlock({
      scope,
      outline: readOutline(memory?.outline),
      glossary: readGlossary(memory?.glossary),
      styleProfile: readStyleProfile(memory?.styleProfile),
      chapter: { outlineNodeId: chapter.outlineNodeId, text: docToText(chapter.content) },
    });

    if (block.trimmed.length > 0) {
      this.logger.log(
        {
          documentId: chapter.documentId,
          chapterId: chapter.id,
          trimmed: block.trimmed,
          tokens: block.tokens,
          overBudget: block.overBudget,
        },
        'memory block trimmed',
      );
    }
    return block;
  }

  /** §10.4 end to end: query → candidates (pins honoured) → rerank → top_k for the action. */
  async retrieve(
    chapter: ChapterForContext,
    before: string,
    action: RetrievalAction,
  ): Promise<RetrievalResult> {
    const [pins, memory] = await Promise.all([
      this.prisma.chapterSourcePin.findMany({
        where: { chapterId: chapter.id },
        select: { sourceId: true },
      }),
      this.prisma.documentMemory.findUnique({
        where: { documentId: chapter.documentId },
        select: { outline: true },
      }),
    ]);
    const pinnedSourceIds = pins.map((pin) => pin.sourceId);

    const queryText = buildQueryText(before, chapter.scopeNote);
    if (queryText.trim().length === 0) {
      return { passages: [], byKey: new Map(), pinned: pinnedSourceIds.length, candidates: 0 };
    }

    const [embedding] = await this.providers.embeddings.embed([queryText]);
    if (!embedding) {
      return { passages: [], byKey: new Map(), pinned: pinnedSourceIds.length, candidates: 0 };
    }

    const candidates = await findCandidates(this.prisma as unknown as RawClient, embedding, {
      documentId: chapter.documentId,
      pinnedSourceIds,
    });

    // The chapter's sub-theme comes from its outline node (§10.4's `chapter.subTheme`).
    const node = findOutlineNode(readOutline(memory?.outline), chapter.outlineNodeId);
    const ranked = topK(rerank(candidates, node?.subTheme), action);

    // Short ids: sources numbered in order of first appearance, chunks within a source likewise.
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
      };
    });

    return { passages, byKey, pinned: pinnedSourceIds.length, candidates: candidates.length };
  }
}

// ---------------------------------------------------------------------------------------------
// Reading the JSON columns defensively. `DocumentMemory` starts as `{}` / `[]` and a malformed
// value must degrade the prompt, never fail the request.
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
