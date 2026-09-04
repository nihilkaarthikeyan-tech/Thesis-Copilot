/**
 * Queue names and the shared retry policy — PRD §7.2 (BullMQ on Redis, separate worker process)
 * and PHASES.md task 0.7.
 *
 * Phase 0 registers one queue, `noop`, to prove the wiring. The real queues arrive with the work
 * that needs them: `extract-paper` (week 2), `index-source` (week 2), `search-literature`
 * (Phase 2), `draft-section` (week 4). PRD §9 names those four; nothing else is invented here.
 */

import type { JobsOptions } from 'bullmq';

export const QUEUE_NOOP = 'noop';

/**
 * Retry policy for every queue.
 *
 * Three attempts with exponential backoff from 1s (1s, 2s, 4s). Jobs are kept after completion and
 * failure so the admin dashboard can report the failure rate §14 alerts on; without that, a failed
 * job disappears and the alert has nothing to count.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 24 * 3600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};
