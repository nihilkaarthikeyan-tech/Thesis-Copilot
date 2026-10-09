/**
 * `index-abstract` — ADR-0136 (2026-10-09).
 *
 * A resolved paper's abstract, made citable on a queue of its own, before anyone looks for its
 * full text. Measured on eight new theses the same morning: the abstract step of `index-source`
 * took under a second, yet the papers waited 10–40 s for one of the queue's two slots, because
 * each slot was held for 5–20 s by the full-text attempts of the papers ahead (PDF downloads,
 * Europe PMC, Springer), the previous student's papers included. ADR-0070 had put the abstract
 * first inside the job; the job itself was still behind every download in the queue.
 *
 * So the work is split in two:
 *   1. here, with no network call but one embedding, the abstract becomes passages and the paper
 *      is ABSTRACT — the badge is earned by passages actually stored;
 *   2. `index-source` is then queued for the full text, told the abstract is stored, so it neither
 *      embeds it again nor removes it while it searches; full text, if found, replaces it.
 *
 * A failure here is not the paper's end: the full-text job is queued anyway, and its own
 * abstract-first step (ADR-0070) makes the paper citable as before.
 */

import type { IndexSourceJob } from '@tc/types';
import {
  abstractChunks,
  abstractOf,
  embedAndStoreChunks,
  type IndexSourceDeps,
} from './index-source.js';

export type IndexAbstractDeps = Pick<
  IndexSourceDeps,
  'prisma' | 'embeddings' | 'logEmbed' | 'assertBudget' | 'log'
> & {
  /** Queues `index-source` for the full text (the same job id it always had). */
  enqueueFullText: (input: IndexSourceJob) => Promise<unknown>;
};

export type IndexAbstractResult = {
  sourceId: string;
  /** Passages written by this job; 0 when it stored nothing. */
  chunks: number;
  /** Why nothing was stored, when nothing was. */
  skipped?: 'gone' | 'no-abstract' | 'already-read' | 'has-file' | 'failed';
  /** Whether `index-source` was queued for the full text. */
  fullTextQueued: boolean;
};

export async function runIndexAbstract(
  job: IndexSourceJob,
  deps: IndexAbstractDeps,
): Promise<IndexAbstractResult> {
  const log = deps.log ?? (() => undefined);
  const source = await deps.prisma.source.findFirst({
    where: { id: job.sourceId, documentId: job.documentId },
    select: { id: true, doi: true, fileKey: true, cslJson: true },
  });
  if (!source) return { sourceId: job.sourceId, chunks: 0, skipped: 'gone', fullTextQueued: false };

  const abstract = abstractOf(source.cslJson);
  let chunks = 0;
  let skipped: IndexAbstractResult['skipped'];
  if (source.fileKey) {
    // A PDF we hold is read straight away by `index-source`, with no download to wait for.
    skipped = 'has-file';
  } else if (!abstract) {
    skipped = 'no-abstract';
  } else if ((await deps.prisma.sourceChunk.count({ where: { sourceId: source.id } })) > 0) {
    // Read before (a re-resolve after a DOI fix): `index-source` replaces it with what the new
    // record leads to, as it always has.
    skipped = 'already-read';
  } else {
    try {
      chunks = await embedAndStoreChunks(source.id, abstractChunks(abstract), job, deps);
      await deps.prisma.source.update({
        where: { id: source.id },
        data: { groundingLevel: 'ABSTRACT' },
      });
      log({ msg: 'abstract indexed', sourceId: source.id, chunks });
    } catch (error) {
      chunks = 0;
      skipped = 'failed';
      log({ msg: 'abstract could not be indexed', sourceId: source.id, error: String(error) });
    }
  }

  // Nothing further to read: no DOI to look up and no file. The abstract is all there is.
  if (chunks > 0 && !source.doi && !source.fileKey) {
    return { sourceId: source.id, chunks, fullTextQueued: false };
  }

  await deps.enqueueFullText({
    sourceId: job.sourceId,
    documentId: job.documentId,
    userId: job.userId,
    ...(job.contentKey !== undefined ? { contentKey: job.contentKey } : {}),
    ...(chunks > 0 ? { abstractStored: true } : {}),
  });
  return { sourceId: source.id, chunks, ...(skipped ? { skipped } : {}), fullTextQueued: true };
}
