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
import {
  AUTO_SOURCES,
  disciplineProfile,
  PARADIGMS,
  type Paradigm,
  suggestDiscipline,
  writingGuidance,
} from '@tc/config';
import type { PrismaClient } from '@tc/db';
import { closeToPassages, docToText } from '@tc/retrieval';
import { type DraftSectionJob, isGenericSectionTitle } from '@tc/types';

/** ADR-0071: what the student is told when the section names no topic. */
export const SECTION_NEEDS_TOPIC_MESSAGE =
  'Add a heading above the cursor, such as "Financial constraints", then draft again. A draft ' +
  'for "Chapter 1" has no topic to write about.';

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
    options?: { section?: string },
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
  /**
   * ADR-0076: after a search started for a thin section, wait (bounded) until the papers it adds
   * can be cited. Resolves with how many became citable. Absent: drafts never wait.
   */
  waitForNewSources?: (input: { documentId: string; since: Date }) => Promise<number>;
  log?: (event: Record<string, unknown>) => void;
};

/**
 * ADR-0076: fewer distinct on-topic sources than this, and Draft looks for more before writing
 * (when automatic sources are on and the month's searches allow). Three is the least a section
 * of a thesis can be argued from without leaning on one paper.
 */
export const SEARCH_FIRST_MIN_SOURCES = 3;

/** Distinct sources among passages at or above the relevance floor. */
export function onTopicSources(passages: ReadonlyArray<{ sourceId: string; cosine?: number }>) {
  return new Set(
    passages.filter((p) => (p.cosine ?? 0) >= AUTO_SOURCES.minCosine).map((p) => p.sourceId),
  ).size;
}

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
  | { type: 'progress'; stage: 'retrieving' | 'searching' | 'writing'; draftId: string }
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
      /** ADR-0071: paragraphs that follow a passage's wording too closely. */
      closeTo?: DraftCloseTo[];
    }
  | { type: 'refused'; draftId: string; reason: string }
  | { type: 'error'; draftId: string; message: string };

export type DraftCloseTo = {
  shortRef: string;
  page: number | null;
  overlapText: string;
  kind: 'verbatim' | 'close';
};

/**
 * ADR-0071: the draft's paragraphs checked against the passages it was written from, so the
 * student is told which ones follow a paper's wording before accepting. At most three, worst
 * first; nothing is rewritten.
 */
export function draftCloseTo(
  markdown: string,
  passages: ReadonlyArray<{
    chunkId: string;
    sourceId: string;
    shortRef: string;
    page: number | null;
    text: string;
  }>,
): DraftCloseTo[] {
  const found: DraftCloseTo[] = [];
  for (const paragraph of markdown.split(/\n{2,}/)) {
    const match = closeToPassages(paragraph, passages);
    if (match) {
      found.push({
        shortRef: match.shortRef,
        page: match.page,
        overlapText: match.overlapText,
        kind: match.kind,
      });
    }
  }
  return found
    .sort((a, b) => Number(b.kind === 'verbatim') - Number(a.kind === 'verbatim'))
    .slice(0, 3);
}

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
      // ADR-0047: the discipline and research type the guidance is chosen by.
      document: { select: { field: true, meta: true, title: true } },
    },
  });
  if (!chapter) {
    await deps.publish({ type: 'error', draftId, message: 'That chapter no longer exists.' });
    return { draftId, status: 'error', words: 0, citations: 0, needsSource: 0, short: false };
  }

  const found = await sectionFor(deps.prisma, chapter, job.outlineNodeId, job.heading);
  // ADR-0078: a heading the student typed, with no planned section behind it, has no scope note,
  // and the title alone ("Financial constraints") matches any passage about money and tells the
  // writer nothing about where to stop. The real-model run of 2026-10-05 drafted a general survey
  // of barriers under it. The scope says: this heading, in this thesis, and nothing else.
  const thesisTitle = (chapter as { document?: { title?: string | null } | null }).document?.title;
  const section =
    !found.scopeNote.trim() && job.heading && !isGenericSectionTitle(found.title)
      ? { ...found, scopeNote: headingOnlyScope(found.title, thesisTitle ?? null) }
      : found;
  const targetWords = job.targetWords ?? DRAFT.defaultTargetWords;

  // ADR-0071: a section that names no topic is not drafted (the API refuses it first; this is the
  // worker's own guard for any other caller). The unit is refunded on a refusal.
  if (isGenericSectionTitle(section.title) && !section.scopeNote.trim()) {
    await deps.publish({ type: 'refused', draftId, reason: SECTION_NEEDS_TOPIC_MESSAGE });
    log({ msg: 'draft refused', draftId, reason: 'generic section' });
    return { draftId, status: 'refused', words: 0, citations: 0, needsSource: 0, short: false };
  }

  await deps.publish({ type: 'progress', stage: 'retrieving', draftId });

  // The query is the section's own title and scope note: that is what this section is meant to be
  // about. ADR-0071: under a heading the student typed, their own text in it says the rest.
  const query = [section.title, section.scopeNote, job.context ?? '']
    .map((part) => part.trim())
    .filter(Boolean)
    .join('. ');
  // ADR-0085: within the section's own pins when it has any.
  let retrieved = await deps.retrieve(chapter, query, { section: section.title });

  // ADR-0076: a thin library for this section means a thin draft. Search first, wait (bounded)
  // for what the search adds to be readable, then retrieve again. Nothing waits when automatic
  // sources are off or the month's searches are used up (`findSources` says no).
  if (
    onTopicSources(retrieved.passages) < SEARCH_FIRST_MIN_SOURCES &&
    deps.findSources &&
    deps.waitForNewSources
  ) {
    const since = new Date();
    const started = await deps.findSources({ chapterId: chapter.id, query }).catch(() => false);
    if (started) {
      await deps.publish({ type: 'progress', stage: 'searching', draftId });
      const ready = await deps
        .waitForNewSources({ documentId: chapter.documentId, since })
        .catch(() => 0);
      log({ msg: 'draft searched first', draftId, ready });
      if (ready > 0) {
        await deps.publish({ type: 'progress', stage: 'retrieving', draftId });
        retrieved = await deps.retrieve(chapter, query, { section: section.title });
      }
    }
  }
  const passages = retrieved.passages.slice(0, DRAFT.topK);

  // FR-4.4's AC: refuse rather than write ungrounded prose.
  if (!canDraft(passages)) {
    const searching = await deps
      .findSources?.({
        chapterId: chapter.id,
        query,
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
  // ADR-0047: what counts as evidence and validity in this kind of research goes with the section
  // to the writer — the retrieval query above stays the section's own words.
  const guidance = guidanceFor(
    (chapter as { document?: { field: string | null; meta: unknown } | null }).document ?? null,
    section.title,
  );
  const request = buildDraftRequest({
    memoryBlock: await deps.memoryBlock(chapter),
    section: guidance
      ? { ...section, scopeNote: `${section.scopeNote}\n${guidance}`.trim() }
      : section,
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
    closeTo: draftCloseTo(processed.result.markdown, passages),
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
  heading?: string,
): Promise<DraftSection> {
  const memory = await prisma.documentMemory.findUnique({
    where: { documentId: chapter.documentId },
    select: { outline: true },
  });

  const { findOutlineNode, readOutline, sectionUnderHeading } = await import('@tc/types');
  const outline = readOutline(memory?.outline);
  // ADR-0072: an editor opened before the chapters were planned still holds the placeholder
  // node id ('ch-1'); the chapter row itself has the planned one.
  const node =
    findOutlineNode(outline, outlineNodeId) ?? findOutlineNode(outline, chapter.outlineNodeId);

  // ADR-0071: the heading the cursor was under. Drafted as that section: its own scope note when
  // the outline has it, else the chapter's as background; continuous prose (no invented
  // subheadings), as A.2 requires when none are given.
  if (heading?.trim()) {
    // ADR-0078: the planned section with this heading, in this chapter first, else anywhere in
    // the plan ("Financial constraints" is often planned under the literature review while the
    // student writes it elsewhere). No planned section: no scope note at all. Borrowing the
    // chapter's own note made a "Financial constraints" draft follow the Introduction's framing
    // (the real-model run, 2026-10-05); the heading and the student's text say what it is about.
    const sub =
      sectionUnderHeading(node, heading) ??
      sectionUnderHeading({ id: '', title: '', scopeNote: '', children: outline }, heading);
    return {
      outlineNodeId,
      title: heading.trim(),
      scopeNote: sub?.scopeNote ?? '',
      children: (sub?.children ?? []).map((child) => ({
        title: child.title,
        scopeNote: child.scopeNote,
      })),
    };
  }

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

/**
 * ADR-0047: the discipline and research type for Draft mode — the one the student chose on the
 * build screen (`Document.meta.chapterProfile`) when there is one, else suggested from the
 * thesis's field. No field and no saved profile: no guidance, rather than a guessed discipline.
 */
export function guidanceFor(
  document: { field: string | null; meta: unknown } | null,
  sectionTitle: string,
): string {
  if (!document) return '';
  const saved = (
    document.meta as { chapterProfile?: { disciplineId?: unknown; paradigm?: unknown } } | null
  )?.chapterProfile;
  const discipline =
    typeof saved?.disciplineId === 'string'
      ? disciplineProfile(saved.disciplineId)
      : suggestDiscipline(document.field);
  if (!discipline) return '';
  const paradigm: Paradigm =
    typeof saved?.paradigm === 'string' && (PARADIGMS as readonly string[]).includes(saved.paradigm)
      ? (saved.paradigm as Paradigm)
      : (discipline.defaultParadigms[0] ?? 'experimental');
  return writingGuidance(discipline, paradigm, sectionTitle);
}

/**
 * ADR-0078: the scope note of a section that is only a heading. It goes to the unchanged A.2
 * prompt as the section's scope, and into the retrieval query.
 */
export function headingOnlyScope(title: string, thesisTitle: string | null): string {
  const topic = thesisTitle?.trim() ? ` in "${thesisTitle.trim()}"` : '';
  return `${title.trim()}${topic}, and only that. Every other topic, however close, belongs to another section: leave it out.`;
}
