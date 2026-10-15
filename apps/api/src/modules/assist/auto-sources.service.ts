/**
 * Starting an automatic source search from the API (ADR-0037, 2026-09-30).
 *
 * The worker's `startFindSources` makes the same three checks for a refused draft; this is the
 * autocomplete side. The search runs in the worker (`find-sources`), so the student's suggestion
 * is never held up by it: this suggestion says a search has started, and the next ones cite what
 * it found.
 */

import { Injectable } from '@nestjs/common';
import {
  AUTO_SOURCES,
  AUTO_SOURCES_FLAG,
  autoSourcesJobKey,
  initialSourcesJobKey,
  monthlyAutoSearches,
} from '@tc/config';
import { readSourcePrefs } from '@tc/types';
import { PrismaService } from '../../common/prisma.service.js';
import { QueueService } from '../../common/queue.service.js';
import { RedisService } from '../../common/redis.service.js';
import { FlagsService } from '../flags/flags.service.js';

/** Whether retrieval found anything on topic: a passage at or above the relevance floor. */
export function anyOnTopic(passages: ReadonlyArray<{ cosine?: number }>): boolean {
  return passages.some((p) => (p.cosine ?? 0) >= AUTO_SOURCES.minCosine);
}

/**
 * ADR-0087: whether enough different papers are on topic for this section. One matching paper
 * used to count as covered, so the library stopped growing and every suggestion cited it.
 */
export function enoughPapersOnTopic(
  passages: ReadonlyArray<{ cosine?: number; sourceId?: string }>,
): boolean {
  const papers = new Set(
    passages
      .filter((p) => (p.cosine ?? 0) >= AUTO_SOURCES.minCosine && p.sourceId)
      .map((p) => p.sourceId),
  );
  return papers.size >= AUTO_SOURCES.minPapers;
}

/**
 * What the student is writing about, in words an index search understands: the chapter's title
 * and scope note and the last sentence before the cursor, without citation markers.
 */
export function sourcesQuery(title: string, scopeNote: string | null, before: string): string {
  // The last two sentences: one alone is often "Electrode wear remains a major cost in this
  // process", which names nothing without the one before it. The worker adds the thesis title.
  const last = before
    .replace(/\{\{cite:[^}]+\}\}/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 0)
    .slice(-2)
    .join(' ');
  // "Chapter 1" names nothing a search can use.
  const named = /^chapter\s+\d+$/i.test(title.trim()) ? '' : title;
  return [named, scopeNote ?? '', last]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('. ')
    .slice(0, 500);
}

export type SourcesProgress = {
  searching: boolean;
  found: number;
  ready: number;
  reading: number;
  /**
   * ADR-0155: a search this thesis wanted was refused because the month's automatic searches are
   * used up, and nothing is running. The editor and the setup card say so, with Find papers.
   */
  limitReached: boolean;
};

/** A paper not read within this long after it was added is not "still being read". */
const READING_WINDOW_MS = 5 * 60_000;

const searchKey = (documentId: string) => `sources:search:${documentId}`;
/** Word test 2026-10-16 (ADR-0155): a search this thesis wanted was refused for the month. */
const refusedKey = (documentId: string) => `sources:refused:${documentId}`;

/**
 * What `startSearch` did: `started` (a search is running, new or already), `limit` (refused:
 * the month's automatic searches are used up), `off` (the switch, the thesis's web-search choice
 * or the student's setting).
 */
export type SearchOutcome = 'started' | 'limit' | 'off';

/**
 * ADR-0155: whether this is the thesis's first search, the one made when it is created or named
 * (ADR-0087/0145). That one always runs: it is counted against the month, but never refused for
 * it, or a student whose automatic searches are used up starts a new thesis with no papers and
 * no word why (the Word test, 2026-10-16). Later searches, a renamed thesis's included, are
 * limited as before. The worker's `isFirstSearchOfThesis` makes the same check.
 */
export async function firstSearchOfThesis(
  prisma: {
    auditEvent: { count(args: { where: Record<string, unknown> }): Promise<number> };
  },
  documentId: string,
): Promise<boolean> {
  const before = await prisma.auditEvent.count({
    where: { documentId, kind: 'SOURCES_FOUND', detail: { path: ['initial'], equals: true } },
  });
  return before === 0;
}

@Injectable()
export class AutoSourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly flags: FlagsService,
    private readonly redis: RedisService,
  ) {}

  /** Starts a search for this chapter if allowed. True when one is running (new or already). */
  async start(
    input: Parameters<AutoSourcesService['startSearch']>[0],
    now: Date = new Date(),
  ): Promise<boolean> {
    return (await this.startSearch(input, now)) === 'started';
  }

  /** `start`, saying why when nothing started (ADR-0155). */
  async startSearch(
    input: {
      documentId: string;
      userId: string;
      chapterId: string;
      query: string;
      /** ADR-0087: the search made when the thesis is created, which adds more papers. */
      initial?: boolean;
      /**
       * ADR-0145: the initial search for a title given in the setup card, keyed on that title, so
       * a thesis named again searches again.
       */
      named?: boolean;
      /** ADR-0087: the heading being written under; each section searches on its own. */
      section?: string | null;
    },
    now: Date = new Date(),
  ): Promise<SearchOutcome> {
    if (!(await this.flags.isEnabled(AUTO_SOURCES_FLAG))) return 'off';
    const document = await this.prisma.document.findUnique({
      where: { id: input.documentId },
      select: { meta: true },
    });
    // ADR-0087: the student turned web search off for this thesis.
    if (!readSourcePrefs(document?.meta).webSearch) return 'off';
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { plan: true, settings: true },
    });
    if (!user) return 'off';
    if ((user.settings as { autoSources?: unknown } | null)?.autoSources === false) return 'off';
    const free =
      input.initial === true && (await firstSearchOfThesis(this.prisma, input.documentId));
    if (!free && (await this.usedUp(input.userId, user.plan, now))) {
      // ADR-0155: said, never silent. The editor's progress line and the setup card read it.
      await this.redis.client.set(refusedKey(input.documentId), '1', 'EX', 24 * 60 * 60);
      return 'limit';
    }
    const jobId = input.initial
      ? initialSourcesJobKey(input.documentId, input.named ? input.query : null)
      : autoSourcesJobKey(input.chapterId, now, input.section);
    await this.queue.enqueue(
      'find-sources',
      {
        documentId: input.documentId,
        userId: input.userId,
        chapterId: input.chapterId,
        query: input.query,
        ...(input.initial ? { initial: true } : {}),
      },
      { jobId },
    );
    // ADR-0070: which search the editor's progress line should watch for this thesis.
    await this.redis.client.set(searchKey(input.documentId), jobId, 'EX', 15 * 60);
    await this.redis.client.del(refusedKey(input.documentId));
    return 'started';
  }

  /** Whether this user's automatic searches for the calendar month (UTC) are used up. */
  private async usedUp(userId: string, plan: string, now: Date): Promise<boolean> {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const used = await this.prisma.auditEvent.count({
      where: { userId, kind: 'SOURCES_FOUND', createdAt: { gte: from } },
    });
    return used >= monthlyAutoSearches(plan);
  }

  /**
   * ADR-0070: what the editor's progress line says while a new library fills — whether a search
   * is still running, how many papers it has added, and how many can be cited yet. Counts only;
   * nothing is computed that the database does not already hold.
   */
  async progress(documentId: string, now: Date = new Date()): Promise<SourcesProgress> {
    const [jobId, refused] = await Promise.all([
      this.redis.client.get(searchKey(documentId)),
      this.redis.client.get(refusedKey(documentId)),
    ]);
    const searching = jobId ? await this.queue.pending('find-sources', jobId) : false;
    const recent = new Date(now.getTime() - READING_WINDOW_MS);
    const [found, ready, waiting] = await Promise.all([
      this.prisma.source.count({ where: { documentId } }),
      // Ready means something to cite is stored, not the grounding badge: `resolve-reference`
      // marks a paper ABSTRACT as soon as it has found one, before anything is embedded.
      this.prisma.source.count({ where: { documentId, chunks: { some: {} } } }),
      // Still on its way: added in the last few minutes, nothing stored yet, not given up on.
      this.prisma.source.findMany({
        where: {
          documentId,
          chunks: { none: {} },
          status: { in: ['PENDING', 'RESOLVED'] },
          createdAt: { gte: recent },
        },
        select: { id: true, status: true },
      }),
    ]);
    // QA 2026-10-09: a paper whose reading had finished with nothing to store (no abstract, no
    // open text) counted as "reading" for the whole window, so "reading 1…" stayed for minutes.
    // A resolved paper is still being read only while its index job is.
    const indexing = waiting.some((s) => s.status === 'RESOLVED')
      ? await this.queue.unfinishedIndexing().catch(() => null)
      : new Set<string>();
    const reading = waiting.filter(
      (s) => s.status === 'PENDING' || indexing === null || indexing.has(s.id),
    ).length;
    return { searching, found, ready, reading, limitReached: refused !== null && !searching };
  }
}
