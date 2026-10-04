/**
 * Chat over the library — PRD FR-4.9, §9.3 `POST /chat`, A.4, PHASES v2 W9.4.
 *
 * Streams like Assist (SSE over POST, Appendix B.8) and is metered as `CHAT`. The answer may cite
 * only the passages sent with the request; anything else is stripped and counted as
 * `HALLUCINATED_CITE` (§10.6). The conversation lives on `Document.meta.chat` — the last four
 * turns, which is all A.4 sends back — so a reload keeps the thread without a new table.
 */

import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildChatRequest,
  CHAT,
  type ChatFilters,
  type ChatTurn,
  FILTERED_OUT_REPLY,
  NAMED_EMPTY_REPLY,
  OFF_TOPIC_REPLY,
  type Providers,
  postProcessChat,
} from '@tc/ai';
import { computeCallCost, type Env } from '@tc/config';
import { isOffTopic } from '@tc/retrieval';
import { ENV } from '../../common/env.token.js';
import { ForbiddenError, NotFoundError } from '../../common/errors.js';
import {
  aiCallLatency,
  aiCostMicroInr,
  aiTtfb,
  capExceeded,
  chatOffTopic,
  hallucinatedCite,
} from '../../common/metrics.js';
import { PrismaService } from '../../common/prisma.service.js';
import { PROVIDERS } from '../ai/ai.module.js';
import { refusal, UsageService } from '../usage/usage.service.js';
import {
  BEYOND,
  BEYOND_EMPTY_REPLY,
  BEYOND_NOT_ENOUGH_REPLY,
  type BeyondPaper,
  type BeyondSetting,
  beyondFilters,
  beyondNote,
  beyondSettingOf,
  passagesFromWebResults,
  readingStep,
  searchingStep,
  WRITING_STEP,
} from './beyond-library.js';
import { ContextService } from './context.service.js';
import { passagesFromChapters } from './document-scope.js';
import { WebScopeService } from './web-scope.service.js';

/**
 * 'beyond' (ADR-0060) answers from the abstracts a scholarly search returns, through the same
 * A.4 prompt, when the library has nothing on the question.
 */
export type ChatScope = 'library' | 'document' | 'beyond';

export type ChatInput = {
  documentId: string;
  message: string;
  filters?: ChatFilters;
  /**
   * Where the answer may come from. 'library' is the uploaded sources and the default; 'document'
   * is the student's own chapters, which are passed directly rather than retrieved.
   */
  scope?: ChatScope;
  /**
   * The papers the student named with `@`. The question is answered from these alone — not from
   * the chapter's pins, and not from the rest of the library. Library scope only.
   */
  sourceIds?: string[];
};

/**
 * A citation in an answer. A library one opens its passage; a `beyond` one (ADR-0060) is a paper
 * the search found, with an empty `sourceId` — not citable in the thesis until it is added.
 */
export type ChatCitation = {
  key: string;
  sourceId: string;
  chunkId: string;
  label: string;
  beyond?: BeyondPaper;
};

/** What a beyond-library answer read, for the line under it. */
export type BeyondSummary = { papers: number; outsideLibrary: number; note: string };

export type ChatEvent =
  | { event: 'start'; data: { turn: number } }
  /** ADR-0060: what a beyond-library question is doing, shown while it runs. */
  | { event: 'step'; data: { id: 'search' | 'read' | 'write'; text: string } }
  | { event: 'token'; data: { t: string } }
  | {
      event: 'done';
      data: {
        /** The stored answer's id, which the panel rates it by; absent on a refusal. */
        turnId?: string;
        text: string;
        outcome: string;
        citations: ChatCitation[];
        passagesUsed: number;
        latencyMs: number;
        /**
         * ADR-0060, "Ask first": a library question refused as off-topic may be searched beyond
         * the library, on the student's press.
         */
        offerBeyond?: boolean;
        /** Present on an answer written from search abstracts. */
        beyond?: BeyondSummary;
      };
    };

/** What `ContextService.retrieve` returns, so the filter keeps the passage shape. */
type Retrieved = Awaited<ReturnType<ContextService['retrieve']>>;

/** How many turns are kept on the document; A.4 sends the last four back to the model. */
const KEEP_TURNS = CHAT.keepTurns * 2;

/**
 * A turn as stored on the document. The thread is trimmed from the front (KEEP_TURNS), so an
 * index is not an identity; the id is what the panel keys its list on.
 */
/** `rating`: the student's thumbs on an answer (2026-10-04); absent when not rated. */
export type StoredTurn = ChatTurn & {
  id: string;
  rating?: 1 | -1;
  citations?: ChatCitation[];
  /** ADR-0060: the answer was written from search abstracts, not the library. */
  beyond?: BeyondSummary;
};

type ChapterForChat = Parameters<ContextService['memoryBlock']>[0];

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly context: ContextService,
    private readonly web: WebScopeService,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The stored thread, for the panel to render on open. */
  async history(ownerId: string, documentId: string): Promise<{ turns: StoredTurn[] }> {
    const document = await this.owned(ownerId, documentId);
    return { turns: readTurns(document.meta) };
  }

  async clear(ownerId: string, documentId: string): Promise<{ cleared: true }> {
    const document = await this.owned(ownerId, documentId);
    const meta = (document.meta as Record<string, unknown> | null) ?? {};
    await this.prisma.document.update({
      where: { id: documentId },
      data: { meta: { ...meta, chat: { turns: [] } } },
    });
    return { cleared: true };
  }

  async *ask(
    user: { id: string; plan: string },
    input: ChatInput,
    signal: AbortSignal,
  ): AsyncGenerator<ChatEvent> {
    const document = await this.owned(user.id, input.documentId);

    // The chapter the student last worked in gives the memory block its "current chapter"; any
    // chapter of the document is a valid context for a library question.
    const chapter = await this.prisma.chapter.findFirst({
      where: { documentId: input.documentId },
      orderBy: { updatedAt: 'desc' },
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
    if (!chapter) throw new NotFoundError('That document has no chapters yet');

    const scope: ChatScope = input.scope ?? 'library';
    const beyondSetting = scope === 'document' ? 'off' : await this.beyondSetting(user.id);
    // Refused before the unit is taken, so it answers as JSON (`streamSse` pulls the first event
    // before the stream opens) and costs nothing.
    if (scope === 'beyond' && beyondSetting === 'off') {
      throw new ForbiddenError(
        'Searching beyond your library is turned off. Turn it on in Settings to ask this way.',
      );
    }

    const cap = await this.usage.consume(
      user.id,
      user.plan as Parameters<UsageService['consume']>[1],
      'CHAT',
    );
    if (!cap.ok) {
      capExceeded.inc({ action: 'CHAT' });
      throw refusal('CHAT', cap);
    }

    const history = readTurns(document.meta);
    yield { event: 'start', data: { turn: history.length / 2 + 1 } };

    const startedAt = Date.now();

    if (scope === 'beyond') {
      yield* this.answerBeyond(user, input, document, chapter, history, startedAt, signal);
      return;
    }

    // The document scope answers from the student's own chapters, which are passed directly
    // rather than retrieved: they change on every keystroke, so an index of them would be stale
    // before it was written, and skipping the embedding call also skips the Voyage rate limit.
    const ownChapters =
      scope === 'document'
        ? await this.prisma.chapter.findMany({
            where: { documentId: input.documentId },
            orderBy: { order: 'asc' },
            select: { id: true, title: true, order: true, content: true },
          })
        : [];

    const [memory, retrieved] = await Promise.all([
      this.context.memoryBlock(chapter),
      scope === 'document'
        ? Promise.resolve({
            passages: passagesFromChapters(ownChapters, input.message),
            byKey: new Map(),
            pinned: 0,
            candidates: ownChapters.length,
          })
        : this.context.retrieve(chapter, input.message, 'CHAT', {
            sourceIds: input.sourceIds ?? [],
          }),
    ]);
    const filters = input.filters ?? {};
    // Source metadata filters (year, citation count, preprint) describe published work and have
    // no meaning for the student's own chapters, so the document scope skips them rather than
    // filtering every passage out on a missing `Source` row.
    const passages =
      scope === 'document'
        ? retrieved.passages.slice(0, CHAT.topK)
        : (await this.applyFilters(retrieved, filters)).slice(0, CHAT.topK);

    // The off-topic stop, before any provider call.
    //
    // A.4 tells the model to answer only from these passages, and `postProcessChat` strips any
    // citation it was not shown — but both of those run *after* the model has been called and the
    // student charged. Nothing refused "what's the weather in Chennai?" before it cost a CHAT unit
    // and a provider call, and nothing but the model's own obedience stopped it answering from
    // general knowledge. Measured cosines put every off-topic question below 0.3 and every
    // on-topic one above it (`RELEVANCE_FLOOR`, `@tc/retrieval`), so this decides it here instead.
    //
    // The unit is refunded because the student is getting no answer. It is consumed first rather
    // than after retrieval because §10.2 requires the check and increment to precede any provider
    // call, and embedding the question is one — the same order every other metered action uses,
    // and the same refund the failure path below uses.
    // `isOffTopic` is a cosine floor, and the document scope has no cosines — its passages are
    // the student's own chapters, included because they asked about this document, not because a
    // vector search ranked them. Running the floor here would either refuse everything or need a
    // fabricated score; an empty document still refuses, which is the case that matters.
    if (passages.length === 0 || (scope === 'library' && isOffTopic(passages))) {
      // Two different refusals, and the difference matters to the student. An empty set when
      // retrieval did find something means their own filters emptied it, and the fix is a control
      // on this screen; anything else means the question is not about their library.
      const filteredOut = passages.length === 0 && retrieved.passages.length > 0;
      // Named papers with no text at all: neither off-topic nor filtered, and the fix is different.
      const namedEmpty =
        scope === 'library' && (input.sourceIds?.length ?? 0) > 0 && retrieved.candidates === 0;
      // ADR-0060. Only the off-topic refusal is offered beyond the library: a filtered-out or a
      // named-empty question is about the library, and its fix is on this screen.
      const offTopic = scope === 'library' && !filteredOut && !namedEmpty;
      if (offTopic && beyondSetting === 'on') {
        // "On": the same question goes to the search, on the unit already taken — still one CHAT
        // unit a question, refunded there if the search has nothing to read.
        chatOffTopic.inc();
        yield* this.answerBeyond(user, input, document, chapter, history, startedAt, signal);
        return;
      }
      await this.usage.refund(user.id, 'CHAT');
      const latencyMs = Date.now() - startedAt;
      const best = passages.reduce((m, p) => Math.max(m, p.cosine), 0);
      this.logger.log(
        {
          documentId: input.documentId,
          passages: passages.length,
          retrieved: retrieved.passages.length,
          bestCosine: Number(best.toFixed(3)),
        },
        filteredOut
          ? 'chat refused: the filters removed every passage'
          : 'chat refused: nothing in the library relates to the question',
      );
      if (!filteredOut) chatOffTopic.inc();
      yield {
        event: 'done',
        data: {
          text:
            scope === 'document'
              ? // A different refusal, because the fix is different: there is nothing to read,
                // not nothing relevant.
                'There is nothing written in this thesis yet for me to read. Write something first, or switch to Library to ask about your sources.'
              : namedEmpty
                ? NAMED_EMPTY_REPLY
                : filteredOut
                  ? FILTERED_OUT_REPLY
                  : OFF_TOPIC_REPLY,
          outcome: namedEmpty
            ? ('named-empty' as const)
            : filteredOut
              ? ('filtered-out' as const)
              : ('off-topic' as const),
          citations: [],
          passagesUsed: 0,
          latencyMs,
          ...(offTopic && beyondSetting === 'ask' ? { offerBeyond: true } : {}),
        },
      };
      return;
    }

    const request = buildChatRequest({
      memoryBlock: memory.text,
      question: input.message,
      history,
      passages,
      filters,
      userId: user.id,
      documentId: input.documentId,
      signal,
    });

    const { raw, latencyMs } = yield* this.stream(
      user.id,
      input.documentId,
      request,
      startedAt,
      signal,
    );

    const processed = postProcessChat(
      raw,
      passages.map((p) => p.id),
    );
    for (const key of processed.hallucinated) {
      hallucinatedCite.inc();
      this.logger.warn({ documentId: input.documentId, key }, 'HALLUCINATED_CITE');
    }

    // The keys map back to real ids so a citation in the answer opens the passage (FR-4.9).
    const citations: ChatCitation[] = processed.cited.flatMap((key) => {
      const real = retrieved.byKey.get(key);
      const passage = passages.find((p) => p.id === key);
      return real
        ? [{ key, sourceId: real.sourceId, chunkId: real.chunkId, label: passage?.shortRef ?? key }]
        : [];
    });

    const answerId = randomUUID();
    const turns: StoredTurn[] = [
      ...history,
      { id: randomUUID(), role: 'user' as const, text: input.message },
      // The citations stay with the turn (ADR-0045): without them the history rendered no
      // citation after a reload, and the stale `{{cite:S1#c1}}` ids went back to the model.
      { id: answerId, role: 'assistant' as const, text: processed.text, citations },
    ].slice(-KEEP_TURNS);
    const meta = (document.meta as Record<string, unknown> | null) ?? {};
    await this.prisma.document.update({
      where: { id: input.documentId },
      data: { meta: { ...meta, chat: { turns } } },
    });

    yield {
      event: 'done',
      data: {
        turnId: answerId,
        text: processed.text,
        outcome: processed.outcome,
        citations,
        passagesUsed: passages.length,
        latencyMs,
      },
    };
  }

  /**
   * ADR-0060: the question goes to the scholarly search (`WebScopeService`, the path
   * `POST /chat/web` uses — no model), the abstracts it returns become A.4's passages, and the
   * answer is written by the same chat prompt, so `postProcessChat` strips any citation that is
   * not one of those abstracts exactly as it does for the library (§10.6).
   *
   * The CHAT unit has already been taken by the caller; it is refunded here when the search gives
   * nothing to read, and on a failure, as the library path does.
   */
  private async *answerBeyond(
    user: { id: string },
    input: ChatInput,
    document: { meta: unknown },
    chapter: ChapterForChat,
    history: StoredTurn[],
    startedAt: number,
    signal: AbortSignal,
  ): AsyncGenerator<ChatEvent> {
    yield { event: 'step', data: { id: 'search', text: searchingStep(this.web.indexNames()) } };

    const filters = beyondFilters(input.filters ?? {});
    let built: ReturnType<typeof passagesFromWebResults>;
    let memory: Awaited<ReturnType<ContextService['memoryBlock']>>;
    try {
      const [found, block] = await Promise.all([
        this.web.search(user.id, input.documentId, input.message, signal, BEYOND.candidates),
        this.context.memoryBlock(chapter),
      ]);
      built = passagesFromWebResults(found.results, filters);
      memory = block;
    } catch (error) {
      await this.usage.refund(user.id, 'CHAT');
      throw error;
    }

    if (built.passages.length === 0) {
      // Nothing to read, so no model call and no charge — the relevance floor's refund.
      await this.usage.refund(user.id, 'CHAT');
      this.logger.log({ documentId: input.documentId }, 'chat beyond: nothing with an abstract');
      yield {
        event: 'done',
        data: {
          text: BEYOND_EMPTY_REPLY,
          outcome: 'beyond-empty',
          citations: [],
          passagesUsed: 0,
          latencyMs: Date.now() - startedAt,
        },
      };
      return;
    }

    yield { event: 'step', data: { id: 'read', text: readingStep(built.passages.length) } };

    const request = buildChatRequest({
      memoryBlock: memory.text,
      question: input.message,
      history,
      passages: built.passages,
      filters,
      userId: user.id,
      documentId: input.documentId,
      signal,
    });
    yield { event: 'step', data: { id: 'write', text: WRITING_STEP } };

    const { raw, latencyMs } = yield* this.stream(
      user.id,
      input.documentId,
      request,
      startedAt,
      signal,
    );

    const processed = postProcessChat(
      raw,
      built.passages.map((p) => p.id),
    );
    for (const key of processed.hallucinated) {
      hallucinatedCite.inc();
      this.logger.warn({ documentId: input.documentId, key }, 'HALLUCINATED_CITE');
    }
    // A.4's "not enough" reply names the library; here it was the search that had nothing.
    const notEnough = processed.outcome === 'not-enough';
    const text = notEnough ? BEYOND_NOT_ENOUGH_REPLY : processed.text;
    const citations: ChatCitation[] = notEnough
      ? []
      : processed.cited.flatMap((key) => {
          const paper = built.papers.get(key);
          const passage = built.passages.find((p) => p.id === key);
          return paper
            ? [{ key, sourceId: '', chunkId: '', label: passage?.shortRef ?? key, beyond: paper }]
            : [];
        });
    const outsideLibrary = [...built.papers.values()].filter((p) => !p.inLibrary).length;
    const beyond: BeyondSummary = {
      papers: built.passages.length,
      outsideLibrary,
      note: beyondNote(built.passages.length, outsideLibrary),
    };

    const answerId = randomUUID();
    const turns: StoredTurn[] = [
      ...history,
      { id: randomUUID(), role: 'user' as const, text: input.message },
      {
        id: answerId,
        role: 'assistant' as const,
        text,
        citations,
        ...(notEnough ? {} : { beyond }),
      },
    ].slice(-KEEP_TURNS);
    const meta = (document.meta as Record<string, unknown> | null) ?? {};
    await this.prisma.document.update({
      where: { id: input.documentId },
      data: { meta: { ...meta, chat: { turns } } },
    });

    yield {
      event: 'done',
      data: {
        turnId: answerId,
        text,
        outcome: notEnough ? 'beyond-not-enough' : processed.outcome,
        citations,
        passagesUsed: built.passages.length,
        latencyMs,
        ...(notEnough ? {} : { beyond }),
      },
    };
  }

  /** The model call and its logging, shared by the library and beyond paths. */
  private async *stream(
    userId: string,
    documentId: string,
    request: ReturnType<typeof buildChatRequest>,
    startedAt: number,
    signal: AbortSignal,
  ): AsyncGenerator<ChatEvent, { raw: string; latencyMs: number }> {
    let raw = '';
    let ttfbMs: number | null = null;
    let modelId = this.providers.llm.modelIdFor('fast');
    try {
      for await (const chunk of this.providers.llm.stream(request)) {
        if (signal.aborted) break;
        if (chunk.type === 'text') {
          if (ttfbMs === null) {
            ttfbMs = Date.now() - startedAt;
            aiTtfb.observe({ action: 'CHAT' }, ttfbMs);
          }
          raw += chunk.text;
          yield { event: 'token', data: { t: chunk.text } };
        } else {
          modelId = chunk.modelId;
          await this.log(userId, documentId, modelId, chunk.usage, Date.now() - startedAt, true);
        }
      }
    } catch (error) {
      await this.usage.refund(userId, 'CHAT');
      await this.log(userId, documentId, modelId, null, Date.now() - startedAt, false, error);
      throw error;
    }
    const latencyMs = Date.now() - startedAt;
    aiCallLatency.observe({ action: 'CHAT', tier: 'fast' }, latencyMs);
    return { raw, latencyMs };
  }

  private async beyondSetting(userId: string): Promise<BeyondSetting> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });
    return beyondSettingOf(row?.settings);
  }

  /**
   * FR-4.9's filters, applied before the prompt is built so A.4's "passages outside the filter
   * were already removed" is true. The metadata is on `Source`, so it is read once per ask and
   * only when a filter is actually set.
   */
  private async applyFilters(
    retrieved: Retrieved,
    filters: ChatFilters,
  ): Promise<Retrieved['passages']> {
    const active =
      Boolean(filters.yearFrom) ||
      Boolean(filters.yearTo) ||
      Boolean(filters.minCitations) ||
      Boolean(filters.minJournalCitedness) ||
      Boolean(filters.excludePreprints);
    if (!active) return [...retrieved.passages];

    const sourceIds = [...new Set([...retrieved.byKey.values()].map((v) => v.sourceId))];
    const sources = await this.prisma.source.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true, year: true, citationCount: true, venueCitedness: true, isPreprint: true },
    });
    const byId = new Map(sources.map((row) => [row.id, row]));

    return retrieved.passages.filter((passage) => {
      const sourceId = retrieved.byKey.get(passage.id)?.sourceId;
      const info = sourceId ? byId.get(sourceId) : undefined;
      if (!info) return true;
      if (filters.yearFrom && (info.year ?? 0) < filters.yearFrom) return false;
      if (filters.yearTo && (info.year ?? 9_999) > filters.yearTo) return false;
      if (filters.minCitations && (info.citationCount ?? 0) < filters.minCitations) return false;
      // Unknown is not zero, and it is not "at least N" either: an unmeasured journal is left out.
      if (
        filters.minJournalCitedness &&
        (info.venueCitedness === null || info.venueCitedness < filters.minJournalCitedness)
      ) {
        return false;
      }
      if (filters.excludePreprints && info.isPreprint) return false;
      return true;
    });
  }

  private async owned(ownerId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true, meta: true },
    });
    if (!document) throw new NotFoundError('That document');
    return document;
  }

  /**
   * Thumbs on an answer (2026-10-04, from the Jenni study). Kept on the turn in the stored
   * conversation, and logged, because the turn itself rolls off after four. No model call.
   */
  async rate(
    ownerId: string,
    documentId: string,
    turnId: string,
    rating: 1 | -1 | 0,
  ): Promise<{ ok: true }> {
    const document = await this.owned(ownerId, documentId);
    const turns = readTurns(document.meta);
    const turn = turns.find((t) => t.id === turnId && t.role === 'assistant');
    if (!turn) throw new NotFoundError('That answer');
    const next = turns.map((t) =>
      t.id === turnId ? { ...t, rating: rating === 0 ? undefined : rating } : t,
    );
    const meta = (document.meta as Record<string, unknown> | null) ?? {};
    await this.prisma.document.update({
      where: { id: documentId },
      data: { meta: { ...meta, chat: { turns: next } } },
    });
    this.logger.log({ documentId, turnId, rating }, 'chat answer rated');
    return { ok: true };
  }

  private async log(
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
    const cost =
      ok && usage && this.env.AI_PROVIDER !== 'mock'
        ? computeCallCost({ tier: 'fast', modelId: model, usage })
        : 0;
    if (cost > 0) aiCostMicroInr.inc({ action: 'CHAT' }, cost);
    await this.prisma.aiCallLog.create({
      data: {
        userId,
        documentId,
        action: 'CHAT',
        model,
        inputTokens: usage?.inputTokens ?? 0,
        cachedInputTokens: usage?.cachedInputTokens ?? 0,
        cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        costMicroInr: BigInt(cost),
        latencyMs,
        ok,
        error: ok ? null : String(error instanceof Error ? error.message : error).slice(0, 500),
      },
    });
  }
}

function readTurns(meta: unknown): StoredTurn[] {
  const turns = (meta as { chat?: { turns?: unknown } } | null)?.chat?.turns;
  if (!Array.isArray(turns)) return [];
  return turns
    .filter(
      (t): t is StoredTurn =>
        typeof t === 'object' &&
        t !== null &&
        (('role' in t && (t as ChatTurn).role === 'user') ||
          (t as ChatTurn).role === 'assistant') &&
        typeof (t as ChatTurn).text === 'string',
    )
    .map((t) => ({ ...t, id: t.id ?? randomUUID() }))
    .slice(-KEEP_TURNS);
}
