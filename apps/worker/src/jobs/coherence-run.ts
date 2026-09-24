/**
 * `coherence` — PRD §5.6, Appendix D.1, PHASES v2 B1.2–B1.7.
 *
 * One run over one document: work out what changed, re-index those chapters, run the five checks,
 * and reconcile the flags with the previous run's. Everything expensive is bounded before the
 * first call, because D.1.1 puts a rupee ceiling on a run and a thesis has no natural size limit.
 *
 * Two rules the whole file is arranged around:
 *
 *   - **A flag points at a range, or it is not a flag.** Every check maps its model output back to
 *     a ProseMirror range through ids the code assigned. A flag whose id the model invented is
 *     dropped, the same way §10.6 drops an invented citation.
 *   - **The student's decisions survive a re-run.** Reconciliation keeps RESOLVED and IGNORED
 *     flags, and never re-raises one whose fingerprint the student has ignored (ADR-0007).
 */

import {
  buildChapterSummaryRequest,
  buildClaimsRequest,
  buildContradictionRequest,
  buildOutlineDriftRequest,
  buildSupportRequest,
  buildTermDriftRequest,
  buildUnsupportedRequest,
  type ClaimWithPassages,
  COHERENCE,
  claimsSchema,
  contradictionSchema,
  type EmbeddingProvider,
  flagFingerprint,
  type LlmProvider,
  type LlmRequest,
  mightNeedSupport,
  outlineDriftSchema,
  type SupportItem,
  type SupportVerdict,
  supportSchema,
  termDriftSchema,
  unsupportedSchema,
  verbatimQuote,
} from '@tc/ai';
import { computeCallCost } from '@tc/config';
import type { PrismaClient } from '@tc/db';
import {
  type ChapterSentence,
  chunkChapter,
  findCandidates,
  findChapterNeighbours,
  type RawClient,
  replaceChapterChunks,
  sentencesOf,
  shortReference,
} from '@tc/retrieval';
import type { CoherenceRunJob } from '@tc/types';
import { readOutline } from '@tc/types';
import type { ZodType } from 'zod';

export type CoherenceRunDeps = {
  prisma: PrismaClient;
  llm: LlmProvider;
  embeddings: EmbeddingProvider;
  aiProvider: 'anthropic' | 'mock';
  log?: (event: Record<string, unknown>) => void;
  /** Progress for the SSE stream (D.1.1 step 3). */
  onProgress?: (event: { type: string; data: Record<string, unknown> }) => void | Promise<void>;
  now?: () => Date;
};

export type CoherenceRunResult = {
  runId: string;
  chaptersChecked: number;
  chaptersRelated: number;
  flags: number;
  byType: Record<string, number>;
  /** Set when the budget guard reduced the run (D.1.1 step 4). */
  reducedScope: boolean;
  estimatedInr: number;
  skipped?: string;
};

type FlagDraft = {
  chapterId: string;
  from: number;
  to: number;
  type:
    | 'TERM_DRIFT'
    | 'CLAIM_CONTRADICTION'
    | 'UNSUPPORTED_CLAIM'
    | 'CITATION_INTEGRITY'
    | 'OUTLINE_DRIFT'
    | 'CITATION_SUPPORT';
  severity: 'INFO' | 'WARN' | 'ERROR';
  description: string;
  relatedChapterId?: string | null;
  /** The text the fingerprint is taken over — the flagged range as it reads now. */
  flaggedText: string;
};

type ChapterRow = {
  id: string;
  title: string;
  order: number;
  content: unknown;
  scopeNote: string | null;
  updatedAt: Date;
  lastCheckedAt: Date | null;
};

/** §11.2's Strong and Fast unit costs, used only for the pre-flight estimate (D.1.1 step 4). */
const ESTIMATE_INR = { strong: 2.5, fast: 0.3 } as const;

/**
 * Records the run's outcome on the document.
 *
 * The worker owns this, not the SSE endpoint that relays progress: a student who closes the tab
 * must still come back to a finished run. When the API's stream also sees `run-done` it writes the
 * same terminal state, which is idempotent.
 */
async function writeRunState(
  prisma: PrismaClient,
  documentId: string,
  runId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { meta: true },
  });
  const meta = (document?.meta as Record<string, unknown> | null) ?? {};
  const runs = (meta.coherenceRuns as Record<string, Record<string, unknown>> | undefined) ?? {};
  const record = runs[runId];
  if (!record) return;
  await prisma.document.update({
    where: { id: documentId },
    data: {
      meta: {
        ...meta,
        coherenceRuns: { ...runs, [runId]: { ...record, ...patch } },
      },
    } as never,
  });
}

export async function runCoherence(
  job: CoherenceRunJob,
  deps: CoherenceRunDeps,
): Promise<CoherenceRunResult> {
  const log = deps.log ?? (() => undefined);
  const now = deps.now ?? (() => new Date());
  const progress = async (type: string, data: Record<string, unknown> = {}) => {
    await deps.onProgress?.({ type, data });
  };

  const chapters = (await deps.prisma.chapter.findMany({
    where: { documentId: job.documentId },
    orderBy: { order: 'asc' },
    select: {
      id: true,
      title: true,
      order: true,
      content: true,
      scopeNote: true,
      updatedAt: true,
      lastCheckedAt: true,
    },
  })) as ChapterRow[];

  // D.1.1 step 2: changed chapters, or nothing to do.
  const changed = chapters.filter((c) => !c.lastCheckedAt || c.updatedAt > c.lastCheckedAt);
  if (changed.length === 0) {
    await progress('run-done', { totals: { flags: 0 }, skipped: 'nothing changed' });
    await writeRunState(deps.prisma, job.documentId, job.runId, {
      status: 'DONE',
      finishedAt: now().toISOString(),
      totals: {},
      skipped: 'nothing changed',
    });
    return {
      runId: job.runId,
      chaptersChecked: 0,
      chaptersRelated: 0,
      flags: 0,
      byType: {},
      reducedScope: false,
      estimatedInr: 0,
      skipped: 'nothing changed',
    };
  }

  const memory = await deps.prisma.documentMemory.findUnique({
    where: { documentId: job.documentId },
    select: { glossary: true, outline: true },
  });
  const glossary = readGlossary(memory?.glossary);

  const citations = await deps.prisma.citation.findMany({
    where: { chapter: { documentId: job.documentId } },
    select: { chapterId: true, nodeKey: true, sourceId: true },
  });
  const sources = await deps.prisma.source.findMany({
    where: { documentId: job.documentId },
    select: { id: true, title: true, doi: true, isRetracted: true, rawReference: true },
  });

  // D.1.1 step 2: related chapters — two glossary terms or one cited source in common.
  const related = relatedChapters(chapters, changed, glossary, citations);

  // D.1.1 step 4: the budget guard runs before the first call. Every citation in a changed
  // chapter may be one support check (ADR-0023), so the estimate counts them, up to the bound.
  const changedIds = new Set(changed.map((c) => c.id));
  const citedInChanged = citations.filter((c) => changedIds.has(c.chapterId)).length;
  const estimate = estimateRun(
    changed.length,
    Math.min(glossary.size, COHERENCE.maxTerms),
    Math.min(citedInChanged, COHERENCE.maxSupportChecks),
  );
  const reducedScope = estimate > COHERENCE.budgetInr;
  const maxClaims = reducedScope ? COHERENCE.reducedMaxClaims : COHERENCE.maxClaims;
  log({
    msg: 'coherence run planned',
    runId: job.runId,
    changed: changed.length,
    estimate,
    reducedScope,
  });

  // Sentences and positions, once, for every chapter — three checks read them.
  const citationPositions = new Map<string, number[]>();
  const sentences = new Map<string, ChapterSentence[]>();
  for (const chapter of chapters) {
    const positions = citationNodePositions(chapter.content);
    citationPositions.set(chapter.id, positions);
    sentences.set(chapter.id, sentencesOf(chapter.id, chapter.content, positions));
  }

  const drafts: FlagDraft[] = [];
  const counted = { strong: 0, fast: 0 };

  // ---- B1.1: re-chunk and re-embed the changed chapters -------------------------------------
  await progress('check-started', { type: 'INDEX' });
  for (const chapter of changed) {
    const chunks = chunkChapter(chapter.content);
    if (chunks.length === 0) {
      await replaceChapterChunks(deps.prisma as unknown as RawClient, chapter.id, []);
      continue;
    }
    const vectors = await deps.embeddings.embed(chunks.map((c) => c.text));
    await replaceChapterChunks(
      deps.prisma as unknown as RawClient,
      chapter.id,
      chunks.map((chunk, i) => ({
        chapterId: chapter.id,
        ordinal: chunk.ordinal,
        from: chunk.from,
        to: chunk.to,
        text: chunk.text,
        embedding: vectors[i] ?? [],
      })),
    );
  }
  await progress('check-done', { type: 'INDEX', flags: 0 });

  // ---- B1.3: CITATION_INTEGRITY (mechanical, no calls) --------------------------------------
  await progress('check-started', { type: 'CITATION_INTEGRITY' });
  drafts.push(...citationIntegrity(chapters, changed, citations, sources, sentences));
  await progress('check-done', {
    type: 'CITATION_INTEGRITY',
    flags: drafts.filter((d) => d.type === 'CITATION_INTEGRITY').length,
  });

  // ---- B1.4: TERM_DRIFT ----------------------------------------------------------------------
  await progress('check-started', { type: 'TERM_DRIFT' });
  const before = drafts.length;
  for (const { term, definition } of topTerms(glossary, changed, sentences)) {
    const withTerm = allSentencesWithTerm(term, chapters, sentences).slice(
      0,
      COHERENCE.maxSentencesPerTerm,
    );
    if (withTerm.length === 0) continue;
    const byId = new Map(withTerm.map((s) => [s.sentence.id, s]));
    const request = buildTermDriftRequest({
      term,
      definition,
      sentences: withTerm.map((s) => ({
        id: s.sentence.id,
        chapter: s.chapterTitle,
        sentence: s.sentence.text,
      })),
      userId: job.userId,
      documentId: job.documentId,
    });
    const answer = await call(deps, job, request, termDriftSchema, 'strong', counted);
    if (!answer) continue;
    for (const flag of answer.flags) {
      const found = byId.get(flag.sentenceId);
      // The model may only flag a sentence that was sent to it (§10.6's rule, applied here).
      if (!found) continue;
      drafts.push({
        chapterId: found.sentence.chapterId,
        from: found.sentence.from,
        to: found.sentence.to,
        type: 'TERM_DRIFT',
        severity: flag.kind === 'conflict' ? 'ERROR' : 'WARN',
        description: `“${term}”: ${flag.explanation}`,
        flaggedText: found.sentence.text,
      });
    }
  }
  await progress('check-done', { type: 'TERM_DRIFT', flags: drafts.length - before });

  // ---- B1.5: CLAIM_CONTRADICTION -------------------------------------------------------------
  await progress('check-started', { type: 'CLAIM_CONTRADICTION' });
  const beforeClaims = drafts.length;
  for (const chapter of changed) {
    const chapterSentences = sentences.get(chapter.id) ?? [];
    if (chapterSentences.length === 0) continue;

    const claimsAnswer = await call(
      deps,
      job,
      buildClaimsRequest({
        chapterTitle: chapter.title,
        chapterText: chapterSentences.map((s) => s.text).join(' '),
        maxClaims,
        userId: job.userId,
        documentId: job.documentId,
      }),
      claimsSchema,
      'strong',
      counted,
    );
    if (!claimsAnswer || claimsAnswer.claims.length === 0) continue;

    // Each claim is located by matching its text back to a sentence: the model's own spans are
    // offsets into the text it was given, which is not the document's coordinate system.
    const located = claimsAnswer.claims
      .map((claim) => ({ claim, sentence: locate(claim.text, chapterSentences) }))
      .filter(
        (c): c is { claim: (typeof claimsAnswer.claims)[number]; sentence: ChapterSentence } =>
          c.sentence !== null,
      );
    if (located.length === 0) continue;

    const withPassages: ClaimWithPassages[] = [];
    const passageChapter = new Map<string, string>();
    for (const { claim, sentence } of located) {
      const [vector] = await deps.embeddings.embed([claim.text]);
      const neighbours = await findChapterNeighbours(
        deps.prisma as unknown as RawClient,
        job.documentId,
        chapter.id,
        vector ?? [],
        COHERENCE.neighboursPerClaim,
      );
      if (neighbours.length === 0) continue;
      for (const n of neighbours) passageChapter.set(n.chunkId, n.chapterId);
      withPassages.push({
        id: claim.id,
        text: claim.text,
        passages: neighbours.map((n) => ({
          id: n.chunkId,
          chapter: chapters.find((c) => c.id === n.chapterId)?.title ?? 'another chapter',
          text: n.text,
        })),
      });
      void sentence;
    }
    if (withPassages.length === 0) continue;

    const contradictions = await call(
      deps,
      job,
      buildContradictionRequest({
        claims: withPassages,
        userId: job.userId,
        documentId: job.documentId,
      }),
      contradictionSchema,
      'strong',
      counted,
    );
    if (!contradictions) continue;

    const claimById = new Map(located.map((c) => [c.claim.id, c.sentence]));
    for (const flag of contradictions.flags) {
      const sentence = claimById.get(flag.claimId);
      const relatedChapterId = passageChapter.get(flag.passageId);
      if (!sentence || !relatedChapterId) continue;
      const other = chapters.find((c) => c.id === relatedChapterId);
      drafts.push({
        chapterId: chapter.id,
        from: sentence.from,
        to: sentence.to,
        type: 'CLAIM_CONTRADICTION',
        severity: flag.severity,
        description: `${flag.explanation}${other ? ` (against ${other.title})` : ''}`,
        relatedChapterId,
        flaggedText: sentence.text,
      });
    }
  }
  await progress('check-done', {
    type: 'CLAIM_CONTRADICTION',
    flags: drafts.length - beforeClaims,
  });

  // ---- B1.6: UNSUPPORTED_CLAIM ---------------------------------------------------------------
  await progress('check-started', { type: 'UNSUPPORTED_CLAIM' });
  const beforeUnsupported = drafts.length;
  const outline = readOutline(memory?.outline);
  for (const chapter of changed) {
    const role = chapterRole(chapter, outline);
    const candidates = (sentences.get(chapter.id) ?? []).filter(mightNeedSupport);
    if (candidates.length === 0) continue;

    // "≤ 2 per changed chapter" (D.1.2): two batches of 40, and the rest waits for the next run.
    for (const batch of chunksOf(candidates, COHERENCE.unsupportedBatch).slice(0, 2)) {
      const byId = new Map(batch.map((s) => [s.id, s]));
      const answer = await call(
        deps,
        job,
        buildUnsupportedRequestFor(batch, role, job),
        unsupportedSchema,
        'fast',
        counted,
      );
      if (!answer) continue;
      for (const result of answer.results) {
        if (!result.needsSupport) continue;
        const sentence = byId.get(result.sentenceId);
        if (!sentence) continue;
        drafts.push({
          chapterId: chapter.id,
          from: sentence.from,
          to: sentence.to,
          type: 'UNSUPPORTED_CLAIM',
          // D.1.2: an Introduction states the field's background; the same sentence there is a
          // note rather than a warning.
          severity: role === 'Introduction' ? 'INFO' : 'WARN',
          description: result.why
            ? `No citation, and this ${result.why}.`
            : 'This states something an examiner would expect a citation for.',
          flaggedText: sentence.text,
        });
      }
    }
  }
  await progress('check-done', {
    type: 'UNSUPPORTED_CLAIM',
    flags: drafts.length - beforeUnsupported,
  });

  // ---- ADR-0023: CITATION_SUPPORT -------------------------------------------------------------
  await progress('check-started', { type: 'CITATION_SUPPORT' });
  const beforeSupport = drafts.length;
  drafts.push(
    ...(await citationSupport(deps, job, changed, sentences, counted, log, {
      // Under D.1.1's reduced scope, half as many: the check is cheap, but not free.
      max: reducedScope ? COHERENCE.maxSupportChecks / 2 : COHERENCE.maxSupportChecks,
    })),
  );
  await progress('check-done', {
    type: 'CITATION_SUPPORT',
    flags: drafts.length - beforeSupport,
  });

  // ---- B1.7: OUTLINE_DRIFT -------------------------------------------------------------------
  await progress('check-started', { type: 'OUTLINE_DRIFT' });
  const beforeOutline = drafts.length;
  for (const chapter of changed) {
    const scopeNote = (chapter.scopeNote ?? '').trim();
    const chapterSentences = sentences.get(chapter.id) ?? [];
    if (!scopeNote || chapterSentences.length === 0) continue;

    const summary = await callText(
      deps,
      job,
      buildChapterSummaryRequest({
        chapterTitle: chapter.title,
        chapterText: chapterSentences.map((s) => s.text).join(' '),
        userId: job.userId,
        documentId: job.documentId,
      }),
      'fast',
      counted,
    );
    if (!summary) continue;

    const answer = await call(
      deps,
      job,
      buildOutlineDriftRequest({
        scopeNote,
        summary,
        userId: job.userId,
        documentId: job.documentId,
      }),
      outlineDriftSchema,
      'strong',
      counted,
    );
    if (!answer) continue;

    const end = chapterSentences[chapterSentences.length - 1]?.to ?? 0;
    for (const missing of answer.missing) {
      drafts.push({
        chapterId: chapter.id,
        from: 0,
        to: end,
        type: 'OUTLINE_DRIFT',
        severity: 'WARN',
        description: `The scope note promises “${missing}”, which this chapter does not cover yet.`,
        flaggedText: `missing:${missing}`,
      });
    }
    for (const extra of answer.extra) {
      drafts.push({
        chapterId: chapter.id,
        from: 0,
        to: end,
        type: 'OUTLINE_DRIFT',
        severity: 'WARN',
        description: `This chapter covers “${extra}”, which its scope note does not mention. Move it, or widen the scope note.`,
        flaggedText: `extra:${extra}`,
      });
    }
  }
  await progress('check-done', { type: 'OUTLINE_DRIFT', flags: drafts.length - beforeOutline });

  // ---- Reconcile (D.1.1 step 2, last bullet) -------------------------------------------------
  const written = await reconcile(deps.prisma, job, changed, drafts);

  await deps.prisma.chapter.updateMany({
    where: { id: { in: changed.map((c) => c.id) } },
    data: { lastCheckedAt: now() },
  });

  const byType: Record<string, number> = {};
  for (const draft of drafts) byType[draft.type] = (byType[draft.type] ?? 0) + 1;

  const result: CoherenceRunResult = {
    runId: job.runId,
    chaptersChecked: changed.length,
    chaptersRelated: related.size,
    flags: written,
    byType,
    reducedScope,
    estimatedInr: estimate,
  };
  await writeRunState(deps.prisma, job.documentId, job.runId, {
    status: 'DONE',
    finishedAt: now().toISOString(),
    totals: byType,
    reducedScope,
  });
  await progress('run-done', { totals: result });
  log({ msg: 'coherence run done', ...result, calls: counted });
  return result;
}

// ---------------------------------------------------------------------------------------------
// Checks that need no model
// ---------------------------------------------------------------------------------------------

/** D.1.2's CITATION_INTEGRITY row, in full. */
function citationIntegrity(
  chapters: readonly ChapterRow[],
  changed: readonly ChapterRow[],
  citations: ReadonlyArray<{ chapterId: string; nodeKey: string; sourceId: string }>,
  sources: ReadonlyArray<{
    id: string;
    title: string | null;
    doi: string | null;
    isRetracted: boolean;
    rawReference: string | null;
  }>,
  sentences: Map<string, ChapterSentence[]>,
): FlagDraft[] {
  const out: FlagDraft[] = [];
  const byId = new Map(sources.map((s) => [s.id, s]));
  const cited = new Set(citations.map((c) => c.sourceId));

  for (const chapter of changed) {
    // Orphans and retracted sources, from the nodes themselves.
    for (const node of citationNodesOf(chapter.content)) {
      const source = node.sourceId ? byId.get(node.sourceId) : undefined;
      if (!source) {
        out.push({
          chapterId: chapter.id,
          from: node.from,
          to: node.to,
          type: 'CITATION_INTEGRITY',
          severity: 'WARN',
          description: node.sourceId
            ? 'This citation points at a source that is no longer in your library.'
            : 'This citation has no source attached.',
          flaggedText: `orphan:${node.key}`,
        });
        continue;
      }
      if (source.isRetracted) {
        out.push({
          chapterId: chapter.id,
          from: node.from,
          to: node.to,
          type: 'CITATION_INTEGRITY',
          severity: 'ERROR',
          description: `“${source.title ?? 'This source'}” is marked retracted. Cite something else, or say explicitly that it was retracted.`,
          flaggedText: `retracted:${node.key}`,
        });
      }
    }

    // Citation-like strings the student typed (D.1.2's two regexes).
    for (const sentence of sentences.get(chapter.id) ?? []) {
      for (const re of [/\(([A-Z][a-z]+)(?: et al\.)?,? \d{4}\)/g, /\[\d+\]/g]) {
        re.lastIndex = 0;
        let match: RegExpExecArray | null = re.exec(sentence.text);
        while (match) {
          out.push({
            chapterId: chapter.id,
            from: sentence.from + match.index,
            to: sentence.from + match.index + match[0].length,
            type: 'CITATION_INTEGRITY',
            severity: 'WARN',
            description: `“${match[0]}” is plain text, not a citation. It will not appear in the bibliography and will not follow a style switch.`,
            flaggedText: `untagged:${match[0]}`,
          });
          match = re.exec(sentence.text);
        }
      }
    }
  }

  // Document-wide: unused sources and duplicate DOIs, reported against the first changed chapter
  // so the sidebar has somewhere to put them.
  const home = changed[0];
  if (home) {
    for (const source of sources) {
      if (cited.has(source.id)) continue;
      out.push({
        chapterId: home.id,
        from: 0,
        to: 0,
        type: 'CITATION_INTEGRITY',
        severity: 'INFO',
        description: `“${source.title ?? source.rawReference ?? 'A source'}” is in your library but nothing cites it.`,
        flaggedText: `unused:${source.id}`,
      });
    }
    const byDoi = new Map<string, string[]>();
    for (const source of sources) {
      if (!source.doi) continue;
      const key = source.doi.toLowerCase();
      byDoi.set(key, [...(byDoi.get(key) ?? []), source.id]);
    }
    for (const [doi, ids] of byDoi) {
      if (ids.length < 2) continue;
      out.push({
        chapterId: home.id,
        from: 0,
        to: 0,
        type: 'CITATION_INTEGRITY',
        severity: 'WARN',
        description: `${ids.length} sources in your library share the DOI ${doi}. Remove the duplicates so the bibliography lists it once.`,
        flaggedText: `duplicate:${doi}`,
      });
    }
  }
  void chapters;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

type GlossaryEntry = { definition: string };

function readGlossary(value: unknown): Map<string, GlossaryEntry> {
  const out = new Map<string, GlossaryEntry>();
  if (!value || typeof value !== 'object') return out;
  for (const [term, entry] of Object.entries(value as Record<string, unknown>)) {
    const definition =
      entry &&
      typeof entry === 'object' &&
      typeof (entry as { definition?: unknown }).definition === 'string'
        ? (entry as { definition: string }).definition
        : typeof entry === 'string'
          ? entry
          : '';
    if (term.trim() && definition.trim()) out.set(term.trim(), { definition: definition.trim() });
  }
  return out;
}

type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: Node[] };

type CitationNode = {
  key: string;
  sourceId: string | null;
  /** The passage the citation was made from, when Assist or Draft made it (ADR-0023). */
  chunkId: string | null;
  from: number;
  to: number;
};

/** Citation nodes with ProseMirror positions — the same walk `@tc/citations` uses. */
function citationNodesOf(doc: unknown): CitationNode[] {
  const out: CitationNode[] = [];
  const walk = (node: Node | undefined, pos: number): number => {
    if (!node) return pos;
    if (node.type === 'text') return pos + (node.text?.length ?? 0);
    if (node.type === 'citation') {
      out.push({
        key: String(node.attrs?.key ?? ''),
        sourceId: (node.attrs?.sourceId as string | null) ?? null,
        chunkId: (node.attrs?.chunkId as string | null) ?? null,
        from: pos,
        to: pos + 1,
      });
      return pos + 1;
    }
    let inner = pos + 1;
    for (const child of node.content ?? []) inner = walk(child, inner);
    return inner + 1;
  };
  let pos = 0;
  for (const child of (doc as Node | undefined)?.content ?? []) pos = walk(child, pos);
  return out;
}

const citationNodePositions = (doc: unknown): number[] => citationNodesOf(doc).map((n) => n.from);

/** D.1.1: "chapters that share ≥ 2 glossary terms or ≥ 1 cited source with any changed chapter". */
function relatedChapters(
  chapters: readonly ChapterRow[],
  changed: readonly ChapterRow[],
  glossary: Map<string, GlossaryEntry>,
  citations: ReadonlyArray<{ chapterId: string; sourceId: string }>,
): Set<string> {
  const changedIds = new Set(changed.map((c) => c.id));
  const terms = [...glossary.keys()].map((t) => t.toLowerCase());
  const textOf = new Map(chapters.map((c) => [c.id, plainText(c.content).toLowerCase()]));
  const changedTerms = new Set<string>();
  for (const chapter of changed) {
    const text = textOf.get(chapter.id) ?? '';
    for (const term of terms) if (text.includes(term)) changedTerms.add(term);
  }
  const changedSources = new Set(
    citations.filter((c) => changedIds.has(c.chapterId)).map((c) => c.sourceId),
  );

  const related = new Set<string>();
  for (const chapter of chapters) {
    if (changedIds.has(chapter.id)) continue;
    const text = textOf.get(chapter.id) ?? '';
    const shared = [...changedTerms].filter((t) => text.includes(t)).length;
    const sharesSource = citations.some(
      (c) => c.chapterId === chapter.id && changedSources.has(c.sourceId),
    );
    if (shared >= 2 || sharesSource) related.add(chapter.id);
  }
  return related;
}

function plainText(doc: unknown): string {
  const parts: string[] = [];
  const walk = (node: Node | undefined) => {
    if (!node) return;
    if (node.type === 'text' && node.text) parts.push(node.text);
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc as Node);
  return parts.join(' ');
}

/** D.1.2: at most 12 terms, "prioritised by frequency" in the changed chapters. */
function topTerms(
  glossary: Map<string, GlossaryEntry>,
  changed: readonly ChapterRow[],
  sentences: Map<string, ChapterSentence[]>,
): Array<{ term: string; definition: string; count: number }> {
  const counts: Array<{ term: string; definition: string; count: number }> = [];
  for (const [term, entry] of glossary) {
    const re = termRegex(term);
    let count = 0;
    for (const chapter of changed) {
      for (const sentence of sentences.get(chapter.id) ?? []) {
        if (re.test(sentence.text)) count += 1;
      }
    }
    if (count > 0) counts.push({ term, definition: entry.definition, count });
  }
  return counts.sort((a, b) => b.count - a.count).slice(0, COHERENCE.maxTerms);
}

/** Case-insensitive, with the simple plural and possessive variants D.1.2 asks for. */
function termRegex(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}(?:s|es|'s|’s)?\\b`, 'i');
}

function allSentencesWithTerm(
  term: string,
  chapters: readonly ChapterRow[],
  sentences: Map<string, ChapterSentence[]>,
): Array<{ sentence: ChapterSentence; chapterTitle: string }> {
  const re = termRegex(term);
  const out: Array<{ sentence: ChapterSentence; chapterTitle: string }> = [];
  for (const chapter of chapters) {
    for (const sentence of sentences.get(chapter.id) ?? []) {
      if (re.test(sentence.text)) out.push({ sentence, chapterTitle: chapter.title });
    }
  }
  return out;
}

/** The chapter's role from the outline, for A.12.3's exemptions. */
function chapterRole(chapter: ChapterRow, outline: ReturnType<typeof readOutline>): string {
  const node = outline.find((n) => n.title === chapter.title);
  const role = (node as { role?: string } | undefined)?.role;
  if (typeof role === 'string' && role) return role;
  const title = chapter.title.toLowerCase();
  if (title.includes('introduction')) return 'Introduction';
  if (title.includes('result')) return 'Results';
  if (title.includes('conclusion')) return 'Conclusion';
  if (title.includes('method')) return 'Methodology';
  if (title.includes('literature') || title.includes('review')) return 'Literature review';
  return 'Body';
}

/** Matches a model-returned claim back to the sentence it came from. */
function locate(claim: string, sentences: readonly ChapterSentence[]): ChapterSentence | null {
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const target = norm(claim);
  if (!target) return null;
  const exact = sentences.find((s) => norm(s.text) === target);
  if (exact) return exact;
  const contains = sentences.find(
    (s) => norm(s.text).includes(target) || target.includes(norm(s.text)),
  );
  return contains ?? null;
}

/**
 * ADR-0023: does the passage a sentence cites say what the sentence says it does?
 *
 * Every cited sentence in a changed chapter goes to the model with the passages its citations
 * point at — the chunk the citation was made from when Assist or Draft made it, otherwise the
 * source's chunks nearest the sentence. A source with no text cannot be checked and is skipped;
 * judging a citation against nothing would be a guess. Only the verdicts that need the student
 * are flags, and a quote is shown only if it is the passage's own words (`verbatimQuote`).
 */
async function citationSupport(
  deps: CoherenceRunDeps,
  job: CoherenceRunJob,
  changed: readonly ChapterRow[],
  sentences: ReadonlyMap<string, ChapterSentence[]>,
  counted: { fast: number; strong: number },
  log: (event: Record<string, unknown>) => void,
  limits: { max: number },
): Promise<FlagDraft[]> {
  type Cited = {
    chapterId: string;
    at: ChapterSentence;
    citations: Array<{ sourceId: string; chunkId: string | null }>;
  };
  const cited: Cited[] = [];
  for (const chapter of changed) {
    const nodes = citationNodesOf(chapter.content).filter((node) => node.sourceId);
    for (const at of sentences.get(chapter.id) ?? []) {
      if (!at.hasCitation) continue;
      const inside = nodes.filter((node) => node.from >= at.from && node.from < at.to);
      if (inside.length === 0) continue;
      cited.push({
        chapterId: chapter.id,
        at,
        citations: inside.map((node) => ({
          sourceId: node.sourceId as string,
          chunkId: node.chunkId,
        })),
      });
    }
  }
  const toCheck = cited.slice(0, limits.max);
  if (toCheck.length === 0) return [];

  const chunkIds = [
    ...new Set(toCheck.flatMap((c) => c.citations.map((x) => x.chunkId).filter(Boolean))),
  ] as string[];
  const [chunkRows, sourceRows] = await Promise.all([
    chunkIds.length > 0
      ? deps.prisma.sourceChunk.findMany({
          where: { id: { in: chunkIds } },
          select: { id: true, sourceId: true, text: true, page: true },
        })
      : Promise.resolve([]),
    deps.prisma.source.findMany({
      where: {
        documentId: job.documentId,
        id: { in: [...new Set(toCheck.flatMap((c) => c.citations.map((x) => x.sourceId)))] },
      },
      select: { id: true, authors: true, year: true, title: true },
    }),
  ]);
  const chunkById = new Map(chunkRows.map((row) => [row.id, row]));
  const shortRefOf = new Map(
    sourceRows.map((s) => [s.id, shortReference(s.authors, s.year, s.title) ?? 'Source']),
  );
  const ownChunk = (citation: Cited['citations'][number]) => {
    const row = citation.chunkId ? chunkById.get(citation.chunkId) : undefined;
    return row && row.sourceId === citation.sourceId ? row : undefined;
  };

  // One embedding call for every sentence that needs its passages found rather than read.
  const needNearest = toCheck.filter((c) => c.citations.some((x) => !ownChunk(x)));
  const vectors =
    needNearest.length > 0 ? await deps.embeddings.embed(needNearest.map((c) => c.at.text)) : [];
  const vectorOf = new Map(needNearest.map((c, i) => [c.at.id, vectors[i]]));

  const items: Array<SupportItem & { chapterId: string; at: ChapterSentence }> = [];
  let unreadable = 0;
  for (const c of toCheck) {
    const passages: SupportItem['passages'][number][] = [];
    for (const citation of c.citations) {
      // A source removed from the library is CITATION_INTEGRITY's to report, not this check's.
      const shortRef = shortRefOf.get(citation.sourceId);
      if (!shortRef) continue;
      const own = ownChunk(citation);
      if (own) {
        passages.push({ shortRef, page: own.page, text: own.text });
        continue;
      }
      const vector = vectorOf.get(c.at.id);
      if (!vector) continue;
      const nearest = await findCandidates(deps.prisma as unknown as RawClient, vector, {
        documentId: job.documentId,
        pinnedSourceIds: [citation.sourceId],
        limit: COHERENCE.passagesPerCitation,
      });
      passages.push(...nearest.map((n) => ({ shortRef, page: n.page, text: n.text })));
    }
    if (passages.length === 0) {
      unreadable += 1;
      continue;
    }
    items.push({
      sentenceId: c.at.id,
      sentence: c.at.text,
      passages,
      chapterId: c.chapterId,
      at: c.at,
    });
  }

  const out: FlagDraft[] = [];
  for (const batch of chunksOf(items, COHERENCE.supportBatch)) {
    const answer = await call(
      deps,
      job,
      buildSupportRequest({ items: batch, userId: job.userId, documentId: job.documentId }),
      supportSchema,
      'fast',
      counted,
    );
    if (!answer) continue;
    const byId = new Map(batch.map((item) => [item.sentenceId, item]));
    for (const result of answer.results) {
      const item = byId.get(result.sentenceId);
      // A verdict about a sentence we did not send is dropped, like an invented citation.
      if (!item || result.verdict === 'SUPPORTED') continue;
      const quote = verbatimQuote(result.quote, item.passages);
      out.push({
        chapterId: item.chapterId,
        from: item.at.from,
        to: item.at.to,
        type: 'CITATION_SUPPORT',
        ...supportFlagText(result.verdict, result.why, quote),
        flaggedText: item.at.text,
      });
    }
  }
  log({
    msg: 'citation support checked',
    runId: job.runId,
    checked: items.length,
    unreadable,
    waiting: cited.length - toCheck.length,
  });
  return out;
}

/**
 * How each verdict reads, and how loud it is. A misrepresentation with the passage's own words to
 * show for it is an error; without them it is a warning, because the student has only the
 * model's word for it.
 */
export function supportFlagText(
  verdict: Exclude<SupportVerdict, 'SUPPORTED'>,
  why: string,
  quote: string | null,
): { severity: 'INFO' | 'WARN' | 'ERROR'; description: string } {
  const reason = why.trim().slice(0, 300);
  const because = reason ? ` ${reason.replace(/\.?$/, '.')}` : '';
  const says = quote ? ` The source says: “${quote}”` : '';
  switch (verdict) {
    case 'MISREPRESENTED':
      return {
        severity: quote ? 'ERROR' : 'WARN',
        description: `The cited passage says something different.${because}${says}`,
      };
    case 'OVERSTATED':
      return {
        severity: 'WARN',
        description: `This says more than the cited passage does.${because}${says}`,
      };
    case 'WEAKLY_SUPPORTED':
      return {
        severity: 'INFO',
        description: `The cited passage is on this subject but does not say this.${because}${says}`,
      };
    case 'NOT_IN_PASSAGE':
      return {
        severity: 'INFO',
        description: `The cited passage does not address this. The paper may say it elsewhere — check before relying on it.${because}`,
      };
  }
}

function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** D.1.1 step 4's estimate, from §11.2's unit costs. */
export function estimateRun(changedChapters: number, terms: number, citedSentences = 0): number {
  const strong = terms + changedChapters * 3; // term drift, two claim steps, outline drift
  // Two unsupported batches and the summary per chapter, and the support checks (ADR-0023).
  const fast = changedChapters * 3 + Math.ceil(citedSentences / COHERENCE.supportBatch);
  return Number((strong * ESTIMATE_INR.strong + fast * ESTIMATE_INR.fast).toFixed(2));
}

function buildUnsupportedRequestFor(
  batch: readonly ChapterSentence[],
  role: string,
  job: CoherenceRunJob,
) {
  return buildUnsupportedRequest({
    sentences: batch.map((s) => ({ id: s.id, text: s.text })),
    chapterRole: role,
    userId: job.userId,
    documentId: job.documentId,
  });
}

/** One structured call, logged, returning null when the provider or the schema refused. */
async function call<T>(
  deps: CoherenceRunDeps,
  job: CoherenceRunJob,
  request: Omit<LlmRequest, 'schema'>,
  schema: ZodType<T>,
  tier: 'fast' | 'strong',
  counted: { fast: number; strong: number },
): Promise<T | null> {
  const startedAt = Date.now();
  try {
    const answer = await deps.llm.complete({ ...request, schema });
    counted[tier] += 1;
    await logCall(deps, job, tier, answer.modelId, answer.usage, Date.now() - startedAt, true);
    return answer.value;
  } catch (error) {
    await logCall(
      deps,
      job,
      tier,
      deps.llm.modelIdFor(tier),
      null,
      Date.now() - startedAt,
      false,
      error,
    );
    deps.log?.({ level: 40, msg: 'coherence call failed', error: String(error) });
    return null;
  }
}

/** The one call that wants prose rather than JSON (A.12.4's summary). */
async function callText(
  deps: CoherenceRunDeps,
  job: CoherenceRunJob,
  request: Omit<LlmRequest, 'schema'>,
  tier: 'fast' | 'strong',
  counted: { fast: number; strong: number },
): Promise<string | null> {
  const startedAt = Date.now();
  let text = '';
  let modelId = deps.llm.modelIdFor(tier);
  let usage: {
    inputTokens: number;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
    outputTokens: number;
  } | null = null;
  try {
    for await (const chunk of deps.llm.stream(request)) {
      if (chunk.type === 'text') text += chunk.text;
      else {
        usage = chunk.usage;
        modelId = chunk.modelId;
      }
    }
  } catch (error) {
    await logCall(deps, job, tier, modelId, null, Date.now() - startedAt, false, error);
    return null;
  }
  counted[tier] += 1;
  await logCall(deps, job, tier, modelId, usage, Date.now() - startedAt, true);
  return text.trim() || null;
}

async function logCall(
  deps: CoherenceRunDeps,
  job: CoherenceRunJob,
  tier: 'fast' | 'strong',
  model: string,
  usage: {
    inputTokens: number;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
    outputTokens: number;
  } | null,
  latencyMs: number,
  ok: boolean,
  error?: unknown,
): Promise<void> {
  const cost =
    ok && usage && deps.aiProvider !== 'mock'
      ? computeCallCost({ tier, modelId: model, usage })
      : 0;
  await deps.prisma.aiCallLog.create({
    data: {
      userId: job.userId,
      documentId: job.documentId,
      action: 'COHERENCE',
      model,
      inputTokens: usage?.inputTokens ?? 0,
      cachedInputTokens: usage?.cachedInputTokens ?? 0,
      cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      costMicroInr: BigInt(cost),
      latencyMs,
      ok,
      error: ok ? null : String(error instanceof Error ? error.message : error).slice(0, 500),
    },
  });
}

/**
 * D.1.1's reconciliation, and the reason ADR-0007 exists.
 *
 * Within the changed chapters: an OPEN flag whose fingerprint this run did not reproduce is gone
 * (the student fixed it, or the text moved on); RESOLVED and IGNORED flags stay as a record of
 * what was decided; and a candidate whose fingerprint matches an IGNORED flag is never raised
 * again.
 */
async function reconcile(
  prisma: PrismaClient,
  job: CoherenceRunJob,
  changed: readonly ChapterRow[],
  drafts: readonly FlagDraft[],
): Promise<number> {
  const chapterIds = changed.map((c) => c.id);
  const withFingerprints = drafts.map((draft) => ({
    ...draft,
    fingerprint: flagFingerprint(draft.type, draft.chapterId, draft.flaggedText),
  }));

  const existing = await prisma.coherenceFlag.findMany({
    where: { documentId: job.documentId, chapterId: { in: chapterIds } },
    select: { id: true, status: true, fingerprint: true },
  });
  const ignored = new Set(existing.filter((f) => f.status === 'IGNORED').map((f) => f.fingerprint));
  const reproduced = new Set(withFingerprints.map((d) => d.fingerprint));

  // Gone: OPEN flags this run did not find again.
  const stale = existing
    .filter((f) => f.status === 'OPEN' && !reproduced.has(f.fingerprint))
    .map((f) => f.id);
  if (stale.length > 0) {
    await prisma.coherenceFlag.deleteMany({ where: { id: { in: stale } } });
  }

  // Already on screen: an OPEN flag with the same fingerprint is the same problem, so it keeps its
  // id (and the student's scroll position) rather than being deleted and re-created.
  const openFingerprints = new Set(
    existing.filter((f) => f.status === 'OPEN').map((f) => f.fingerprint),
  );

  let written = 0;
  for (const draft of withFingerprints) {
    if (ignored.has(draft.fingerprint) || openFingerprints.has(draft.fingerprint)) continue;
    await prisma.coherenceFlag.create({
      data: {
        documentId: job.documentId,
        chapterId: draft.chapterId,
        from: draft.from,
        to: draft.to,
        type: draft.type,
        severity: draft.severity,
        description: draft.description,
        fingerprint: draft.fingerprint,
        runId: job.runId,
        ...(draft.relatedChapterId ? { relatedChapterId: draft.relatedChapterId } : {}),
      },
    });
    written += 1;
  }
  return written;
}
