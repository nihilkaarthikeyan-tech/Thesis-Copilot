/**
 * A research question asked with no thesis — ADR-0132, Jenni build plan R30/R32.
 *
 * Jenni lets a student ask a research question before or outside any document. Ours is asked on
 * the thesis list ("Ask a research question"), and answered exactly as ADR-0060's "beyond the
 * library" question is: the scholarly search (`WebScopeService.search`, no model) returns
 * abstracts, the abstracts are A.4's passages (`passagesFromWebResults`), and the answer is the
 * existing A.4 builder with `postProcessChat`, which strips and counts as `HALLUCINATED_CITE` any
 * citation of a passage that was not sent (§10.6). No new prompt (rule 6).
 *
 * - **One CHAT unit a question**, taken in one atomic statement (`UsageService.consume`) before
 *   any provider call, refunded when the search has nothing to read, when nothing it found is near
 *   the question (the relevance floor), and when the search or the model fails.
 * - **The relevance floor**, as a library question has it (`RELEVANCE_FLOOR`): the question and
 *   the abstracts are embedded once (logged as `EMBED`), abstracts under the floor are dropped,
 *   and when none is left the question is refused in the server's words, for nothing.
 * - **The setting**: "Search beyond my library" off means no search, here as anywhere; asking is
 *   refused with 403 before the unit is taken. "Ask first" is answered by the press itself.
 * - **The student's own**: `ResearchChat.userId`. Every query is scoped by it; anything else is a
 *   404. Nothing here writes to a thesis: "Start a thesis from this" and "Add to a thesis…" are
 *   the ordinary `POST /documents` and `/sources/resolve`, on the student's press.
 */

import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { buildChatRequest, type ChatFilters, type Providers, postProcessChat } from '@tc/ai';
import type { Env } from '@tc/config';
import type { Prisma } from '@tc/db';
import { cosine, RELEVANCE_FLOOR, researchEmbedText } from '@tc/retrieval';
import { ENV } from '../../common/env.token.js';
import { ForbiddenError, NotFoundError } from '../../common/errors.js';
import { capExceeded, chatOffTopic, hallucinatedCite } from '../../common/metrics.js';
import { PrismaService } from '../../common/prisma.service.js';
import { PROVIDERS } from '../ai/ai.module.js';
import { refusal, UsageService } from '../usage/usage.service.js';
import {
  BEYOND,
  BEYOND_EMPTY_REPLY,
  BEYOND_NOT_ENOUGH_REPLY,
  type BeyondPaper,
  type BeyondPassages,
  beyondFilters,
  beyondSettingOf,
  passagesFromWebResults,
  readingStep,
  searchingStep,
  WRITING_STEP,
} from './beyond-library.js';
import type { ChatEvent } from './chat.service.js';
import { ChatService } from './chat.service.js';
import {
  type BeyondSummary,
  type ChatCitation,
  questionCount,
  readTurns,
  type StoredTurn,
  threadTitle,
} from './chat-threads.js';
import {
  NO_THESIS_OFF_TOPIC_REPLY,
  noThesisMemoryBlock,
  noThesisNote,
  papersOfChat,
  RESEARCH_CHAT,
  thesisTitleFrom,
} from './research-chat.js';
import { WebScopeService } from './web-scope.service.js';

export type ResearchChatInput = {
  message: string;
  /** The chat to continue; absent starts a new one (a row once its first answer is stored). */
  chatId?: string | undefined;
  filters?: ChatFilters | undefined;
};

/** One chat as the page opens it. */
export type ResearchChatView = {
  id: string;
  title: string;
  turns: StoredTurn[];
  /** Every paper its answers cited, once — what "Start a thesis from this" offers to add. */
  papers: BeyondPaper[];
  /** The working title "Start a thesis from this" suggests: the first question. */
  suggestedTitle: string;
  createdAt: string;
  updatedAt: string;
};

export type ResearchChatSummary = {
  id: string;
  title: string;
  questions: number;
  createdAt: string;
  updatedAt: string;
};

@Injectable()
export class ResearchChatService {
  private readonly logger = new Logger(ResearchChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly web: WebScopeService,
    private readonly chat: ChatService,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Asks one question. Every refusal that costs nothing (the setting, a chat that is not the
   * student's) is thrown before the first event, so `streamSse` answers it as JSON.
   */
  async *ask(
    user: { id: string; plan: string },
    input: ResearchChatInput,
    signal: AbortSignal,
  ): AsyncGenerator<ChatEvent> {
    const settings = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { settings: true },
    });
    if (beyondSettingOf(settings?.settings) === 'off') {
      throw new ForbiddenError(
        'Searching the literature is turned off in Settings ("Search beyond my library"). Turn it on to ask a research question here.',
      );
    }
    let history: StoredTurn[] = [];
    if (input.chatId) {
      const row = await this.prisma.researchChat.findFirst({
        where: { id: input.chatId, userId: user.id },
        select: { turns: true },
      });
      if (!row) throw new NotFoundError('That chat');
      history = readTurns(row.turns);
    }

    // §10.2: the cap check and the increment in one statement, before any provider call.
    const cap = await this.usage.consume(
      user.id,
      user.plan as Parameters<UsageService['consume']>[1],
      'CHAT',
    );
    if (!cap.ok) {
      capExceeded.inc({ action: 'CHAT' });
      throw refusal('CHAT', cap);
    }

    const startedAt = Date.now();
    yield { event: 'start', data: { turn: history.length / 2 + 1 } };
    yield { event: 'step', data: { id: 'search', text: searchingStep(this.web.indexNames()) } };

    const filters = beyondFilters(input.filters ?? {});
    let built: BeyondPassages;
    try {
      const found = await this.web.search(user.id, null, input.message, signal, BEYOND.candidates);
      built = passagesFromWebResults(found.results, filters);
    } catch (error) {
      await this.usage.refund(user.id, 'CHAT');
      throw error;
    }

    const refused = (text: string, outcome: string): ChatEvent => ({
      event: 'done',
      data: {
        text,
        outcome,
        citations: [],
        passagesUsed: 0,
        latencyMs: Date.now() - startedAt,
        ...(input.chatId ? { threadId: input.chatId } : {}),
      },
    });

    if (built.passages.length === 0) {
      // Nothing to read: no model call, no charge.
      await this.usage.refund(user.id, 'CHAT');
      yield refused(BEYOND_EMPTY_REPLY, 'beyond-empty');
      return;
    }

    const kept = await this.relevant(user.id, input.message, built, signal);
    if (kept.passages.length === 0) {
      chatOffTopic.inc();
      await this.usage.refund(user.id, 'CHAT');
      this.logger.log({ userId: user.id }, 'research chat: nothing near the question');
      yield refused(NO_THESIS_OFF_TOPIC_REPLY, 'off-topic');
      return;
    }

    yield { event: 'step', data: { id: 'read', text: readingStep(kept.passages.length) } };
    const request = buildChatRequest({
      memoryBlock: noThesisMemoryBlock(),
      question: input.message,
      history,
      passages: kept.passages,
      filters,
      userId: user.id,
      signal,
      tier: this.env.AI_CHAT_TIER,
    });
    yield { event: 'step', data: { id: 'write', text: WRITING_STEP } };

    // Refunds the unit itself if the model call fails.
    const { raw, latencyMs } = yield* this.chat.stream(user.id, null, request, startedAt, signal);

    const processed = postProcessChat(
      raw,
      kept.passages.map((p) => p.id),
    );
    for (const key of processed.hallucinated) {
      hallucinatedCite.inc();
      this.logger.warn({ userId: user.id, key }, 'HALLUCINATED_CITE');
    }
    const notEnough = processed.outcome === 'not-enough';
    const text = notEnough ? BEYOND_NOT_ENOUGH_REPLY : processed.text;
    const outcome = notEnough ? 'beyond-not-enough' : processed.outcome;
    const citations: ChatCitation[] = notEnough
      ? []
      : processed.cited.flatMap((key) => {
          const paper = kept.papers.get(key);
          const passage = kept.passages.find((p) => p.id === key);
          return paper
            ? [{ key, sourceId: '', chunkId: '', label: passage?.shortRef ?? key, beyond: paper }]
            : [];
        });
    const beyond: BeyondSummary = {
      papers: kept.passages.length,
      outsideLibrary: kept.passages.length,
      note: noThesisNote(kept.passages.length),
    };

    const answerId = randomUUID();
    const turns: StoredTurn[] = [
      ...history,
      { id: randomUUID(), role: 'user', text: input.message },
      {
        id: answerId,
        role: 'assistant',
        text,
        citations,
        ...(outcome === 'answered' ? {} : { outcome }),
        ...(notEnough ? {} : { beyond }),
      },
    ];
    const chatId = await this.save(user.id, input.chatId ?? null, turns, input.message);

    yield {
      event: 'done',
      data: {
        turnId: answerId,
        text,
        outcome,
        citations,
        passagesUsed: kept.passages.length,
        latencyMs,
        ...(notEnough ? {} : { beyond }),
        threadId: chatId,
      },
    };
  }

  /**
   * The relevance floor over the abstracts: one embedding call (question and abstracts, logged
   * as `EMBED` so the ₹100 ceiling sees it), abstracts under `RELEVANCE_FLOOR` dropped. If the
   * embedding fails the abstracts are kept, as ADR-0060's answer from abstracts has always had
   * them: the floor is a guard against a question about nothing, not a reason to fail one.
   */
  private async relevant(
    userId: string,
    question: string,
    built: BeyondPassages,
    signal: AbortSignal,
  ): Promise<BeyondPassages> {
    try {
      const began = Date.now();
      const { vectors, tokens } = await this.providers.embeddings.embedWithUsage([
        question,
        ...built.passages.map((p) =>
          researchEmbedText({ title: built.papers.get(p.id)?.title ?? '', abstract: p.text }),
        ),
      ]);
      await this.chat.logEmbed(userId, null, tokens, Date.now() - began);
      const [asked, ...each] = vectors;
      const passages = built.passages.filter(
        (_p, i) => cosine(asked ?? [], each[i] ?? []) >= RELEVANCE_FLOOR,
      );
      const papers = new Map([...built.papers].filter(([id]) => passages.some((p) => p.id === id)));
      return { passages, papers };
    } catch (error) {
      if (signal.aborted) throw error;
      this.logger.warn({ err: error, userId }, 'research chat: relevance check failed');
      return built;
    }
  }

  /** Stores the conversation after an answer; a new chat becomes a row here. */
  private async save(
    userId: string,
    chatId: string | null,
    turns: readonly StoredTurn[],
    firstQuestion: string,
  ): Promise<string> {
    const kept = turns.slice(-RESEARCH_CHAT.keepTurns);
    const data = {
      turns: kept as unknown as Prisma.InputJsonValue,
      questions: questionCount(kept),
    };
    if (chatId) {
      // `updateMany` so a chat deleted in another tab meanwhile is started again, not lost.
      const { count } = await this.prisma.researchChat.updateMany({
        where: { id: chatId, userId },
        data: { ...data, updatedAt: new Date() },
      });
      if (count > 0) return chatId;
    }
    const row = await this.prisma.researchChat.create({
      data: { userId, title: threadTitle(firstQuestion), ...data },
      select: { id: true },
    });
    return row.id;
  }

  /** The student's research chats, the one used last first. */
  async list(userId: string): Promise<{ chats: ResearchChatSummary[] }> {
    const rows = await this.prisma.researchChat.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: RESEARCH_CHAT.listed,
      select: { id: true, title: true, questions: true, createdAt: true, updatedAt: true },
    });
    return {
      chats: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  /** One chat, the student's own; anything else is a 404. */
  async get(userId: string, chatId: string): Promise<ResearchChatView> {
    const row = await this.prisma.researchChat.findFirst({
      where: { id: chatId, userId },
      select: { id: true, title: true, turns: true, createdAt: true, updatedAt: true },
    });
    if (!row) throw new NotFoundError('That chat');
    const turns = readTurns(row.turns);
    const first = turns.find((t) => t.role === 'user')?.text ?? row.title;
    return {
      id: row.id,
      title: row.title,
      turns,
      papers: papersOfChat(turns),
      suggestedTitle: thesisTitleFrom(first),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Renames one chat; its place in the list is kept (a name is not a use). */
  async rename(
    userId: string,
    chatId: string,
    title: string,
  ): Promise<{ id: string; title: string }> {
    const clean = title.replace(/\s+/g, ' ').trim();
    const row = await this.prisma.researchChat.findFirst({
      where: { id: chatId, userId },
      select: { id: true, updatedAt: true },
    });
    if (!row) throw new NotFoundError('That chat');
    await this.prisma.researchChat.update({
      where: { id: row.id },
      data: { title: clean, updatedAt: row.updatedAt },
    });
    return { id: row.id, title: clean };
  }

  /** Deletes one chat, on the student's press. No thesis is touched. */
  async remove(userId: string, chatId: string): Promise<{ deleted: true }> {
    const { count } = await this.prisma.researchChat.deleteMany({
      where: { id: chatId, userId },
    });
    if (count === 0) throw new NotFoundError('That chat');
    return { deleted: true };
  }
}
