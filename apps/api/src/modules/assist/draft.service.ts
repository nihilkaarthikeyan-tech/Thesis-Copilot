/**
 * Draft mode — PRD §9.3 `/draft/section`, FR-4.4, A.2, PHASES 4.2.
 *
 * The work happens in the worker (it is the longest call in the product), so this opens the
 * `SuggestionEvent` that gives the draft its id, checks the cap, enqueues the job, and relays what
 * the worker publishes to Redis as SSE.
 *
 * Relaying rather than computing means a student who reloads mid-draft has not lost it: the worker
 * finishes regardless, and the result is waiting on the channel.
 */

import { Inject, Injectable } from '@nestjs/common';
import { DRAFT, type DraftResult } from '@tc/ai';
import { computeCallCost, type Env } from '@tc/config';
import { findOutlineNode, isGenericSectionTitle, readOutline } from '@tc/types';
import type { Redis } from 'ioredis';
import { ENV } from '../../common/env.token.js';
import { NotFoundError, SectionNeedsTopicError } from '../../common/errors.js';
import { capExceeded, suggestionOutcome } from '../../common/metrics.js';
import { PrismaService } from '../../common/prisma.service.js';
import { QueueService } from '../../common/queue.service.js';
import { RedisService } from '../../common/redis.service.js';
import { FlagsService } from '../flags/flags.service.js';
import { refusal, UsageService } from '../usage/usage.service.js';

export type DraftInput = {
  chapterId: string;
  outlineNodeId: string;
  targetWords?: number;
  heading?: string;
  context?: string;
};

export type DraftEvent =
  | { event: 'start'; data: { draftId: string } }
  | { event: 'progress'; data: { stage: string } }
  | {
      event: 'done';
      data: {
        draftId: string;
        result: DraftResult;
        content: unknown[];
        short: boolean;
        needsSource: string[];
        words: number;
        targetWords: number;
        /** ADR-0071: paragraphs that follow a passage's wording too closely. */
        closeTo: unknown[];
      };
    }
  | { event: 'refused'; data: { draftId: string; reason: string } }
  | { event: 'error'; data: { code: string; message: string } };

/** The worker publishes here; one channel per draft. */
export const draftChannel = (draftId: string): string => `draft:${draftId}`;

/** A draft is a long call; well past it means the worker died. */
const DRAFT_TIMEOUT_MS = 180_000;

@Injectable()
export class DraftService {
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly queue: QueueService,
    private readonly flags: FlagsService,
    redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.redis = redis.client;
  }

  async *draft(
    user: { id: string; plan: string },
    input: DraftInput,
    signal: AbortSignal,
  ): AsyncGenerator<DraftEvent> {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: input.chapterId, document: { ownerId: user.id } },
      select: { id: true, documentId: true, title: true, scopeNote: true, outlineNodeId: true },
    });
    if (!chapter) throw new NotFoundError('That chapter');

    // ADR-0071: a draft needs a topic. The heading the cursor is under names one; so does the
    // outline node or a scope note. "Chapter 1" with nothing else does not, and drafting it wrote
    // about the sources' own headings. Refused before the unit is taken.
    if (!input.heading?.trim() || isGenericSectionTitle(input.heading)) {
      const memory = await this.prisma.documentMemory.findUnique({
        where: { documentId: chapter.documentId },
        select: { outline: true },
      });
      // ADR-0072: an editor opened before the chapters were planned sends the placeholder id.
      const outline = readOutline(memory?.outline);
      const node =
        findOutlineNode(outline, input.outlineNodeId) ??
        findOutlineNode(outline, chapter.outlineNodeId);
      const title = node?.title ?? chapter.title;
      const scope = (node?.scopeNote ?? chapter.scopeNote ?? '').trim();
      if (isGenericSectionTitle(title) && !scope) throw new SectionNeedsTopicError();
    }

    const cap = await this.usage.consume(
      user.id,
      user.plan as Parameters<UsageService['consume']>[1],
      'DRAFT',
    );
    if (!cap.ok) {
      capExceeded.inc({ action: 'DRAFT' });
      throw refusal('DRAFT', cap);
    }

    const event = await this.prisma.suggestionEvent.create({
      data: {
        userId: user.id,
        documentId: chapter.documentId,
        chapterId: chapter.id,
        action: 'DRAFT',
        shownChars: 0,
        outcome: 'SHOWN',
        latencyMs: 0,
        guided: false,
      },
      select: { id: true },
    });
    const draftId = event.id;

    // Subscribe before enqueueing, or a fast worker could publish before anyone is listening.
    const subscriber = this.redis.duplicate();
    const queue: string[] = [];
    let wake: (() => void) | null = null;
    await subscriber.subscribe(draftChannel(draftId));
    subscriber.on('message', (_channel, message) => {
      queue.push(message);
      wake?.();
    });

    yield { event: 'start', data: { draftId } };

    try {
      await this.queue.enqueue(
        'draft-section',
        {
          chapterId: chapter.id,
          documentId: chapter.documentId,
          userId: user.id,
          outlineNodeId: input.outlineNodeId,
          ...(input.targetWords ? { targetWords: input.targetWords } : {}),
          ...(input.heading?.trim() && !isGenericSectionTitle(input.heading)
            ? { heading: input.heading.trim(), context: (input.context ?? '').slice(-800) }
            : {}),
          draftId,
        } as never,
        { jobId: `draft-section__${draftId}` },
      );

      const startedAt = Date.now();
      for (;;) {
        if (signal.aborted) return;
        if (Date.now() - startedAt > DRAFT_TIMEOUT_MS) {
          yield {
            event: 'error',
            data: { code: 'DRAFT_TIMEOUT', message: 'The draft took too long. Try again.' },
          };
          return;
        }

        const message = queue.shift();
        if (!message) {
          await new Promise<void>((resolve) => {
            wake = resolve;
            setTimeout(resolve, 500);
          });
          wake = null;
          continue;
        }

        const parsed = JSON.parse(message) as {
          type: string;
          stage?: string;
          reason?: string;
          message?: string;
          result?: DraftResult;
          content?: unknown[];
          short?: boolean;
          needsSource?: string[];
          words?: number;
          targetWords?: number;
          closeTo?: unknown[];
        };

        if (parsed.type === 'progress') {
          yield { event: 'progress', data: { stage: parsed.stage ?? 'writing' } };
          continue;
        }

        if (parsed.type === 'refused') {
          // FR-4.4: refusing is not a failure of the call, but the student was not served, so the
          // unit goes back (§11.5).
          await this.usage.refund(user.id, 'DRAFT');
          await this.prisma.suggestionEvent.update({
            where: { id: draftId },
            data: { outcome: 'DISCARDED', latencyMs: Date.now() - startedAt },
          });
          yield { event: 'refused', data: { draftId, reason: parsed.reason ?? '' } };
          return;
        }

        if (parsed.type === 'error') {
          await this.usage.refund(user.id, 'DRAFT');
          yield {
            event: 'error',
            data: { code: 'PROVIDER_ERROR', message: parsed.message ?? 'The draft failed.' },
          };
          return;
        }

        if (parsed.type === 'done' && parsed.result) {
          await this.prisma.suggestionEvent.update({
            where: { id: draftId },
            data: {
              shownChars: parsed.result.markdown.length,
              latencyMs: Date.now() - startedAt,
            },
          });
          suggestionOutcome.inc({ outcome: 'SHOWN' });
          yield {
            event: 'done',
            data: {
              draftId,
              result: parsed.result,
              content: parsed.content ?? [],
              short: parsed.short ?? false,
              needsSource: parsed.needsSource ?? [],
              words: parsed.words ?? 0,
              targetWords: parsed.targetWords ?? DRAFT.defaultTargetWords,
              closeTo: parsed.closeTo ?? [],
            },
          };
          return;
        }
      }
    } finally {
      await subscriber.unsubscribe(draftChannel(draftId)).catch(() => undefined);
      subscriber.disconnect();
    }
  }

  /**
   * `POST /draft/:draftId/accept` and `/discard` — FR-4.4. The document itself is written by the
   * editor; this records what the student decided, which is what FR-9.4's telemetry measures.
   */
  async resolve(
    userId: string,
    draftId: string,
    outcome: 'ACCEPTED' | 'DISCARDED',
    keptChars = 0,
  ): Promise<{ outcome: string }> {
    const updated = await this.prisma.suggestionEvent.updateMany({
      // ADR-0039: a chapter build's sections are draft blocks too, accepted the same way; so are
      // the sections of a claims map opened as a document (ADR-0123), a literature review build's
      // (ADR-0124).
      where: {
        id: draftId,
        userId,
        action: { in: ['DRAFT', 'CHAPTER_BUILD', 'CROSS_PAPER', 'LIT_REVIEW_BUILD'] },
      },
      data: { outcome, keptChars: Math.max(0, Math.floor(keptChars)) },
    });
    if (updated.count === 0) throw new NotFoundError('That draft');
    suggestionOutcome.inc({ outcome });
    return { outcome };
  }

  /** Whether draft runs on the Strong tier (PHASES 4.9); the worker asks the same question. */
  async strongTier(): Promise<boolean> {
    return this.flags.isEnabled('draftModeStrongTier');
  }

  /** Cost of a completed draft, for `AiCallLog`. Zero on the mock (PHASES 1.4). */
  costFor(
    modelId: string,
    tier: 'fast' | 'strong',
    usage: { inputTokens: number; outputTokens: number },
  ): number {
    if (this.env.AI_PROVIDER === 'mock') return 0;
    return computeCallCost({ tier, modelId, usage });
  }
}
