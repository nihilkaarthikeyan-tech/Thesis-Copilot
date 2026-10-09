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
import {
  buildAssistRequest,
  type LlmProvider,
  type Providers,
  postProcessAssist,
  REWORD_INSTRUCTION,
} from '@tc/ai';
import { computeCallCost, type Env } from '@tc/config';
import { closeToPassages, isOffTopic } from '@tc/retrieval';
import { findOutlineNode, readOutline, scopeWithSection, sectionUnderHeading } from '@tc/types';
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
import { AutoSourcesService, enoughPapersOnTopic, sourcesQuery } from './auto-sources.service.js';
import { ContextService } from './context.service.js';
import { docToText } from './doc-text.js';

export type SuggestInput = {
  chapterId: string;
  before: string;
  after: string;
  guided?: string;
  /**
   * Jenni build plan R3. `none`: every citation is stripped in code, whatever the model writes.
   * `library`: only the papers the student added themselves; when none of them is about the
   * sentence, the student is told so and the unit goes back (Jenni says nothing).
   */
  citeMode?: 'none' | 'library';
  cursorContext?: { blockType?: string; section?: string };
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
        /** ADR-0037: nothing in the library was on topic, and a search for papers has started. */
        findingSources: boolean;
        /** ADR-0082: the first answer reused a passage's wording and was asked for again. */
        reworded?: boolean;
        /**
         * ADR-0070: nothing could be retrieved because the library is still filling (a search is
         * running or papers are being read). Whatever the model wrote cites nothing; the editor
         * says citations will follow, and asks again by itself once a paper is ready.
         */
        papersLoading?: boolean;
        /** ADR-0071: the suggestion reuses the wording of a passage it cites. */
        closeTo?: {
          shortRef: string;
          page: number | null;
          overlapText: string;
          kind: 'verbatim' | 'close';
        } | null;
        /** A.1: what the model said no passage covers, when it wrote nothing for that reason. */
        needsSource: string | null;
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
    private readonly autoSources: AutoSourcesService,
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
      const [memory, retrieved, settings, stored] = await Promise.all([
        this.context.memoryBlock(chapter),
        // ADR-0085: within the pins of the section under the cursor, when it has any.
        this.context.retrieve(chapter, input.before, 'ASSIST', {
          section: input.cursorContext?.section ?? null,
          ...(input.citeMode === 'library'
            ? { sourceIds: await this.context.ownSourceIds(chapter.documentId) }
            : {}),
        }),
        // §2.2's citation toggle, per user and independent of automatic-suggest (ADR-0006).
        this.prisma.user.findUnique({ where: { id: user.id }, select: { settings: true } }),
        this.prisma.documentMemory.findUnique({
          where: { documentId: chapter.documentId },
          select: { outline: true },
        }),
      ]);
      // R3: "Cite from my library" with nothing of the student's own on this sentence. Said in
      // words before any provider call, and the unit goes back.
      if (input.citeMode === 'library' && isOffTopic(retrieved.passages)) {
        await this.usage.refund(user.id, 'ASSIST');
        await this.prisma.suggestionEvent.update({
          where: { id: event.id },
          data: { outcome: 'CANCELLED', latencyMs: Date.now() - startedAt },
        });
        yield {
          event: 'error',
          data: {
            code: 'NO_LIBRARY_MATCH',
            message:
              'None of the papers you added yourself is about this sentence, so the suggestion you had is back, unchanged. Add a paper on it to your library to cite your own.',
          },
        };
        return;
      }
      // Fix list A21 (2026-10-04): under a sub-section heading, that section's own note is read
      // after the chapter's, so a suggestion in "2.3 Credit" is about credit.
      const scopeNote = scopeWithSection(
        chapter.scopeNote,
        sectionUnderHeading(
          findOutlineNode(readOutline(stored?.outline), chapter.outlineNodeId),
          input.cursorContext?.section,
        ),
      );
      // ADR-0037: nothing in the library is on this topic, so ask the worker to find papers on
      // it. Started now and awaited only at the end, so the suggestion is not held up by it.
      // ADR-0087: "nothing" became "fewer than three papers", and each section searches once.
      // R3: a student asking for their own papers has not asked for new ones.
      const findingSources =
        input.citeMode === 'library' || enoughPapersOnTopic(retrieved.passages)
          ? Promise.resolve(false)
          : this.autoSources
              .start({
                documentId: chapter.documentId,
                userId: user.id,
                chapterId: chapter.id,
                query: sourcesQuery(chapter.title, scopeNote, input.before),
                section: input.cursorContext?.section ?? null,
              })
              .catch((error: unknown) => {
                this.logger.warn({ err: error }, 'could not start a source search');
                return false;
              });
      // ADR-0070: an empty library that is still filling. The model is still asked — it may
      // write a sentence that needs no source — and the editor is told the papers are on their
      // way, so an empty answer reads as "wait" and the editor asks again when one is ready.
      const papersLoading =
        retrieved.passages.length === 0
          ? findingSources.then(async (started) => {
              if (started) return true;
              const progress = await this.autoSources
                .progress(chapter.documentId)
                .catch(() => ({ searching: false, reading: 0 }));
              return progress.searching || progress.reading > 0;
            })
          : Promise.resolve(false);
      // PRD 2.2: auto-cite is on unless the student turned it off in settings.
      const userSettings = (settings?.settings ?? {}) as Record<string, unknown>;
      // R3: "Re-write without citations" turns citing off for this one suggestion.
      const autoCite = input.citeMode !== 'none' && userSettings.autoCite !== false;
      const request = buildAssistRequest({
        memoryBlock: memory.text,
        chapter: { title: chapter.title, scopeNote },
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
        // The chapter as it stands, so a sentence already in it is not offered again.
        existingText: docToText(chapter.content),
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

      // A.1: the model named what is missing. That is a better search than the chapter's own
      // words, so it starts one if none is already running (the cooldown makes a repeat a no-op).
      const searchStarted =
        processed.needsSource && !(await findingSources)
          ? this.autoSources
              .start({
                documentId: chapter.documentId,
                userId: user.id,
                chapterId: chapter.id,
                query: `${processed.needsSource}. ${chapter.title}`,
              })
              .catch(() => false)
          : findingSources;

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

      // ADR-0071: does the suggestion reuse the wording of a passage it cites? Said before the
      // student keeps it; nothing is rewritten (flag, don't fix).
      const cited = new Set(processed.cited);
      const match = processed.text
        ? closeToPassages(
            processed.text,
            retrieved.passages
              .filter((p) => cited.has(p.id))
              .map((p) => ({
                chunkId: p.chunkId,
                sourceId: p.sourceId,
                shortRef: p.shortRef,
                page: p.page,
                text: p.text,
              })),
          )
        : null;
      let closeTo = match
        ? {
            shortRef: match.shortRef,
            page: match.page,
            overlapText: match.overlapText,
            kind: match.kind,
          }
        : null;

      // ADR-0082: a suggestion that reuses a passage's wording is asked for once more, in the
      // student's own words, before it is shown as final — on the same unit, the second call
      // logged like the first. The flag stays if the rewording is still close; nothing is ever
      // rewritten silently after the student has it (flag, don't fix holds at the keep).
      let finalText = processed.text;
      let finalCitations = citations;
      let reworded = false;
      if (match && processed.text && !signal.aborted) {
        const rewordStarted = Date.now();
        const second = buildAssistRequest({
          memoryBlock: memory.text,
          chapter: { title: chapter.title, scopeNote },
          passages: retrieved.passages,
          before: input.before,
          after: input.after,
          instruction: [REWORD_INSTRUCTION, input.guided?.trim() || ''].filter(Boolean).join(' '),
          userId: user.id,
          documentId: chapter.documentId,
          signal,
        });
        try {
          let again = '';
          let secondModel = modelId;
          for await (const chunk of this.providers.llm.stream(second)) {
            if (signal.aborted) break;
            if (chunk.type === 'text') again += chunk.text;
            else {
              secondModel = chunk.modelId;
              await this.logCall(
                user.id,
                chapter.documentId,
                secondModel,
                chunk.usage,
                Date.now() - rewordStarted,
                true,
              );
            }
          }
          const redone = postProcessAssist({
            output: again,
            passageIds: retrieved.passages.map((p) => p.id),
            before: input.before,
            autoCite,
            existingText: docToText(chapter.content),
          });
          const redoneCited = new Set(redone.cited);
          const stillClose = redone.text
            ? closeToPassages(
                redone.text,
                retrieved.passages
                  .filter((p) => redoneCited.has(p.id))
                  .map((p) => ({
                    chunkId: p.chunkId,
                    sourceId: p.sourceId,
                    shortRef: p.shortRef,
                    page: p.page,
                    text: p.text,
                  })),
              )
            : null;
          // Kept only when it is an improvement: text, cited, and no longer close (or at least
          // no longer verbatim).
          if (
            !redone.empty &&
            redone.cited.length > 0 &&
            (!stillClose || (match.kind === 'verbatim' && stillClose.kind === 'close'))
          ) {
            finalText = redone.text;
            finalCitations = redone.cited.map((key) => {
              const real = retrieved.byKey.get(key);
              return {
                key,
                sourceId: real?.sourceId ?? null,
                chunkId: real?.chunkId ?? null,
                rendered: real ? `(${real.shortRef})` : '(Source)',
              };
            });
            closeTo = stillClose
              ? {
                  shortRef: stillClose.shortRef,
                  page: stillClose.page,
                  overlapText: stillClose.overlapText,
                  kind: stillClose.kind,
                }
              : null;
            reworded = true;
            await this.prisma.suggestionEvent.update({
              where: { id: event.id },
              data: { shownChars: finalText.length },
            });
          }
          this.logger.log(
            { suggestionId: event.id, reworded, stillClose: stillClose?.kind ?? null },
            'ASSIST_REWORD',
          );
        } catch (error) {
          if (signal.aborted) return;
          // The first answer stands, flagged; the rewording was a courtesy that failed.
          this.logger.warn({ err: error, suggestionId: event.id }, 'assist reword failed');
        }
      }

      yield {
        event: 'done',
        data: {
          suggestionId: event.id,
          text: finalText,
          closeTo,
          reworded,
          citations: finalCitations,
          grounded: retrieved.passages.length > 0,
          pinned: retrieved.pinned,
          findingSources: await searchStarted,
          papersLoading: await papersLoading,
          needsSource: processed.needsSource,
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
    // ADR-0144: a suggestion kept, whole or in part, is what counts against the allowance —
    // once per suggestion, however often the editor reports it. A dismissed one never does.
    if ((outcome === 'ACCEPTED' || outcome === 'PARTIAL') && keptChars > 0) {
      await this.usage.keep(userId, suggestionId);
    }
  }

  /** A thumbs up (1), down (-1) or cleared (0) on the student's own suggestion. */
  async recordRating(userId: string, suggestionId: string, rating: 1 | -1 | 0): Promise<void> {
    const updated = await this.prisma.suggestionEvent.updateMany({
      where: { id: suggestionId, userId },
      data: { rating: rating === 0 ? null : rating },
    });
    if (updated.count === 0) throw new NotFoundError('That suggestion');
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
