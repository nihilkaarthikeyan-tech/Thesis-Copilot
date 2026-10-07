/**
 * Path A conversation — PRD FR-1.5, §9.1 `POST /documents/:id/proposal`, A.6, PHASES 6.1.
 *
 *   "message history per document (`Document.meta.proposalChat`), A.6 as system prompt, ≤ 3
 *    questions enforced in code (if the model asks a fourth, the server replies with the skeleton
 *    instruction), `<gap_check>` injection after turn 1 from an OpenAlex search of the clarified
 *    topic (top 8 + total count), `<skeleton>` parsing → same proposal screen as Path B."
 *
 * The conversation is bounded per document — four model turns, three of them questions — rather
 * than by a monthly cap (ADR-0005). Every model call is logged under `PROPOSAL` with real usage.
 * The skeleton is stored on the document's meta and the proposal screen shows it in the same
 * editable form Path B uses; nothing reaches `DocumentMemory.scope` until the student saves it
 * (FR-1.4: downstream prompts read the edited values, never the generated ones).
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildProposalRequest,
  clarifiedTopic,
  type LlmRequest,
  mayAskAnotherQuestion,
  PROPOSAL,
  type ProposalTurn,
  type Providers,
  parseProposalReply,
  questionsAsked,
  SKELETON_INSTRUCTION,
  stripProposalMarkers,
} from '@tc/ai';
import { computeCallCost, type Env } from '@tc/config';
import { OpenAlexClient } from '@tc/retrieval';
import { z } from 'zod';
import { ENV } from '../../common/env.token.js';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { PROVIDERS } from '../ai/ai.module.js';
import type { SessionUser } from '../auth/current-user.decorator.js';

const turnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  at: z.string(),
  /** The skeleton instruction code sent in the student's place; the model saw it, the UI hides it. */
  hidden: z.boolean().optional(),
});

const gapWorkSchema = z.object({
  title: z.string(),
  year: z.number().nullable(),
  abstract: z.string(),
  doi: z.string().nullable().optional(),
});

export const proposalChatSchema = z.object({
  messages: z.array(turnSchema).default([]),
  gapCheck: z
    .object({
      count: z.number(),
      works: z.array(gapWorkSchema),
      /**
       * The search could not run (timeout, OpenAlex down). Absent on chats stored before
       * 2026-10-04, which read as a search that ran.
       */
      failed: z.boolean().optional(),
      /** What OpenAlex was actually sent (the key terms, not the conversation). */
      query: z.string().optional(),
    })
    .nullable()
    .default(null),
  // A skeleton stored before markers were stripped (2026-10-07) is cleaned when read back.
  skeleton: z
    .object({
      workingTitle: z.string().transform(stripProposalMarkers),
      problemStatement: z.string().transform(stripProposalMarkers),
      objectives: z.array(z.string().transform(stripProposalMarkers)),
      whyOpen: z.string().transform(stripProposalMarkers),
    })
    .nullable()
    .default(null),
  modelTurns: z.number().int().min(0).default(0),
});
export type ProposalChat = z.infer<typeof proposalChatSchema>;

export type ProposalView = ProposalChat & {
  /** The messages the student sees (never the forced instruction). */
  visible: Array<{ role: 'user' | 'assistant'; text: string; at: string }>;
  questionsAsked: number;
  maxQuestions: number;
  done: boolean;
  turnsLeft: number;
};

/** Reads `meta.proposalChat`, tolerating a document that has none yet. */
function readChat(meta: unknown): ProposalChat {
  const value = (meta as { proposalChat?: unknown } | null)?.proposalChat;
  const parsed = proposalChatSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : proposalChatSchema.parse({});
}

/**
 * Rewinds the conversation to just before the student's message at `visibleIndex`, so a new
 * answer can replace it (2026-10-04, from the Jenni study: earlier answers could not be changed
 * without starting the thesis again). The related-work search and any skeleton are cleared,
 * because both were drawn from what is being changed. `modelTurns` is NOT reset: ADR-0005 bounds
 * the conversation per document, and rewinding must not become a way around that bound.
 */
export function rewind(chat: ProposalChat, visibleIndex: number): void {
  if (chat.modelTurns >= PROPOSAL.maxModelTurns) {
    throw new ConflictError(
      'This conversation has used its four turns, so an answer cannot be changed here. Edit the proposal below instead.',
    );
  }
  let seen = -1;
  const at = chat.messages.findIndex((m) => !m.hidden && ++seen === visibleIndex);
  if (at < 0 || chat.messages[at]?.role !== 'user') {
    throw new ValidationError('Only one of your own answers can be changed.');
  }
  chat.messages = chat.messages.slice(0, at);
  chat.gapCheck = null;
  chat.skeleton = null;
}

@Injectable()
export class ProposalService {
  private readonly logger = new Logger(ProposalService.name);
  private readonly openalex: OpenAlexClient;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.openalex = new OpenAlexClient({
      mailto: env.OPENALEX_MAILTO,
      ...(env.OPENALEX_API_KEY ? { apiKey: env.OPENALEX_API_KEY } : {}),
    });
  }

  async get(user: SessionUser, documentId: string): Promise<ProposalView> {
    const document = await this.ownedDocument(user.id, documentId);
    return this.view(readChat(document.meta));
  }

  /** One student message in, one model turn out (or the skeleton). */
  async turn(
    user: SessionUser,
    documentId: string,
    message: string,
    editIndex?: number,
  ): Promise<ProposalView> {
    const document = await this.ownedDocument(user.id, documentId);
    const chat = readChat(document.meta);
    if (editIndex !== undefined) rewind(chat, editIndex);
    if (chat.skeleton) {
      throw new ConflictError('This conversation has already produced a proposal skeleton.');
    }
    if (chat.modelTurns >= PROPOSAL.maxModelTurns) {
      throw new ConflictError('This conversation has used its four turns.');
    }

    const now = new Date().toISOString();
    chat.messages.push({ role: 'user', text: message, at: now });

    // "<gap_check> injection after turn 1": once the student has answered the first question.
    const history = () => chat.messages.map(asTurn);
    if (!chat.gapCheck && history().filter((t) => t.role === 'assistant').length >= 1) {
      chat.gapCheck = await this.gapCheck(clarifiedTopic(history()));
    }

    let reply = await this.model(user, documentId, history(), chat.gapCheck);
    chat.modelTurns += 1;

    // A.6 rule 2, enforced by code: a fourth question is never relayed. The model is told to
    // produce the skeleton instead, in a turn the student does not see.
    if (reply.kind === 'question' && !mayAskAnotherQuestion(history())) {
      chat.messages.push({ role: 'assistant', text: reply.text, at: now, hidden: true });
      chat.messages.push({ role: 'user', text: SKELETON_INSTRUCTION, at: now, hidden: true });
      reply = await this.model(user, documentId, history(), chat.gapCheck);
      chat.modelTurns += 1;
    } else if (reply.kind === 'invalid') {
      this.logger.warn({ documentId, reason: reply.reason }, 'proposal skeleton did not validate');
      chat.messages.push({ role: 'assistant', text: reply.text, at: now, hidden: true });
      chat.messages.push({ role: 'user', text: SKELETON_INSTRUCTION, at: now, hidden: true });
      reply = await this.model(user, documentId, history(), chat.gapCheck);
      chat.modelTurns += 1;
    }

    if (reply.kind === 'skeleton') {
      chat.messages.push({ role: 'assistant', text: reply.text, at: now, hidden: true });
      chat.skeleton = reply.skeleton;
    } else if (reply.kind === 'question') {
      chat.messages.push({ role: 'assistant', text: reply.text, at: now });
    } else {
      throw new ConflictError(
        'The model did not produce a proposal skeleton. Fill the proposal in by hand, or start a new thesis.',
      );
    }

    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        meta: { ...((document.meta as Record<string, unknown> | null) ?? {}), proposalChat: chat },
      },
    });
    return this.view(chat);
  }

  private view(chat: ProposalChat): ProposalView {
    return {
      ...chat,
      visible: chat.messages
        .filter((m) => !m.hidden)
        .map((m) => ({ role: m.role, text: m.text, at: m.at })),
      // Counted over what the student saw: a blocked fourth question was never asked of them.
      questionsAsked: questionsAsked(chat.messages.filter((m) => !m.hidden).map(asTurn)),
      maxQuestions: PROPOSAL.maxQuestions,
      done: chat.skeleton !== null,
      // Whether an earlier answer can still be changed (see `rewind`).
      turnsLeft: Math.max(0, PROPOSAL.maxModelTurns - chat.modelTurns),
    };
  }

  /** FR-1.5: an early OpenAlex look at the clarified topic. A failure here is not the student's. */
  private async gapCheck(topic: string): Promise<NonNullable<ProposalChat['gapCheck']>> {
    try {
      // Bounded: the student is waiting on this turn. When OpenAlex is degraded it answers 503
      // with `Retry-After: 60` (2026-09-25), and without the limit the turn took two minutes.
      // One limit covers the key-terms search and its one broader retry.
      const result = await this.openalex.searchTopicTerms(
        topic,
        PROPOSAL.gapCheckWorks,
        AbortSignal.timeout(8_000),
      );
      return { count: result.count, works: result.works, query: result.query };
    } catch (error) {
      this.logger.warn({ err: error, topic }, 'gap check failed; continuing without it');
      // Not "0 found": the student and the model are both told the search did not run.
      return { count: 0, works: [], failed: true };
    }
  }

  private async model(
    user: SessionUser,
    documentId: string,
    history: ProposalTurn[],
    gapCheck: ProposalChat['gapCheck'],
  ) {
    const request: LlmRequest = buildProposalRequest({
      history,
      // Sent even when empty or failed: the block then says so, and the model may not claim
      // related work was found (docs/JENNI-FIX-LIST.md item 3).
      gapCheck,
      userId: user.id,
      documentId,
    });
    const startedAt = Date.now();
    let text = '';
    let usage: {
      inputTokens: number;
      cachedInputTokens?: number;
      cacheWriteTokens?: number;
      outputTokens: number;
    } | null = null;
    let modelId = this.providers.llm.modelIdFor('strong');
    try {
      for await (const chunk of this.providers.llm.stream(request)) {
        if (chunk.type === 'text') text += chunk.text;
        else {
          usage = chunk.usage;
          modelId = chunk.modelId;
        }
      }
    } catch (error) {
      await this.log(user.id, documentId, modelId, null, Date.now() - startedAt, false, error);
      throw error;
    }
    await this.log(user.id, documentId, modelId, usage, Date.now() - startedAt, true);
    return parseProposalReply(text);
  }

  private async ownedDocument(ownerId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true, entryPath: true, meta: true },
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
        ? computeCallCost({ tier: 'strong', modelId: model, usage })
        : 0;
    await this.prisma.aiCallLog.create({
      data: {
        userId,
        documentId,
        action: 'PROPOSAL',
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

const asTurn = (m: { role: 'user' | 'assistant'; text: string }): ProposalTurn => ({
  role: m.role,
  text: m.text,
});
