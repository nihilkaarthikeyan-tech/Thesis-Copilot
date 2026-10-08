/**
 * Queue wiring for the worker — PRD §7.2 and PHASES 0.7.
 *
 * Names, payload shapes and the retry policy come from `@tc/types`, shared with `apps/api` so the
 * producer and the consumer cannot drift apart.
 */

import { JOB_RETRY, QUEUE_NAMES, type QueueName } from '@tc/types';
import type { JobsOptions } from 'bullmq';

export type { ExtractPaperJob, IndexSourceJob, JobPayloads, ResolveReferenceJob } from '@tc/types';
export { QUEUE_NAMES, type QueueName };

export const QUEUE_NOOP = 'noop' satisfies QueueName;
export const QUEUE_EXTRACT_PAPER = 'extract-paper' satisfies QueueName;
export const QUEUE_RESOLVE_REFERENCE = 'resolve-reference' satisfies QueueName;
export const QUEUE_INDEX_SOURCE = 'index-source' satisfies QueueName;
export const QUEUE_DRAFT_SECTION = 'draft-section' satisfies QueueName;
export const QUEUE_SEARCH_LITERATURE = 'search-literature' satisfies QueueName;
export const QUEUE_GENERATE_OUTLINE = 'generate-outline' satisfies QueueName;
export const QUEUE_COHERENCE = 'coherence' satisfies QueueName;
export const QUEUE_FIND_SOURCES = 'find-sources' satisfies QueueName;
export const QUEUE_CHAPTER_BUILD = 'chapter-build' satisfies QueueName;
export const QUEUE_EXAMINER_REVIEW = 'examiner-review' satisfies QueueName;
export const QUEUE_LIT_REVIEW_BUILD = 'lit-review-build' satisfies QueueName;

/**
 * Three attempts with exponential backoff from 1s. Jobs are kept after completion and failure so
 * the admin dashboard can report the failure rate §14 alerts on; without that, a failed job
 * disappears and the alert has nothing to count.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = JOB_RETRY as JobsOptions;
