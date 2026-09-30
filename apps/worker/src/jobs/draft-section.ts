/**
 * `draft-section` — PRD FR-4.4, A.2, §9.3, PHASES 4.2.
 *
 * One Strong-tier call that writes a whole section. It runs in the worker rather than the request
 * because it is the longest call in the product and a dropped connection must not waste it: the
 * result is published to Redis, so a student who reloads still gets their draft.
 *
 * There is no `Draft` table. PRD §8 defines none, and FR-4.4 puts the draft in the document as a
 * marked block the student must accept or discard, so the only durable record is the
 * `SuggestionEvent` the API opens and the block itself. The `draftId` in §9.3 is that event's id.
 */

import type { EmbeddingProvider, LlmProvider } from '@tc/ai';
import {
  buildDraftRequest,
  canDraft,
  DRAFT,
  type DraftResult,
  type DraftSection,
  draftToProseMirror,
  NO_SOURCES_MESSAGE,
  type PromptPassage,
  postProcessDraft,
} from '@tc/ai';
import type { PrismaClient } from '@tc/db';
import { docToText } from '@tc/retrieval';
import type { DraftSectionJob } from '@tc/types';

export type DraftSectionDeps = {
  prisma: PrismaClient;
  llm: LlmProvider;
  embeddings: EmbeddingProvider;
  /** The A.0.1 block for this chapter, built by the same code the API uses. */
  memoryBlock: (chapter: DraftChapter) => Promise<string>;
  /** §10.4 retrieval, honouring the chapter's pins. */
  retrieve: (
    chapter: DraftChapter,
    query: string,
  ) => Promise<{
    passages: Array<PromptPassage & { sourceId: string; chunkId: string }>;
    byKey: Map<string, { sourceId: string; chunkId: string; shortRef: string }>;
  }>;
  /** Whether `draftModeStrongTier` is on (PHASES 4.9). */
  strongTier: () => Promise<boolean>;
  /** Progress and result, published for the API's SSE stream. */
  publish: (event: DraftEvent) => Promise<unknown>;
  /** Writes the `AiCallLog` row (§10.2 step 5). Optional so unit tests can omit it. */
  logCall?: (call: DraftCallLog) => Promise<unknown>;
  /**
   * ADR-0037: asks for papers on this section when the library has none. Resolves true when a
   * search was started (the feature is on, the student has not turned it off, and the month's
   * searches are not used up). Optional so unit tests can omit it.
   */
  findSources?: (input: { chapterId: string; query: string }) => Promise<boolean>;
  log?: (event: Record<string, unknown>) => void;
};

/** The refusal when a search for this section's sources has just been started (ADR-0037). */
export function findingSourcesMessage(sectionTitle: string): string {
  return (
    `No source in your library covers “${sectionTitle}” yet. We are finding papers on it and ` +
    'adding them to your library now. Try Draft again in a minute or two.'
  );
}

export type DraftCallLog = {
  userId: string;
  documentId: string;
  tier: 'fast' | 'strong';
  modelId: string;
  usage: {
    inputTokens: number;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
    outputTokens: number;
  } | null;
  latencyMs: number;
  ok: boolean;
  error?: string;
};

export type DraftChapter = {
  id: string;
  documentId: string;
  outlineNodeId: string;
  title: string;
  scopeNote: string | null;
  content: unknown;
};

export type DraftEvent =
  | { type: 'progress'; stage: 'retrieving' | 'writing'; draftId: string }
  | {
      type: 'done';
      draftId: string;
      result: DraftResult;
      /** §9.3's `content`: ProseMirror nodes with DRAFT provenance, ready to insert. */
      content: unknown[];
      short: boolean;
      needsSource: string[];
      words: number;
      targetWords: number;
    }
  | { type: 'refused'; draftId: string; reason: string }
  | { type: 'error'; draftId: string; message: string };

export type DraftSectionResult = {
  draftId: string;
  status: 'done' | 'refused' | 'error';
  words: number;
  citations: number;
  needsSource: number;
  short: boolean;
};

export async function runDraftSection(
  job: DraftSectionJob & { draftId: string },
  deps: DraftSectionDeps,
): Promise<DraftSectionResult> {
  const log = deps.log ?? (() => undefined);
  const { draftId } = job;

  const chapter = await deps.prisma.chapter.findFirst({
    where: { id: job.chapterId, documentId: job.documentId },
    select: {
      id: true,
      documentId: true,
      outlineNodeId: true,
      title: true,
      scopeNote: true,
      content: true,
    },
  });
  if (!chapter) {
    await deps.publish({ type: 'error', draftId, message: 'That chapter no longer exists.' });
    return { draftId, status: 'error', words: 0, citations: 0, needsSource: 0, short: false };
  }

  const section = await sectionFor(deps.prisma, chapter, job.outlineNodeId);
  const targetWords = job.targetWords ?? DRAFT.defaultTargetWords;

  await deps.publish({ type: 'progress', stage: 'retrieving', draftId });

  // The query is the section's own scope note: that is what this section is meant to be about.
  const retrieved = await deps.retrieve(chapter, `${section.title}. ${section.scopeNote}`);
  const passages = retrieved.passages.slice(0, DRAFT.topK);

  // FR-4.4's AC: refuse rather than write ungrounded prose.
  if (!canDraft(passages)) {
    const searching = await deps
      .findSources?.({
        chapterId: chapter.id,
        query: `${section.title}. ${section.scopeNote}`,
      })
      .catch(() => false);
    await deps.publish({
      type: 'refused',
      draftId,
      reason: searching ? findingSourcesMessage(section.title) : NO_SOURCES_MESSAGE,
    });
    log({ msg: 'draft refused', draftId, reason: 'no sources' });
    return { draftId, status: 'refused', words: 0, citations: 0, needsSource: 0, short: false };
  }

  await deps.publish({ type: 'progress', stage: 'writing', draftId });

  const tier = (await deps.strongTier()) ? 'strong' : 'fast';
  const request = buildDraftRequest({
    memoryBlock: await deps.memoryBlock(chapter),
    section,
    passages,
    targetWords,
    tier,
    userId: job.userId,
    documentId: job.documentId,
  });

  let markdown = '';
  let usage: {
    inputTokens: number;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
    outputTokens: number;
  } | null = null;
  let modelId = deps.llm.modelIdFor(tier);
  const startedAt = Date.now();
  try {
    for await (const chunk of deps.llm.stream(request)) {
      if (chunk.type === 'text') markdown += chunk.text;
      else {
        usage = chunk.usage;
        modelId = chunk.modelId;
      }
    }
  } catch (error) {
    // §10.2 step 5: a failed call is logged too, at zero cost, so the failure rate is visible.
    await deps.logCall?.({
      userId: job.userId,
      documentId: job.documentId,
      tier,
      modelId,
      usage: null,
      latencyMs: Date.now() - startedAt,
      ok: false,
      error: String(error instanceof Error ? error.message : error).slice(0, 500),
    });
    await deps.publish({
      type: 'error',
      draftId,
      message: 'The draft could not be written. Try again.',
    });
    log({ msg: 'draft provider error', draftId, error: String(error) });
    return { draftId, status: 'error', words: 0, citations: 0, needsSource: 0, short: false };
  }

  // §10.2 step 5 / PHASES 4.3: every provider call lands in `AiCallLog` with its real token
  // usage. Cost is computed by the API's shared table, so the worker only reports what it saw.
  await deps.logCall?.({
    userId: job.userId,
    documentId: job.documentId,
    tier,
    modelId,
    usage,
    latencyMs: Date.now() - startedAt,
    ok: true,
  });

  // The chapter as it stands, so a draft does not repeat what is already written (quality.ts).
  const processed = postProcessDraft(markdown, passages, targetWords, docToText(chapter.content));

  // Prompt ids become the real ids the citation nodes will carry.
  const citations = processed.result.citations.flatMap((citation) => {
    const real = retrieved.byKey.get(citation.key);
    return real
      ? [
          {
            key: citation.key,
            sourceId: real.sourceId,
            chunkId: real.chunkId,
            // The label the citation node renders. Without it the node falls back to
            // "(Source, n.d.)", which tells the student nothing about what they are citing.
            rendered: `(${real.shortRef})`,
          },
        ]
      : [];
  });

  const result: DraftResult = { ...processed.result, citations };

  // §9.3's result carries `content`, not markdown: the conversion belongs here, beside the
  // citation map, rather than in the browser where the prompt package cannot go.
  const byKey = new Map(citations.map((citation) => [citation.key, citation]));
  const content = draftToProseMirror(result.markdown, draftId, (key) => {
    const citation = byKey.get(key);
    return citation ? { sourceId: citation.sourceId, chunkId: citation.chunkId } : null;
  });

  await deps.publish({
    type: 'done',
    draftId,
    result,
    content,
    short: processed.short,
    needsSource: processed.result.needsSource,
    words: processed.result.words,
    targetWords,
  });

  log({
    msg: 'draft written',
    draftId,
    tier,
    words: processed.result.words,
    targetWords,
    citations: citations.length,
    needsSource: processed.result.needsSource.length,
    short: processed.short,
    hallucinated: processed.hallucinated.length,
    overused: processed.overused,
  });

  return {
    draftId,
    status: 'done',
    words: processed.result.words,
    citations: citations.length,
    needsSource: processed.result.needsSource.length,
    short: processed.short,
  };
}

/**
 * The outline node being drafted, with its subheadings. A.2 forbids the model inventing
 * subheadings, so an outline without them means continuous prose rather than a guess.
 */
async function sectionFor(
  prisma: PrismaClient,
  chapter: DraftChapter,
  outlineNodeId: string,
): Promise<DraftSection> {
  const memory = await prisma.documentMemory.findUnique({
    where: { documentId: chapter.documentId },
    select: { outline: true },
  });

  const { findOutlineNode, readOutline } = await import('@tc/types');
  const node = findOutlineNode(readOutline(memory?.outline), outlineNodeId);

  return {
    outlineNodeId,
    title: node?.title ?? chapter.title,
    scopeNote: node?.scopeNote ?? chapter.scopeNote ?? '',
    children: (node?.children ?? []).map((child) => ({
      title: child.title,
      scopeNote: child.scopeNote,
    })),
  };
}
