/**
 * Assist mode — PRD §9.3 `/assist/suggest`, FR-4.3, Appendix B.8 (transport), A.1 (prompt),
 * §10.2 (call sequence: cap → prompt → call → parse → AiCallLog → ledger), §11.5.
 *
 * Week 1 scope (PHASES 1.4): the transport, the cap, the single-in-flight guard, timers,
 * `SuggestionEvent`, and a *placeholder* prompt. Retrieval, the cached/volatile builder and
 * memory trimming arrive in week 3 (PHASES 3.2–3.4) and replace `buildPlaceholderRequest`.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { type LlmProvider, type LlmRequest, loadPrompt, type Providers } from '@tc/ai';
import { computeCallCost, type Env } from '@tc/config';
import { Redis } from 'ioredis';
import { ENV } from '../../common/env.token.js';
import { CapExceededError, ConflictError, NotFoundError } from '../../common/errors.js';
import {
  aiCallLatency,
  aiCostMicroInr,
  aiTtfb,
  capExceeded,
  suggestionOutcome,
} from '../../common/metrics.js';
import { PrismaService } from '../../common/prisma.service.js';
import { RedisService } from '../../common/redis.service.js';
import { PROVIDERS } from '../ai/ai.module.js';
import { UsageService } from '../usage/usage.service.js';

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
        citations: SuggestCitation[];
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

const CITE_RE = /\{\{cite:([^}]+)\}\}/g;

@Injectable()
export class AssistService {
  private readonly logger = new Logger(AssistService.name);
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    redis: RedisService,
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
      select: { id: true, title: true, scopeNote: true, documentId: true },
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
        throw new CapExceededError('ASSIST', cap.cap, cap.resetsAt);
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

      const request = this.buildPlaceholderRequest(user.id, chapter, input, signal);
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

      const empty = text.trim().length === 0;
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
          data: { shownChars: text.length, latencyMs, ttfbMs },
        });
        suggestionOutcome.inc({ outcome: 'SHOWN' });
      }

      yield {
        event: 'done',
        data: {
          suggestionId: event.id,
          citations: this.citationsFor(text),
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

  /**
   * Week-1 stub for the `done.citations[]` payload (B.8): every `{{cite:ID}}` the model emitted
   * becomes an entry keyed by that ID with no resolved source. Week 3 (PHASES 3.4–3.5) replaces
   * this with the retrieval whitelist: ids not in the retrieved set are stripped and counted as
   * HALLUCINATED_CITE (§10.6); resolved ones carry sourceId/chunkId and a rendered label.
   */
  private citationsFor(text: string): SuggestCitation[] {
    const seen = new Set<string>();
    const out: SuggestCitation[] = [];
    for (const match of text.matchAll(CITE_RE)) {
      const key = match[1] ?? '';
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ key, sourceId: null, chunkId: null, rendered: '(Source, n.d.)' });
    }
    return out;
  }

  /**
   * TODO(prd): PHASES 3.2 — replace with the real prompt builder (cached block = A.0 + A.0.1 with
   * memory trimming; volatile block = title, pinned sources, retrieved passages, before/after).
   * This week the system block is A.0 + the A.1 task block verbatim (§0.3 rule 11: prompt text is
   * loaded from files, never rewritten) and the user message is A.1's template with no passages.
   */
  private buildPlaceholderRequest(
    userId: string,
    chapter: { id: string; title: string; scopeNote: string | null; documentId: string },
    input: SuggestInput,
    signal: AbortSignal,
  ): LlmRequest {
    const preamble = loadPrompt('_preamble').system;
    const assist = loadPrompt('assist');
    const user = (assist.user ?? '')
      .replace(/\{\{#each passages\}\}[\s\S]*?\{\{\/each\}\}\n?/g, '')
      .replace('{{chapter.title}}', chapter.title)
      .replace('{{chapter.scopeNote}}', chapter.scopeNote ?? '')
      .replace('{{before}}', input.before)
      .replace('{{after}}', input.after)
      .replace('{{instruction_or_none}}', input.guided?.trim() || 'none');

    return {
      tier: 'fast',
      system: { cached: `${preamble}\n\n${assist.system}` },
      messages: [{ role: 'user', content: user }],
      maxTokens: 120,
      temperature: 0.4,
      action: 'ASSIST',
      userId,
      documentId: chapter.documentId,
      signal,
    };
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
