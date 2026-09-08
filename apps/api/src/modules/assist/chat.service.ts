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
  type Providers,
  postProcessChat,
} from '@tc/ai';
import { computeCallCost, type Env } from '@tc/config';
import { ENV } from '../../common/env.token.js';
import { NotFoundError } from '../../common/errors.js';
import {
  aiCallLatency,
  aiCostMicroInr,
  aiTtfb,
  capExceeded,
  hallucinatedCite,
} from '../../common/metrics.js';
import { PrismaService } from '../../common/prisma.service.js';
import { PROVIDERS } from '../ai/ai.module.js';
import { refusal, UsageService } from '../usage/usage.service.js';
import { ContextService } from './context.service.js';

export type ChatInput = {
  documentId: string;
  message: string;
  filters?: ChatFilters;
};

export type ChatEvent =
  | { event: 'start'; data: { turn: number } }
  | { event: 'token'; data: { t: string } }
  | {
      event: 'done';
      data: {
        text: string;
        outcome: string;
        citations: Array<{ key: string; sourceId: string; chunkId: string; label: string }>;
        passagesUsed: number;
        latencyMs: number;
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
export type StoredTurn = ChatTurn & { id: string };

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly context: ContextService,
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
    const [memory, retrieved] = await Promise.all([
      this.context.memoryBlock(chapter),
      this.context.retrieve(chapter, input.message, 'CHAT'),
    ]);
    const filters = input.filters ?? {};
    const passages = (await this.applyFilters(retrieved, filters)).slice(0, CHAT.topK);

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
          await this.log(
            user.id,
            input.documentId,
            modelId,
            chunk.usage,
            Date.now() - startedAt,
            true,
          );
        }
      }
    } catch (error) {
      await this.usage.refund(user.id, 'CHAT');
      await this.log(
        user.id,
        input.documentId,
        modelId,
        null,
        Date.now() - startedAt,
        false,
        error,
      );
      throw error;
    }

    const latencyMs = Date.now() - startedAt;
    aiCallLatency.observe({ action: 'CHAT', tier: 'fast' }, latencyMs);

    const processed = postProcessChat(
      raw,
      passages.map((p) => p.id),
    );
    for (const key of processed.hallucinated) {
      hallucinatedCite.inc();
      this.logger.warn({ documentId: input.documentId, key }, 'HALLUCINATED_CITE');
    }

    // The keys map back to real ids so a citation in the answer opens the passage (FR-4.9).
    const citations = processed.cited.flatMap((key) => {
      const real = retrieved.byKey.get(key);
      const passage = passages.find((p) => p.id === key);
      return real
        ? [{ key, sourceId: real.sourceId, chunkId: real.chunkId, label: passage?.shortRef ?? key }]
        : [];
    });

    const turns: StoredTurn[] = [
      ...history,
      { id: randomUUID(), role: 'user' as const, text: input.message },
      { id: randomUUID(), role: 'assistant' as const, text: processed.text },
    ].slice(-KEEP_TURNS);
    const meta = (document.meta as Record<string, unknown> | null) ?? {};
    await this.prisma.document.update({
      where: { id: input.documentId },
      data: { meta: { ...meta, chat: { turns } } },
    });

    yield {
      event: 'done',
      data: {
        text: processed.text,
        outcome: processed.outcome,
        citations,
        passagesUsed: passages.length,
        latencyMs,
      },
    };
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
      Boolean(filters.excludePreprints);
    if (!active) return [...retrieved.passages];

    const sourceIds = [...new Set([...retrieved.byKey.values()].map((v) => v.sourceId))];
    const sources = await this.prisma.source.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true, year: true, citationCount: true, isPreprint: true },
    });
    const byId = new Map(sources.map((row) => [row.id, row]));

    return retrieved.passages.filter((passage) => {
      const sourceId = retrieved.byKey.get(passage.id)?.sourceId;
      const info = sourceId ? byId.get(sourceId) : undefined;
      if (!info) return true;
      if (filters.yearFrom && (info.year ?? 0) < filters.yearFrom) return false;
      if (filters.yearTo && (info.year ?? 9_999) > filters.yearTo) return false;
      if (filters.minCitations && (info.citationCount ?? 0) < filters.minCitations) return false;
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
