/**
 * Background job contract, shared by `apps/api` (producer) and `apps/worker` (consumer).
 *
 * Lives in `packages/types` rather than a new package: PRD §7.3 fixes the package list, and §7.3
 * describes `types` as the shared DTOs both sides use. Keeping the names in one place means a typo
 * cannot quietly create a second queue that nothing reads.
 *
 * Queue names come from PRD §9: `extract-paper` (§9.1), `index-source` and `search-literature`
 * (§9.2), `draft-section` (§9.3). `resolve-reference` is named by PHASES 2.5 but not by the PRD —
 * logged as an addition in docs/CONSISTENCY_REVIEW.md.
 */

import type { ChapterBuildJob } from './chapter-build.js';

export const QUEUE_NAMES = [
  'noop',
  'extract-paper',
  'resolve-reference',
  'index-source',
  // ADR-0136: the abstract alone, made citable at once; it then queues `index-source` for the
  // full text, so a slow download never stands between a new library and its first passage.
  'index-abstract',
  'search-literature',
  'draft-section',
  // FR-3.2: outline generation is a Strong call, so it runs as a job (PRD 9.1).
  'generate-outline',
  // D.1.1: a coherence run is minutes of Strong calls; it never blocks a request.
  'coherence',
  // ADR-0037: nothing in the library covers the section being written, so find papers on it.
  'find-sources',
  // ADR-0039: one chapter planned, written section by section, checked and delivered as drafts.
  'chapter-build',
  // ADR-0056: a strict examiner reads each section of a chapter the student wrote.
  'examiner-review',
  // ADR-0124: a whole literature review — the chapter build's pipeline over every theme.
  'lit-review-build',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

/** `extract-paper` — read an uploaded seed paper and store its `PaperExtraction` (FR-1.2, A.5). */
export type ExtractPaperJob = {
  seedPaperId: string;
  documentId: string;
  userId: string;
};

/**
 * `coherence` — one run of the five D.1.2 checks over a document (FR-6.x, Appendix D.1).
 *
 * `triggeredBy` decides whether the run costs a cap unit: a student pressing "Check" does,
 * a re-run after a guide's feedback round does not (D.2.4).
 */
export type CoherenceRunJob = {
  documentId: string;
  userId: string;
  runId: string;
  triggeredBy: 'MANUAL' | 'AUTOSAVE' | 'FEEDBACK';
};

/** `resolve-reference` — turn one raw reference string into a `Source` (FR-2.1). */
export type ResolveReferenceJob = {
  documentId: string;
  userId: string;
  /** The raw string exactly as extraction captured it; the idempotency key with `documentId`. */
  rawReference: string;
  /** A DOI printed in the entry itself, if any — resolution can skip the search when present. */
  printedDoi?: string;
};

/** `index-source` — fetch full text where open access allows, chunk, embed (FR-2.2, FR-2.4). */
export type IndexSourceJob = {
  sourceId: string;
  documentId: string;
  userId: string;
  /**
   * What this run will read: the DOI, or the object-storage key of an uploaded PDF. It is part of
   * the job id, so re-indexing the same content is deduplicated while a source that now points at
   * something else — after a manual DOI fix, or a PDF the student uploaded — is indexed again.
   * Keying on `sourceId` alone silently swallowed every re-index.
   */
  contentKey?: string;
  /**
   * ADR-0136: set by `index-abstract` when it has just stored the abstract's passages, so this
   * job neither embeds the abstract again nor deletes it while it looks for the full text. Not
   * part of the job id: it does not change what the job reads.
   */
  abstractStored?: boolean;
};

export type SearchLiteratureJob = {
  documentId: string;
  userId: string;
  runId: string;
  mode: 'discover' | 'expand';
};

export type DraftSectionJob = {
  chapterId: string;
  documentId: string;
  userId: string;
  outlineNodeId: string;
  targetWords?: number;
  /**
   * ADR-0071: the heading the cursor was under, and the student's own text in that section so
   * far. Absent from callers that draft a whole outline node (the chapter build).
   */
  heading?: string;
  context?: string;
};

/** `generate-outline` - A.9 over the template, scope, gap map and (Path B) extraction. */
export type GenerateOutlineJob = {
  documentId: string;
  userId: string;
  template?: string;
  /**
   * ADR-0072: no proposal yet, so plan from the thesis title alone (`Document.title` as the
   * working title, no problem statement or objectives). A saved proposal still wins if one has
   * arrived by the time the job runs.
   */
  fromTitle?: boolean;
};

/**
 * `find-sources` — ADR-0037. The library has nothing on what the student is writing, so search
 * the indexes for it and add the few papers that are genuinely on topic.
 */
export type FindSourcesJob = {
  documentId: string;
  userId: string;
  chapterId: string;
  /** What the student is writing about, in words: the section title, scope note and last sentence. */
  query: string;
  /**
   * ADR-0087: the search made when the thesis is created. It adds `AUTO_SOURCES.initialPerRun`
   * papers rather than `perRun`, so a new thesis starts with a library to cite from, not five.
   */
  initial?: boolean;
};

/**
 * `examiner-review` — ADR-0056. One chapter, as saved at `version`, read section by section by
 * the chapter build's examiner; its issues become `EXAMINER` flags. `runId` is the record in
 * `Document.meta.examinerReviews[chapterId]` the worker finishes.
 */
export type ExaminerReviewJob = {
  documentId: string;
  chapterId: string;
  userId: string;
  runId: string;
  /** The chapter version the API saw when it took the unit; the job reads the chapter as saved. */
  version: number;
  /**
   * ADR-0067: review only the sentences inside this range of the saved chapter (a selection),
   * for one COMMAND unit; only the examiner flags inside it are replaced. Absent: the chapter.
   */
  range?: { from: number; to: number };
};

/** One chapter's last examiner review, kept in `Document.meta.examinerReviews[chapterId]`. */
export type ExaminerReviewRecord = {
  runId: string;
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  version: number;
  /** Re-runs of the same saved version after a failure; part of the job id. */
  attempt: number;
  startedAt: string;
  finishedAt?: string;
  sections?: number;
  sectionsReviewed?: number;
  /** Sections whose examiner call failed or timed out, by heading. */
  failedSections?: string[];
  issues?: number;
  blocking?: number;
  error?: string;
  /** ADR-0067: the run reviewed a selection, not the whole chapter. */
  selection?: boolean;
  /**
   * ADR-0131: what the chapter does well, each pinned to the sentence it quotes (positions in the
   * chapter as saved at `version`). A whole-chapter review only; at most four.
   */
  strengths?: ExaminerStrength[];
  /** ADR-0131: questions an examiner would ask the author in the viva; at most five. */
  questions?: ExaminerQuestion[];
};

/** One strength of a reviewed chapter — ADR-0131. `quote` is words of the sentence at from–to. */
export type ExaminerStrength = {
  quote: string;
  why: string;
  section: string;
  from: number;
  to: number;
};

/** One question for the author — ADR-0131. from–to: the sentence it is about, when it names one. */
export type ExaminerQuestion = {
  question: string;
  section: string;
  from: number | null;
  to: number | null;
};

export type JobPayloads = {
  noop: Record<string, never>;
  'extract-paper': ExtractPaperJob;
  'resolve-reference': ResolveReferenceJob;
  'index-source': IndexSourceJob;
  'index-abstract': IndexSourceJob;
  'search-literature': SearchLiteratureJob;
  'draft-section': DraftSectionJob;
  'generate-outline': GenerateOutlineJob;
  coherence: CoherenceRunJob;
  'find-sources': FindSourcesJob;
  'chapter-build': ChapterBuildJob;
  'examiner-review': ExaminerReviewJob;
  'lit-review-build': ChapterBuildJob & { kind: 'LIT_REVIEW' };
};

/**
 * Retry policy for every queue — PHASES 0.7: three attempts with exponential backoff from 1s.
 * Failed jobs are kept for a week because PRD §14 alerts on a job failure rate over 15 minutes,
 * which cannot be computed if failures are discarded.
 *
 * Plain data, so this module stays free of a BullMQ import; each side widens it to `JobsOptions`.
 */
export const JOB_RETRY = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 24 * 3600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

/** Statuses a `SeedPaper` moves through (PRD §8 `SeedPaper.status`). */
export const SEED_PAPER_STATUSES = ['PENDING', 'EXTRACTING', 'DONE', 'FAILED'] as const;
export type SeedPaperStatus = (typeof SEED_PAPER_STATUSES)[number];

/**
 * Builds a BullMQ job id from parts.
 *
 * BullMQ refuses a custom id containing ":" ("Custom Id cannot contain :"), which is the separator
 * most of this codebase reaches for, so the parts are joined with "__" instead. The id is what
 * makes an enqueue idempotent: BullMQ ignores a second add with an id it already holds, so a
 * retried request cannot start the same work twice.
 */
export function jobId(...parts: readonly string[]): string {
  return parts.map((part) => part.replace(/:/g, '_')).join('__');
}

/**
 * "Is anyone looking at this run?" (2026-10-04, ADR-0058). A page that shows a long job polls the
 * API while the job runs; each poll from a visible tab stamps this Redis key with the time. The
 * worker reads it when the job ends and mails the student only if nobody has looked for a while.
 * In Redis rather than on the run record because the worker rewrites the whole record as it goes,
 * and a heartbeat written beside it would either be wiped or wipe the worker's own write.
 */
export const JOB_WATCH = {
  /** The key outlives the "still looking" window comfortably and then cleans itself up. */
  ttlSeconds: 120,
} as const;

export function jobWatchKey(runId: string): string {
  return `job-watch:${runId}`;
}

/** Short stable digest, so producer and consumer derive the same id from the same string. */
export function jobKeyDigest(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * The job id of a source's abstract job or full-text job (ADR-0136). Both key on what the job
 * reads: the source and its `contentKey` (the DOI, or the key of an uploaded PDF). The same
 * content queued twice is one job; a source that now points at something else is read again.
 * The two queues share the shape, so the id of one says which id the other has.
 */
export function indexJobId(
  queue: 'index-source' | 'index-abstract',
  input: Pick<IndexSourceJob, 'sourceId' | 'contentKey'>,
): string {
  return jobId(queue, input.sourceId, jobKeyDigest(input.contentKey ?? 'none'));
}
