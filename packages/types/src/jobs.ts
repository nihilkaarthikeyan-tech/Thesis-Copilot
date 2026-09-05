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

export const QUEUE_NAMES = [
  'noop',
  'extract-paper',
  'resolve-reference',
  'index-source',
  'search-literature',
  'draft-section',
  // FR-3.2: outline generation is a Strong call, so it runs as a job (PRD 9.1).
  'generate-outline',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

/** `extract-paper` — read an uploaded seed paper and store its `PaperExtraction` (FR-1.2, A.5). */
export type ExtractPaperJob = {
  seedPaperId: string;
  documentId: string;
  userId: string;
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
};

/** `generate-outline` - A.9 over the template, scope, gap map and (Path B) extraction. */
export type GenerateOutlineJob = {
  documentId: string;
  userId: string;
  template?: string;
};

export type JobPayloads = {
  noop: Record<string, never>;
  'extract-paper': ExtractPaperJob;
  'resolve-reference': ResolveReferenceJob;
  'index-source': IndexSourceJob;
  'search-literature': SearchLiteratureJob;
  'draft-section': DraftSectionJob;
  'generate-outline': GenerateOutlineJob;
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

/** Short stable digest, so producer and consumer derive the same id from the same string. */
export function jobKeyDigest(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
