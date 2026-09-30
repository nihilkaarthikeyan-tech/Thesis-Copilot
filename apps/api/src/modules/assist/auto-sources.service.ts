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
  monthlyAutoSearches,
} from '@tc/config';
import { PrismaService } from '../../common/prisma.service.js';
import { QueueService } from '../../common/queue.service.js';
import { FlagsService } from '../flags/flags.service.js';

/** Whether retrieval found anything on topic: a passage at or above the relevance floor. */
export function anyOnTopic(passages: ReadonlyArray<{ cosine?: number }>): boolean {
  return passages.some((p) => (p.cosine ?? 0) >= AUTO_SOURCES.minCosine);
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

@Injectable()
export class AutoSourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly flags: FlagsService,
  ) {}

  /** Starts a search for this chapter if allowed. True when one is running (new or already). */
  async start(
    input: { documentId: string; userId: string; chapterId: string; query: string },
    now: Date = new Date(),
  ): Promise<boolean> {
    if (!(await this.flags.isEnabled(AUTO_SOURCES_FLAG))) return false;
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { plan: true, settings: true },
    });
    if (!user) return false;
    if ((user.settings as { autoSources?: unknown } | null)?.autoSources === false) return false;
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const used = await this.prisma.auditEvent.count({
      where: { userId: input.userId, kind: 'SOURCES_FOUND', createdAt: { gte: from } },
    });
    if (used >= monthlyAutoSearches(user.plan)) return false;
    await this.queue.enqueue('find-sources', input, {
      jobId: autoSourcesJobKey(input.chapterId, now),
    });
    return true;
  }
}
