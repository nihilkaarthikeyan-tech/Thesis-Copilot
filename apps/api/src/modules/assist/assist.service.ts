/**
 * Assist mode — PRD §9.3 `/assist/suggest`, FR-4.3, Appendix B.8 (transport), A.1 (prompt),
 * §10.2 (call sequence: cap → prompt → call → parse → AiCallLog → ledger), §10.6, §11.5.
 *
 * The sequence, in §10.2's order: cap check (atomic, before any provider call) → cached memory
 * block (A.0.1) + retrieved passages (§10.4) → A.1 request → stream → A.1 post-processing with the
 * §10.6 whitelist → `AiCallLog` → `SuggestionEvent`. The post-processed text travels on the `done`
 * event because steps 1–3 can change what was streamed.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { buildAssistRequest, type LlmProvider, type Providers, postProcessAssist } from '@tc/ai';
import { computeCallCost, type Env } from '@tc/config';
import { Redis } from 'ioredis';
import { ENV } from '../../common/env.token.js';
import { ConflictError, NotFoundError } from '../../common/errors.js';
import {
  aiCallLatency,
  aiCostMicroInr,
  aiTtfb,
  capExceeded,
  hallucinatedCite,
  suggestionOutcome,
} from '../../common/metrics.js';
import { PrismaService } from '../../common/prisma.service.js';
import { RedisService } from '../../common/redis.service.js';
import { PROVIDERS } from '../ai/ai.module.js';
import { refusal, UsageService } from '../usage/usage.service.js';
import { ContextService } from './context.service.js';

export type SuggestInput = {
  chapterId: string;
  before: string;
  after: string;
  guided?: string;
  cursorContext?: { blockType?: string };
};

export type SuggestCitation = {
  key: string;
  sourceId: string | null;
  chunkId: string | null;
  rendered: string;
};

export type SuggestEvent =
  | { event: 'start'; data: { suggestionId: string } }
  | { event: 'token'; data: { t: string } }
  | {
      event: 'done';
      data: {
        suggestionId: string;
        /** After A.1 post-processing. Replaces what was streamed. */
        text: string;
        citations: SuggestCitation[];
        /** §6.2 empty-grounding state: false when no passage was retrieved for this call. */
        grounded: boolean;
        pinned: number;
        usage: unknown;
        ttfbMs: number;
        latencyMs: number;
        empty: boolean;
      };
    }
  | { event: 'error'; data: { code: string; message: string } };

export const OUTCOMES = [
  'SHOWN',
  'ACCEPTED',
  'PARTIAL',
  'EDITED',
  'REJECTED',
  'CANCELLED',
  'DISCARDED',
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** B.3 / B.8: one open suggestion per user; a second request answers 409. */
const IN_FLIGHT_TTL_SECONDS = 60;

@Injectable()
export class AssistService {
  private readonly logger = new Logger(AssistService.name);
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    redis: RedisService,
    private readonly context: ContextService,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.redis = redis.client;
  }

  /**
   * Runs one suggestion. Yields SSE events; the controller writes them. `signal` aborts on client
   * disconnect and propagates to the provider (B.8, PHASES 1.4).
   *
   * Refusals (cap, in-flight, ownership) are thrown before the first event so the controller can
   * answer with problem-details JSON instead of opening a stream.
   */
  async *suggest(
    user: { id: string; plan: string },
    input: SuggestInput,
    signal: AbortSignal,
  ): AsyncGenerator<SuggestEvent> {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: input.chapterId, document: { ownerId: user.id } },
      select: {
        id: true,
        title: true,
        scopeNote: true,
        documentId: true,
        outlineNodeId: true,
        content: true,
        // §2.2: the prompts answer in the document's language.
        document: { select: { language: true } },
      },
    });
    if (!chapter) throw new NotFoundError('That chapter');

    const inFlightKey = `assist:inflight:${user.id}`;
    const acquired = await this.redis.set(inFlightKey, '1', 'EX', IN_FLIGHT_TTL_SECONDS, 'NX');
    if (acquired !== 'OK') {
      throw new ConflictError('A suggestion is already in progress. Wait for it or press Esc.', {
        type: 'ASSIST_IN_FLIGHT',
      });
    }

    try {
      const plan = user.plan as Parameters<UsageService['consume']>[1];
      const cap = await this.usage.consume(user.id, plan, 'ASSIST');
      if (!cap.ok) {
        capExceeded.inc({ action: 'ASSIST' });
        throw refusal('ASSIST', cap);
      }

      const startedAt = Date.now();
      const event = await this.prisma.suggestionEvent.create({
        data: {
          userId: user.id,
          documentId: chapter.documentId,
          chapterId: chapter.id,
          action: 'ASSIST',
          shownChars: 0,
          outcome: 'SHOWN',
          latencyMs: 0,
          guided: Boolean(input.guided),
        },
        select: { id: true },
      });
      yield { event: 'start', data: { suggestionId: event.id } };

      // §10.3 / §10.4: the cached block and the passages, then A.1 assembled from prompt files.
      const [memory, retrieved, settings] = await Promise.all([
        this.context.memoryBlock(chapter),
        this.context.retrieve(chapter, input.before, 'ASSIST'),
        // §2.2's citation toggle, per user and independent of automatic-suggest (ADR-0006).
        this.prisma.user.findUnique({ where: { id: user.id }, select: { settings: true } }),
      ]);
      // PRD 2.2: auto-cite is on unless the student turned it off in settings.
      const userSettings = (settings?.settings ?? {}) as Record<string, unknown>;
      const autoCite = userSettings.autoCite !== false;
      const request = buildAssistRequest({
        memoryBlock: memory.text,
        chapter: { title: chapter.title, scopeNote: chapter.scopeNote },
        passages: retrieved.passages,
        before: input.before,
        after: input.after,
        instruction: input.guided ?? null,
        userId: user.id,
        documentId: chapter.documentId,
        signal,
      });
      let text = '';
      let ttfbMs: number | null = null;
      let usage: unknown = null;
      let modelId = this.providers.llm.modelIdFor('fast');

      try {
        for await (const chunk of this.providers.llm.stream(request)) {
          if (signal.aborted) break;
          if (chunk.type === 'text') {
            if (ttfbMs === null) {
              ttfbMs = Date.now() - startedAt;
              aiTtfb.observe({ action: 'ASSIST' }, ttfbMs);
            }
            text += chunk.text;
            yield { event: 'token', data: { t: chunk.text } };
          } else {
            usage = chunk.usage;
            modelId = chunk.modelId;
            await this.logCall(
              user.id,
              chapter.documentId,
              modelId,
              chunk.usage,
              Date.now() - startedAt,
              true,
            );
          }
        }
      } catch (error) {
        // Provider failure: the student was never served, so the unit goes back (§11.5).
        await this.usage.refund(user.id, 'ASSIST');
        await this.logCall(
          user.id,
          chapter.documentId,
          modelId,
          null,
          Date.now() - startedAt,
          false,
          error,
        );
        await this.prisma.suggestionEvent.update({
          where: { id: event.id },
          data: { outcome: 'CANCELLED', latencyMs: Date.now() - startedAt },
        });
        yield {
          event: 'error',
          data: {
            code: 'PROVIDER_ERROR',
            message: 'The suggestion could not be generated. Try again.',
          },
        };
        this.logger.warn({ err: error, suggestionId: event.id }, 'assist provider error');
        return;
      }

      const latencyMs = Date.now() - startedAt;
      aiCallLatency.observe({ action: 'ASSIST', tier: 'fast' }, latencyMs);

      if (signal.aborted) {
        // Client went away mid-stream (typed, navigated). The cap unit stays consumed: tokens were
        // generated. Outcome is recorded as CANCELLED with what was shown.
        await this.prisma.suggestionEvent.update({
          where: { id: event.id },
          data: { outcome: 'CANCELLED', shownChars: text.length, latencyMs, ttfbMs },
        });
        suggestionOutcome.inc({ outcome: 'CANCELLED' });
        return;
      }

      // A.1 post-processing, in its order, with §10.6's whitelist: only ids that were in the
      // prompt may survive. Anything else is stripped and counted.
      const processed = postProcessAssist({
        output: text,
        passageIds: retrieved.passages.map((p) => p.id),
        before: input.before,
        autoCite,
      });
      for (const key of processed.hallucinated) {
        hallucinatedCite.inc();
        this.logger.warn({ suggestionId: event.id, key }, 'HALLUCINATED_CITE');
      }

      const empty = processed.empty;
      if (empty) {
        // A.1 post-processing step 4: empty output does not count against the cap.
        await this.usage.refund(user.id, 'ASSIST');
        await this.prisma.suggestionEvent.update({
          where: { id: event.id },
          data: { outcome: 'CANCELLED', shownChars: 0, latencyMs, ttfbMs },
        });
        this.logger.log({ suggestionId: event.id }, 'EMPTY_SUGGESTION');
      } else {
        await this.prisma.suggestionEvent.update({
          where: { id: event.id },
          data: { shownChars: processed.text.length, latencyMs, ttfbMs },
        });
        suggestionOutcome.inc({ outcome: 'SHOWN' });
      }

      // Each surviving key resolves to the real source and chunk it stood for in this request.
      const citations: SuggestCitation[] = processed.cited.map((key) => {
        const real = retrieved.byKey.get(key);
        return {
          key,
          sourceId: real?.sourceId ?? null,
          chunkId: real?.chunkId ?? null,
          rendered: real ? `(${real.shortRef})` : '(Source)',
        };
      });

      yield {
        event: 'done',
        data: {
          suggestionId: event.id,
          text: processed.text,
          citations,
          grounded: retrieved.passages.length > 0,
          pinned: retrieved.pinned,
          usage,
          ttfbMs: ttfbMs ?? latencyMs,
          latencyMs,
          empty,
        },
      };
    } finally {
      await this.redis.del(inFlightKey);
    }
  }

  /** `POST /assist/outcome` — B.3 outcome reporting into `SuggestionEvent` (FR-9.4). */
  async recordOutcome(
    userId: string,
    suggestionId: string,
    outcome: Outcome,
    keptChars: number,
  ): Promise<void> {
    const updated = await this.prisma.suggestionEvent.updateMany({
      where: { id: suggestionId, userId },
      data: { outcome, keptChars: Math.max(0, Math.floor(keptChars)) },
    });
    if (updated.count === 0) throw new NotFoundError('That suggestion');
    suggestionOutcome.inc({ outcome });
  }

  private async logCall(
    userId: string,
    documentId: string,
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
    // PHASES 1.4: with the mock provider the cost logged is 0 but the counter still increments.
    const cost =
      ok && usage && this.env.AI_PROVIDER !== 'mock'
        ? computeCallCost({ tier: 'fast', modelId: model, usage })
        : 0;
    if (cost > 0) aiCostMicroInr.inc({ action: 'ASSIST' }, cost);
    await this.prisma.aiCallLog.create({
      data: {
        userId,
        documentId,
        action: 'ASSIST',
        model,
        inputTokens: usage?.inputTokens ?? 0,
        cachedInputTokens: usage?.cachedInputTokens ?? 0,
        cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        costMicroInr: BigInt(cost),
        latencyMs,
        ok,
        error: ok
          ? null
          : error instanceof Error
            ? error.message.slice(0, 500)
            : String(error).slice(0, 500),
      },
    });
  }

  /** Exposed for tests: the provider in use. */
  get llm(): LlmProvider {
    return this.providers.llm;
  }
}
