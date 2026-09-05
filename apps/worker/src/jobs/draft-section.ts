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
  NO_SOURCES_MESSAGE,
  type PromptPassage,
  postProcessDraft,
} from '@tc/ai';
import type { PrismaClient } from '@tc/db';
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
  log?: (event: Record<string, unknown>) => void;
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
    await deps.publish({ type: 'refused', draftId, reason: NO_SOURCES_MESSAGE });
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
  try {
    for await (const chunk of deps.llm.stream(request)) {
      if (chunk.type === 'text') markdown += chunk.text;
    }
  } catch (error) {
    await deps.publish({
      type: 'error',
      draftId,
      message: 'The draft could not be written. Try again.',
    });
    log({ msg: 'draft provider error', draftId, error: String(error) });
    return { draftId, status: 'error', words: 0, citations: 0, needsSource: 0, short: false };
  }

  const processed = postProcessDraft(markdown, passages, targetWords);

  // Prompt ids become the real ids the citation nodes will carry.
  const citations = processed.result.citations.flatMap((citation) => {
    const real = retrieved.byKey.get(citation.key);
    return real ? [{ key: citation.key, sourceId: real.sourceId, chunkId: real.chunkId }] : [];
  });

  const result: DraftResult = { ...processed.result, citations };

  await deps.publish({
    type: 'done',
    draftId,
    result,
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
