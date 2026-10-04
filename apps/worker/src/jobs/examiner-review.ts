/**
 * `examiner-review` — ADR-0056. A strict examiner reads a chapter the student wrote, one section
 * at a time, against the passages its citations point at; every issue becomes an `EXAMINER` flag
 * pinned to its sentence, in the same Flags tab as the coherence run's.
 *
 * The examiner is the chapter build's (ADR-0039): the same evaluated prompt (`examiner.md`), the
 * same request builder and post-processing, the same discipline profile, terminology sheet and
 * pitfall bank. What is new is the input — the student's own saved text, read by
 * `reviewChapter`, with any pending AI draft left out (FR-4.10).
 *
 * The rules the rest of the worker keeps:
 *
 * - **No model call without a time limit.** Every call carries `AbortSignal.timeout`, and a
 *   section whose call fails or times out is reported, not fatal: the others still land.
 * - **The worker owns the terminal state.** The run's record in `Document.meta.examinerReviews`
 *   ends DONE or FAILED here, whatever happens, and the job never throws — a BullMQ retry would
 *   pay for every section again.
 * - **A unit buys a review.** It is given back when no section could be reviewed at all.
 * - **Flags are flags.** Nothing here edits the chapter; the student resolves or ignores each one,
 *   and an ignored issue is not raised again on the same sentence (ADR-0007's fingerprint).
 */

import {
  buildExaminerReviewRequest,
  EXAMINER_REVIEW,
  type ExaminerIssue,
  examinerSchema,
  flagFingerprint,
  type LlmProvider,
  postProcessExaminer,
  type ReviewCitation,
  type ReviewPassage,
  reviewChapter,
  sectionInput,
} from '@tc/ai';
import { disciplineProfile, PARADIGMS, suggestDiscipline } from '@tc/config';
import type { PrismaClient } from '@tc/db';
import {
  chapterProfileSchema,
  type ExaminerReviewJob,
  type ExaminerReviewRecord,
  readThesisDetails,
} from '@tc/types';

type Usage = {
  inputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  outputTokens: number;
};

export type ReviewCallLog = {
  userId: string;
  documentId: string;
  modelId: string;
  usage: Usage | null;
  latencyMs: number;
  ok: boolean;
  error?: string;
};

export type ExaminerReviewDeps = {
  prisma: PrismaClient;
  llm: LlmProvider;
  /** Writes the `AiCallLog` row (action `EXAMINER_REVIEW`) and returns its cost in micro-INR. */
  logCall: (call: ReviewCallLog) => Promise<number>;
  /** Gives the `EXAMINER_REVIEW` unit back (a review that reviewed nothing). */
  refund: (userId: string) => Promise<void>;
  /** The site-wide budget (ADR-0037's guard); throws when reached. */
  assertBudget?: () => Promise<void>;
  /** Defaults to `EXAMINER_REVIEW.callTimeoutMs`; tests pass a short one. */
  callTimeoutMs?: number;
  now?: () => Date;
  log?: (event: Record<string, unknown>) => void;
};

export type ExaminerReviewResult = {
  runId: string;
  status: 'DONE' | 'FAILED' | 'SKIPPED';
  sections: number;
  sectionsReviewed: number;
  failedSections: string[];
  issues: number;
  blocking: number;
  flagsWritten: number;
  spentInr: number;
  /** True when this run gave the `EXAMINER_REVIEW` unit back (the refund statement succeeded). */
  refunded?: boolean;
};

/** The chapter's examiner review records, keyed by chapter id, on the document's meta. */
export function examinerReviews(meta: unknown): Record<string, ExaminerReviewRecord> {
  const value = (meta as { examinerReviews?: unknown } | null)?.examinerReviews;
  return value && typeof value === 'object' ? (value as Record<string, ExaminerReviewRecord>) : {};
}

/**
 * Patches this run's record, and only if the record is still this run's: a newer review of the
 * same chapter owns the record from the moment the API wrote it.
 */
async function writeState(
  prisma: PrismaClient,
  job: ExaminerReviewJob,
  patch: Partial<ExaminerReviewRecord>,
): Promise<void> {
  const document = await prisma.document.findUnique({
    where: { id: job.documentId },
    select: { meta: true },
  });
  const meta = (document?.meta as Record<string, unknown> | null) ?? {};
  const reviews = examinerReviews(meta);
  const record = reviews[job.chapterId];
  if (record?.runId !== job.runId) return;
  await prisma.document.update({
    where: { id: job.documentId },
    data: {
      meta: {
        ...meta,
        examinerReviews: { ...reviews, [job.chapterId]: { ...record, ...patch } },
      },
    } as never,
  });
}

/** Runs `task` over `items`, at most `limit` at once, in order of the results. */
async function pool<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}

type FlagDraft = {
  from: number;
  to: number;
  severity: 'ERROR' | 'WARN';
  description: string;
  suggestion: string | null;
  fingerprint: string;
};

export async function runExaminerReview(
  job: ExaminerReviewJob,
  deps: ExaminerReviewDeps,
): Promise<ExaminerReviewResult> {
  const log = deps.log ?? (() => undefined);
  const now = deps.now ?? (() => new Date());
  const prisma = deps.prisma;
  const timeoutMs = deps.callTimeoutMs ?? EXAMINER_REVIEW.callTimeoutMs;
  let spentMicro = 0;
  const empty = {
    runId: job.runId,
    sections: 0,
    sectionsReviewed: 0,
    failedSections: [] as string[],
    issues: 0,
    blocking: 0,
    flagsWritten: 0,
  };

  // Only the run the API recorded, and only once: a retried or superseded job does nothing.
  const document = await prisma.document.findFirst({
    where: { id: job.documentId, ownerId: job.userId },
    select: { id: true, title: true, field: true, meta: true },
  });
  const record = document ? examinerReviews(document.meta)[job.chapterId] : undefined;
  if (
    !document ||
    record?.runId !== job.runId ||
    record.status === 'DONE' ||
    record.status === 'FAILED'
  ) {
    log({ msg: 'examiner review skipped', runId: job.runId, recorded: record?.status ?? null });
    return { ...empty, status: 'SKIPPED', spentInr: 0 };
  }

  const fail = async (error: string, refund: boolean): Promise<ExaminerReviewResult> => {
    await writeState(prisma, job, { status: 'FAILED', finishedAt: now().toISOString(), error });
    const refunded =
      refund &&
      (await deps.refund(job.userId).then(
        () => true,
        () => false,
      ));
    log({ msg: 'examiner review failed', runId: job.runId, error, refunded });
    return { ...empty, status: 'FAILED', spentInr: spentMicro / 1e6, refunded };
  };

  try {
    await writeState(prisma, job, { status: 'RUNNING' });
    await deps.assertBudget?.();

    const chapter = await prisma.chapter.findFirst({
      where: { id: job.chapterId, documentId: job.documentId },
      select: { id: true, title: true, scopeNote: true, content: true, version: true },
    });
    if (!chapter) return fail('The chapter no longer exists.', true);

    const review = reviewChapter(chapter.content, chapter.title);
    const sentenceCount = review.sections.reduce((n, s) => n + s.sentences.length, 0);
    if (sentenceCount < EXAMINER_REVIEW.minSentences) {
      return fail('There is not enough of your own text in this chapter to review yet.', true);
    }

    // The discipline the build would use: the student's saved profile, else one suggested from
    // the thesis's field and title.
    const meta = (document.meta as Record<string, unknown> | null) ?? {};
    const saved = chapterProfileSchema.safeParse(meta.chapterProfile);
    const discipline = saved.success
      ? disciplineProfile(saved.data.disciplineId)
      : (suggestDiscipline(document.field, document.title) ?? disciplineProfile(null));
    const paradigm =
      saved.success && (PARADIGMS as readonly string[]).includes(saved.data.paradigm)
        ? saved.data.paradigm
        : (discipline.defaultParadigms[0] ?? 'experimental');
    const degree = readThesisDetails(meta.thesisDetails).degree || 'thesis';

    const pitfallRows = await prisma.pitfall.findMany({
      where: { status: 'APPROVED', profile: { in: [discipline.id, '*'] } },
      select: { code: true, wrongPattern: true, correctStatement: true },
    });
    const pitfalls = pitfallRows.map((p) => ({
      code: p.code,
      wrong: p.wrongPattern,
      correct: p.correctStatement,
    }));

    const passageFor = await loadPassages(prisma, job.documentId, review.citations);

    const sections = review.sections.map((section, index) => ({
      section,
      index,
      input: sectionInput(section, review.citations, passageFor),
    }));

    const outcomes = await pool(sections, EXAMINER_REVIEW.concurrency, async (item) => {
      const { section, input } = item;
      const request = buildExaminerReviewRequest({
        discipline,
        paradigm,
        degree,
        section: {
          id: `sec${item.index + 1}`,
          title: section.title,
          purpose: chapter.scopeNote ?? '',
          isSummary: section.isSummary,
        },
        sentences: input.sentences.map(({ id, text }) => ({ id, text })),
        entities: [],
        passages: input.passages,
        terminology: discipline.terminology,
        pitfalls,
        ...(section.isSummary
          ? {
              chapterOutline: review.sections
                .filter((other) => other !== section)
                .map((other) => ({
                  title: other.title,
                  opening: other.sentences
                    .slice(0, 2)
                    .map((s) => s.plain)
                    .join(' '),
                })),
            }
          : {}),
        userId: job.userId,
        documentId: job.documentId,
      });
      const started = Date.now();
      try {
        const result = await deps.llm.complete({
          ...request,
          signal: AbortSignal.timeout(timeoutMs),
          schema: examinerSchema,
        });
        spentMicro += await deps.logCall({
          userId: job.userId,
          documentId: job.documentId,
          modelId: result.modelId,
          usage: result.usage,
          latencyMs: Date.now() - started,
          ok: true,
        });
        const processed = postProcessExaminer(result.value, {
          sentences: input.sentences,
          pitfalls,
          discipline,
        });
        if (processed.dropped > 0) {
          log({
            msg: 'examiner named sentences not sent',
            runId: job.runId,
            dropped: processed.dropped,
          });
        }
        return { ok: true as const, item, issues: processed.issues };
      } catch (error) {
        spentMicro += await deps
          .logCall({
            userId: job.userId,
            documentId: job.documentId,
            modelId: deps.llm.modelIdFor('strong'),
            usage: null,
            latencyMs: Date.now() - started,
            ok: false,
            error: String(error instanceof Error ? error.message : error).slice(0, 500),
          })
          .catch(() => 0);
        log({
          msg: 'examiner failed for a section; the others stand',
          runId: job.runId,
          section: section.title,
          error: String(error),
        });
        return { ok: false as const, item, issues: [] as ExaminerIssue[] };
      }
    });

    const reviewed = outcomes.filter((o) => o.ok);
    const failedSections = outcomes.filter((o) => !o.ok).map((o) => o.item.section.title);
    if (reviewed.length === 0) {
      return fail('The examiner could not be reached for any section. Try again later.', true);
    }

    const drafts: FlagDraft[] = [];
    for (const outcome of reviewed) {
      const byId = new Map(outcome.item.input.sentences.map((s) => [s.id, s.sentence]));
      for (const issue of outcome.issues) {
        const sentence = byId.get(issue.sentenceId);
        if (!sentence) continue;
        drafts.push({
          from: sentence.from,
          to: sentence.to,
          severity: issue.severity === 'blocking' ? 'ERROR' : 'WARN',
          description: issue.explanation || 'The examiner flagged this sentence.',
          suggestion: issue.correction || null,
          fingerprint: flagFingerprint(
            'EXAMINER',
            job.chapterId,
            `${issue.issueType} ${sentence.plain}`,
          ),
        });
      }
    }

    // What the student sees: an issue they already ignored on the same sentence is not counted.
    const written = await writeFlags(prisma, job, drafts);
    const done = {
      sections: review.sections.length,
      sectionsReviewed: reviewed.length,
      failedSections,
      issues: written.length,
      blocking: written.filter((d) => d.severity === 'ERROR').length,
    };
    await writeState(prisma, job, {
      status: 'DONE',
      finishedAt: now().toISOString(),
      version: chapter.version,
      ...done,
    });
    log({
      msg: 'examiner review finished',
      runId: job.runId,
      ...done,
      omittedSections: review.omittedSections,
      spentInr: spentMicro / 1e6,
    });
    return {
      runId: job.runId,
      status: 'DONE',
      ...done,
      flagsWritten: written.length,
      spentInr: spentMicro / 1e6,
    };
  } catch (error) {
    // Nothing reached the student (the budget guard, a database fault): the unit goes back.
    return fail(
      error instanceof Error ? error.message.slice(0, 500) : 'The review did not finish.',
      true,
    );
  }
}

/**
 * The passage each citation points at: the chunk it was made from when Assist or Draft made it
 * (ADR-0023), otherwise the source's first chunks, otherwise its abstract. Only sources in this
 * thesis's own library are read.
 */
async function loadPassages(
  prisma: PrismaClient,
  documentId: string,
  citations: readonly ReviewCitation[],
): Promise<(citation: ReviewCitation) => ReviewPassage | null> {
  const sourceIds = [...new Set(citations.flatMap((c) => (c.sourceId ? [c.sourceId] : [])))];
  if (sourceIds.length === 0) return () => null;
  const sources = await prisma.source.findMany({
    where: { id: { in: sourceIds }, documentId },
    select: { id: true, cslJson: true },
  });
  const own = new Set(sources.map((s) => s.id));
  const chunkIds = [
    ...new Set(
      citations.flatMap((c) => (c.chunkId && c.sourceId && own.has(c.sourceId) ? [c.chunkId] : [])),
    ),
  ];
  const cited = chunkIds.length
    ? await prisma.sourceChunk.findMany({
        where: { id: { in: chunkIds }, sourceId: { in: [...own] } },
        select: { id: true, sourceId: true, text: true },
      })
    : [];
  const byChunk = new Map(cited.map((c) => [c.id, c]));
  const needFirst = [
    ...new Set(
      citations.flatMap((c) =>
        c.sourceId && own.has(c.sourceId) && !(c.chunkId && byChunk.has(c.chunkId))
          ? [c.sourceId]
          : [],
      ),
    ),
  ];
  const first = needFirst.length
    ? await prisma.sourceChunk.findMany({
        where: {
          sourceId: { in: needFirst },
          ordinal: { lt: EXAMINER_REVIEW.chunksPerUncitedSource },
        },
        orderBy: [{ sourceId: 'asc' }, { ordinal: 'asc' }],
        select: { sourceId: true, text: true },
      })
    : [];
  const firstBySource = new Map<string, string>();
  for (const chunk of first) {
    firstBySource.set(
      chunk.sourceId,
      [firstBySource.get(chunk.sourceId), chunk.text].filter(Boolean).join('\n'),
    );
  }
  const abstractOf = new Map(
    sources.map((s) => {
      const abstract = (s.cslJson as { abstract?: unknown } | null)?.abstract;
      return [s.id, typeof abstract === 'string' ? abstract : ''];
    }),
  );
  const cut = (text: string) =>
    text.replace(/\s+/g, ' ').trim().slice(0, EXAMINER_REVIEW.passageChars);

  return (citation) => {
    if (!citation.sourceId || !own.has(citation.sourceId)) return null;
    const chunk = citation.chunkId ? byChunk.get(citation.chunkId) : undefined;
    if (chunk?.text.trim()) return { key: chunk.id, text: cut(chunk.text) };
    const text = firstBySource.get(citation.sourceId) || abstractOf.get(citation.sourceId) || '';
    return text.trim() ? { key: `source-${citation.sourceId}`, text: cut(text) } : null;
  };
}

/**
 * Replaces the chapter's open examiner flags with this run's. Resolved and ignored flags stay as
 * the record of what the student decided, and an issue whose fingerprint the student ignored is
 * not raised again.
 */
async function writeFlags(
  prisma: PrismaClient,
  job: ExaminerReviewJob,
  drafts: readonly FlagDraft[],
): Promise<FlagDraft[]> {
  await prisma.coherenceFlag.deleteMany({
    where: {
      documentId: job.documentId,
      chapterId: job.chapterId,
      type: 'EXAMINER',
      status: 'OPEN',
    },
  });
  const ignored = new Set(
    (
      await prisma.coherenceFlag.findMany({
        where: {
          documentId: job.documentId,
          chapterId: job.chapterId,
          type: 'EXAMINER',
          status: 'IGNORED',
        },
        select: { fingerprint: true },
      })
    ).map((f) => f.fingerprint),
  );
  const seen = new Set<string>();
  const rows = drafts.filter((d) => {
    if (ignored.has(d.fingerprint) || seen.has(d.fingerprint)) return false;
    seen.add(d.fingerprint);
    return true;
  });
  if (rows.length === 0) return [];
  await prisma.coherenceFlag.createMany({
    data: rows.map((d) => ({
      documentId: job.documentId,
      chapterId: job.chapterId,
      from: d.from,
      to: d.to,
      type: 'EXAMINER' as const,
      severity: d.severity,
      description: d.description,
      suggestion: d.suggestion,
      fingerprint: d.fingerprint,
      runId: job.runId,
    })),
  });
  return rows;
}
