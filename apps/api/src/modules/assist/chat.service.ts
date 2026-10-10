/**
 * Chat over the library — PRD FR-4.9, §9.3 `POST /chat`, A.4, PHASES v2 W9.4.
 *
 * Streams like Assist (SSE over POST, Appendix B.8) and is metered as `CHAT`. The answer may cite
 * only the passages sent with the request; anything else is stripped and counted as
 * `HALLUCINATED_CITE` (§10.6). The conversation lives on a `ChatThread` (ADR-0116): a thesis has
 * any number, and a question goes to the one the panel has open (`chat-threads.service.ts`). A.4
 * still sends the model only the last four turns; the thread keeps more for the student to read.
 * A thread on one collection answers only from that collection's papers.
 */

import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildChatRequest,
  buildDeepChatRequest,
  buildResearchPlanRequest,
  CHAT,
  type ChatFilters,
  cleanResearchPlan,
  DEEP_RESEARCH,
  type DeepPart,
  FILTERED_OUT_REPLY,
  NAMED_EMPTY_REPLY,
  OFF_TOPIC_REPLY,
  type Providers,
  postProcessChat,
  researchPlanSchema,
  type ScopeForQueries,
} from '@tc/ai';
import { computeCallCost, computeEmbeddingCost, type Env } from '@tc/config';
import {
  CHAT_RESEARCH,
  cosine,
  isOffTopic,
  type LibraryCoverage,
  libraryCoverage,
  planResearchQueries,
  researchEmbedText,
} from '@tc/retrieval';
import { ENV } from '../../common/env.token.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../common/errors.js';
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
  searchDownReply,
  BEYOND_NOT_ENOUGH_REPLY,
  type BeyondPaper,
  type BeyondPassages,
  type BeyondSetting,
  beyondFilters,
  beyondNote,
  beyondSettingOf,
  passagesFromWebResults,
  readingStep,
  searchingStep,
  WRITING_STEP,
} from './beyond-library.js';
import { ChatAttachmentsService, type LoadedAttachments } from './chat-attachments.service.js';
import {
  bestCosines,
  DEEP_EMPTY_REPLY,
  DEEP_WRITING_STEP,
  type DeepStep,
  type DeepSummary,
  deepNote,
  mergeCandidates,
  mergeRetrievals,
  PLANNING_STEP,
  partQuestions,
  partStep,
  plannedStep,
} from './chat-deep.js';
import {
  keptStep,
  queryStep,
  RESEARCH_WRITING_STEP,
  type ResearchAnswer,
  type ResearchStep,
  type ResearchSummary,
  readStep,
  researchCandidates,
  researchDecision,
  researchNote,
  researchOfferReply,
  researchPassages,
  thinStep,
} from './chat-research.js';
import {
  type BeyondSummary,
  type ChatCitation,
  collectionEmptyReply,
  collectionOffTopicReply,
  type StoredTurn,
} from './chat-threads.js';
import { ChatThreadsService, type OpenThread } from './chat-threads.service.js';
import { ContextService } from './context.service.js';
import { passagesFromChapters } from './document-scope.js';
import { statusOf } from './search-status.js';
import { type WebResult, WebScopeService } from './web-scope.service.js';

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
  /**
   * ADR-0080: deep research — the student asked for the slow, planned, searched answer. Library
   * scope only, and only without `@` papers; one `RESEARCH` unit instead of a CHAT unit.
   */
  deep?: boolean;
  /** ADR-0083: files uploaded to `POST /chat/attachments` for this question, at most three. */
  attachmentIds?: string[];
  /**
   * ADR-0116: the chat the question belongs to. None continues the thesis's latest whole-library
   * chat (what "the chat" was before threads); `newThread` starts one, on `collectionId` if given.
   */
  threadId?: string;
  newThread?: boolean;
  collectionId?: string;
  /**
   * ADR-0116 amendment (2026-10-08): the student's answer to the "Ask first" offer for a thin
   * library — search the literature this once, or answer from the library alone.
   */
  research?: ResearchAnswer;
};

export type { BeyondSummary, ChatCitation, StoredTurn };

export type ChatEvent =
  | { event: 'start'; data: { turn: number } }
  /**
   * ADR-0060: what a question is doing, shown while it runs. ADR-0074 adds the research steps,
   * with `params` so the panel can say them in the interface language.
   */
  | {
      event: 'step';
      data: { id: 'search' | 'read' | 'write'; text: string } | ResearchStep | DeepStep;
    }
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
        /**
         * ADR-0116 amendment: "Ask first", and the library is thin on the question. Nothing was
         * searched or charged; the student chooses: search this once, always, or the library alone.
         */
        offerResearch?: boolean;
        /** Present on an answer written from search abstracts. */
        beyond?: BeyondSummary;
        /** ADR-0132: answered from the libraries of all the student's theses. */
        across?: true;
        /** ADR-0074: present on a library answer that also read abstracts a search found. */
        research?: ResearchSummary | DeepSummary;
        /**
         * ADR-0116: the chat this answer is stored in — new when the question started one. Absent
         * on a refusal in a chat that has not been stored yet.
         */
        threadId?: string;
      };
    };

/**
 * QA 2026-10-08: a stored answer keeps its outcome when it is a scripted reply, so the panel can
 * tell a refusal from an answer after a reload (no "Add to document" under a refusal).
 */
function scripted(outcome: string): { outcome?: string } {
  return outcome === 'answered' ? {} : { outcome };
}

/** What `ContextService.retrieve` returns, so the filter keeps the passage shape. */
type Retrieved = Awaited<ReturnType<ContextService['retrieve']>>;

/** The unit a question is metered and logged as: a chat question, or deep research (ADR-0080). */
type ChatAction = 'CHAT' | 'RESEARCH';

type ChapterForChat = Parameters<ContextService['memoryBlock']>[0];

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly context: ContextService,
    private readonly web: WebScopeService,
    private readonly attachments: ChatAttachmentsService,
    private readonly threads: ChatThreadsService,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(ENV) private readonly env: Env,
  ) {}

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
    // ADR-0116: the chat this question belongs to, and on a collection, the papers it may use.
    // Every refusal here comes before the unit is taken, so it is JSON and costs nothing.
    const thread = await this.threads.open(user.id, input.documentId, {
      threadId: input.threadId,
      newThread: input.newThread,
      collectionId: input.collectionId,
    });
    const collection = thread.collection;
    if (collection) {
      if (scope !== 'library') {
        throw new ValidationError(
          `This chat answers only from the collection “${collection.name}”. Start a new chat to ask about your whole library, your own chapters or beyond it.`,
        );
      }
      if (collection.sourceIds.length === 0) {
        throw new ValidationError(
          `The collection “${collection.name}” has no papers yet. Add papers to it in the library, then ask.`,
        );
      }
      if ((input.sourceIds ?? []).some((id) => !collection.sourceIds.includes(id))) {
        throw new ValidationError(
          `This chat answers only from the collection “${collection.name}”: name only papers in it.`,
        );
      }
    }
    // A chat on one collection never searches beyond it: the student chose those papers only.
    const beyondSetting: BeyondSetting =
      scope === 'document' || collection ? 'off' : await this.beyondSetting(user.id);
    // ADR-0083: before any unit is taken, so a stale attachment id is a 400 that costs nothing.
    const attached = await this.attachments.load(
      user.id,
      input.documentId,
      input.attachmentIds ?? [],
    );
    const hasAttachments = attached.passages.length > 0 || attached.images.length > 0;
    // Refused before the unit is taken, so it answers as JSON (`streamSse` pulls the first event
    // before the stream opens) and costs nothing.
    if (scope === 'beyond' && beyondSetting === 'off') {
      throw new ForbiddenError(
        'Searching beyond your library is turned off. Turn it on in Settings to ask this way.',
      );
    }

    // ADR-0080: the deep mode is its own unit and its own path. Asked with `@` papers, in another
    // scope or in a chat on one collection (ADR-0116) it is an ordinary question: the panel offers
    // it only where it applies.
    if (
      input.deep === true &&
      scope === 'library' &&
      (input.sourceIds?.length ?? 0) === 0 &&
      !collection
    ) {
      if (beyondSetting === 'off') {
        throw new ForbiddenError(
          'Deep research searches the literature, which is turned off in Settings. Turn "Search beyond my library" on to use it.',
        );
      }
      yield* this.askDeep(user, input, document, thread, chapter, attached, signal);
      return;
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

    const history = thread.turns;
    yield { event: 'start', data: { turn: history.length / 2 + 1 } };

    const startedAt = Date.now();

    if (scope === 'beyond') {
      yield* this.answerBeyond(user, input, thread, chapter, startedAt, signal);
      return;
    }

    // The document scope answers from the student's own chapters, which are passed directly
    // rather than retrieved: they change on every keystroke, so an index of them would be stale
    // before it was written, and skipping the embedding call also skips the Voyage rate limit.
    // ADR-0073: say what is happening while it happens, as the beyond-the-library path does.
    yield {
      event: 'step',
      data: {
        id: 'search',
        text: scope === 'document' ? 'Reading your chapters…' : 'Searching your library…',
      },
    };

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
            // ADR-0116: a chat on one collection searches its papers alone (`@` narrows further).
            sourceIds:
              collection && (input.sourceIds?.length ?? 0) === 0
                ? collection.sourceIds
                : (input.sourceIds ?? []),
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
    // ADR-0083: a question with a file attached is about the file; the library's silence on it is
    // not a refusal.
    if (
      !hasAttachments &&
      (passages.length === 0 || (scope === 'library' && isOffTopic(passages)))
    ) {
      // Two different refusals, and the difference matters to the student. An empty set when
      // retrieval did find something means their own filters emptied it, and the fix is a control
      // on this screen; anything else means the question is not about their library.
      const filteredOut = passages.length === 0 && retrieved.passages.length > 0;
      // Named papers with no text at all: neither off-topic nor filtered, and the fix is different.
      // ADR-0116: a chat on one collection named its papers too.
      const namedEmpty =
        scope === 'library' &&
        ((input.sourceIds?.length ?? 0) > 0 || collection !== null) &&
        retrieved.candidates === 0;
      // ADR-0060. Only the off-topic refusal is offered beyond the library: a filtered-out or a
      // named-empty question is about the library, and its fix is on this screen.
      const offTopic = scope === 'library' && !filteredOut && !namedEmpty;
      if (offTopic && beyondSetting === 'on') {
        // "On": the same question goes to the search, on the unit already taken — still one CHAT
        // unit a question, refunded there if the search has nothing to read.
        chatOffTopic.inc();
        yield* this.answerBeyond(user, input, thread, chapter, startedAt, signal);
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
                ? collection && (input.sourceIds?.length ?? 0) === 0
                  ? collectionEmptyReply(collection.name)
                  : NAMED_EMPTY_REPLY
                : filteredOut
                  ? FILTERED_OUT_REPLY
                  : collection
                    ? collectionOffTopicReply(collection.name)
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
          ...(thread.id ? { threadId: thread.id } : {}),
        },
      };
      return;
    }

    const librarySources = new Set(passages.map((p) => p.shortRef)).size;
    yield {
      event: 'step',
      data: {
        id: 'read',
        text: `Reading ${passages.length} passage${passages.length === 1 ? '' : 's'} from ${librarySources} source${librarySources === 1 ? '' : 's'}`,
      },
    };

    // ADR-0074: a library too thin for the question is topped up from the literature, in the same
    // request and on the same unit — unless the student turned searching off, or named the papers
    // the question is about with `@` (then those papers are the answer's whole ground).
    const coverage =
      scope === 'library'
        ? libraryCoverage(passages.map((p) => ({ cosine: p.cosine, sourceId: p.sourceId })))
        : null;
    // ADR-0116 amendment (QA 2026-10-08): under "Ask first" nothing beyond the library runs
    // without the student's press, the thin-library top-up included. Without their answer the
    // question stops here, before the model, with the offer — free, as the off-topic refusal is.
    const decision = researchDecision(
      coverage,
      beyondSetting,
      input.sourceIds?.length ?? 0,
      input.research,
      hasAttachments,
    );
    if (decision === 'offer' && coverage) {
      await this.usage.refund(user.id, 'CHAT');
      this.logger.log(
        { documentId: input.documentId, coverage },
        'chat: a thin library under "Ask first"; offered a search, nothing searched',
      );
      yield {
        event: 'done',
        data: {
          text: researchOfferReply(coverage.sources),
          outcome: 'research-offer',
          citations: [],
          passagesUsed: 0,
          latencyMs: Date.now() - startedAt,
          offerResearch: true,
          ...(thread.id ? { threadId: thread.id } : {}),
        },
      };
      return;
    }
    const research =
      coverage && decision === 'research'
        ? yield* this.research(user.id, input, document.title, chapter, coverage, filters, signal)
        : null;
    const found = research?.found ?? { passages: [], papers: new Map<string, BeyondPaper>() };
    const allPassages = [...passages, ...found.passages, ...attached.passages];

    yield {
      event: 'step',
      data: { id: 'write', text: research ? RESEARCH_WRITING_STEP : WRITING_STEP },
    };

    const request = buildChatRequest({
      memoryBlock: memory.text,
      question: input.message,
      history,
      passages: allPassages,
      filters,
      userId: user.id,
      documentId: input.documentId,
      signal,
      tier: this.env.AI_CHAT_TIER,
      maxPassages:
        (found.passages.length > 0 ? CHAT.researchTopK : CHAT.topK) + attached.passages.length,
      ...(attached.images.length > 0 ? { images: attached.images } : {}),
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
      allPassages.map((p) => p.id),
    );
    for (const key of processed.hallucinated) {
      hallucinatedCite.inc();
      this.logger.warn({ documentId: input.documentId, key }, 'HALLUCINATED_CITE');
    }

    // The keys map back to real ids so a citation in the answer opens the passage (FR-4.9); a
    // found paper's carries the paper, with Add (ADR-0060's shape).
    const citations: ChatCitation[] = processed.cited.flatMap((key) => {
      const real = retrieved.byKey.get(key);
      const passage = allPassages.find((p) => p.id === key);
      if (real) {
        return [
          { key, sourceId: real.sourceId, chunkId: real.chunkId, label: passage?.shortRef ?? key },
        ];
      }
      const paper = found.papers.get(key);
      if (paper) {
        return [{ key, sourceId: '', chunkId: '', label: passage?.shortRef ?? key, beyond: paper }];
      }
      const file = attached.byKey.get(key);
      return file
        ? [{ key, sourceId: '', chunkId: '', label: passage?.shortRef ?? key, attachment: file }]
        : [];
    });
    const summary: ResearchSummary | undefined =
      research && found.passages.length > 0
        ? {
            papers: found.passages.length,
            queries: research.queries,
            note: researchNote(librarySources, found.passages.length),
          }
        : undefined;

    const answerId = randomUUID();
    const turns: StoredTurn[] = [
      ...history,
      { id: randomUUID(), role: 'user' as const, text: input.message },
      // The citations stay with the turn (ADR-0045): without them the history rendered no
      // citation after a reload, and the stale `{{cite:S1#c1}}` ids went back to the model.
      {
        id: answerId,
        role: 'assistant' as const,
        text: processed.text,
        citations,
        ...scripted(processed.outcome),
        ...(summary ? { research: summary } : {}),
      },
    ];
    const threadId = await this.threads.save(input.documentId, thread, turns, input.message);

    yield {
      event: 'done',
      data: {
        turnId: answerId,
        text: processed.text,
        outcome: processed.outcome,
        citations,
        passagesUsed: allPassages.length,
        latencyMs,
        ...(summary ? { research: summary } : {}),
        threadId,
      },
    };
  }

  /**
   * ADR-0080: deep research. One `RESEARCH` unit, taken first, pays for: a planner call (A.4.1)
   * that breaks the question into parts with a query each; the library and every index searched
   * once per part, in the plan's order, each shown as it happens; one embedding call that keeps
   * the found abstracts on the question or on a part; and the answer (A.4.2), written part by
   * part from the library's best passages over all the parts and the kept abstracts. Grounding is
   * unchanged: only passages in the request may be cited.
   *
   * Nothing but the answer fails the question. A planner failure plans in code; a failed search
   * loses that part's results; a failed embedding loses the abstracts. The unit is refunded when
   * nothing at all was found to read, and when the answer fails.
   */
  private async *askDeep(
    user: { id: string; plan: string },
    input: ChatInput,
    document: { title: string },
    thread: OpenThread,
    chapter: ChapterForChat,
    attached: LoadedAttachments,
    signal: AbortSignal,
  ): AsyncGenerator<ChatEvent> {
    const cap = await this.usage.consume(
      user.id,
      user.plan as Parameters<UsageService['consume']>[1],
      'RESEARCH',
    );
    if (!cap.ok) {
      capExceeded.inc({ action: 'RESEARCH' });
      throw refusal('RESEARCH', cap);
    }

    const history = thread.turns;
    yield { event: 'start', data: { turn: history.length / 2 + 1 } };
    const startedAt = Date.now();
    const filters = input.filters ?? {};

    yield { event: 'step', data: PLANNING_STEP };
    const [memory, scope] = await Promise.all([
      this.context.memoryBlock(chapter),
      this.scopeForPlan(input.documentId, document.title, chapter),
    ]);
    const plan = await this.planDeep(user.id, input, scope, signal);
    yield { event: 'step', data: plannedStep(plan) };

    // The library and the indexes, once per part, in the plan's order. The indexes answer within
    // ADR-0074's budget per part, so the whole search is bounded by the number of parts.
    const retrievals: Retrieved[] = [];
    const found: WebResult[][] = [];
    let searchNotice: string | null = null;
    for (const [i, part] of plan.entries()) {
      yield { event: 'step', data: partStep(i, plan.length, part) };
      const [retrieved, results] = await Promise.all([
        this.context.retrieve(chapter, `${part.title}. ${part.question}`, 'CHAT'),
        this.web
          .searchPlan(
            input.documentId,
            part.question,
            {
              semantic: `${scope.workingTitle}. ${part.question}`.slice(0, 2_000),
              keyword: [part.query],
            },
            signal,
          )
          .catch((error: unknown): WebResult[] => {
            if (signal.aborted) throw error;
            this.logger.warn(
              { err: error, documentId: input.documentId, part: part.title },
              'deep research: a search failed',
            );
            return [];
          }),
      ]);
      retrievals.push(retrieved);
      found.push(results);
      // ADR-0149: an index that did not answer is said once, after the first part that saw it.
      const notice = statusOf(results)?.notice ?? null;
      if (notice && !searchNotice) {
        searchNotice = notice;
        yield { event: 'step', data: { id: 'notice', text: notice } };
      }
    }
    // The question as asked, too, so a part the planner missed still has the library's best.
    retrievals.push(await this.context.retrieve(chapter, input.message, 'CHAT'));

    const merged = mergeRetrievals(retrievals);
    const filtered = (await this.applyFilters(merged, filters)).slice(0, DEEP_RESEARCH.libraryTopK);
    // A library with nothing near the question contributes nothing; the searches may still answer.
    const library = filtered.length > 0 && !isOffTopic(filtered) ? filtered : [];
    const librarySources = new Set(library.map((p) => p.shortRef)).size;
    yield {
      event: 'step',
      data: {
        id: 'read',
        text: `Reading ${library.length} passage${library.length === 1 ? '' : 's'} from ${librarySources} source${librarySources === 1 ? '' : 's'}`,
      },
    };

    const candidates = mergeCandidates(found);
    yield { event: 'step', data: readStep(candidates.length) };
    let kept: BeyondPassages = { passages: [], papers: new Map<string, BeyondPaper>() };
    if (candidates.length > 0) {
      try {
        const began = Date.now();
        const asked = [input.message, ...partQuestions(plan)];
        const { vectors, tokens } = await this.providers.embeddings.embedWithUsage([
          ...asked,
          ...candidates.map((r) => researchEmbedText(r)),
        ]);
        await this.logEmbed(user.id, input.documentId, tokens, Date.now() - began);
        const scores = bestCosines(vectors, plan.length, candidates.length, cosine);
        kept = researchPassages(
          candidates.map((result, i) => ({ result, cosine: scores[i] ?? 0 })),
          beyondFilters(filters),
          CHAT_RESEARCH.keepCosine,
          DEEP_RESEARCH.maxAbstracts,
        );
      } catch (error) {
        if (signal.aborted) throw error;
        this.logger.warn(
          { err: error, documentId: input.documentId },
          'deep research: the embedding failed; answering from the library',
        );
      }
    }
    yield { event: 'step', data: keptStep(kept.passages.length, candidates.length) };
    this.logger.log(
      {
        documentId: input.documentId,
        parts: plan.length,
        library: library.length,
        librarySources,
        candidates: candidates.length,
        kept: kept.passages.length,
      },
      'deep research',
    );

    const allPassages = [...library, ...kept.passages, ...attached.passages];
    if (allPassages.length === 0 && attached.images.length === 0) {
      await this.usage.refund(user.id, 'RESEARCH');
      yield {
        event: 'done',
        data: {
          text: DEEP_EMPTY_REPLY,
          outcome: 'deep-empty',
          citations: [],
          passagesUsed: 0,
          latencyMs: Date.now() - startedAt,
          ...(thread.id ? { threadId: thread.id } : {}),
        },
      };
      return;
    }

    yield { event: 'step', data: { id: 'write', text: DEEP_WRITING_STEP } };
    const request = buildDeepChatRequest({
      memoryBlock: memory.text,
      question: input.message,
      history,
      passages: allPassages,
      filters,
      userId: user.id,
      documentId: input.documentId,
      signal: AbortSignal.any([signal, AbortSignal.timeout(DEEP_RESEARCH.answerTimeoutMs)]),
      plan,
      maxPassages: DEEP_RESEARCH.maxPassages + attached.passages.length,
      ...(attached.images.length > 0 ? { images: attached.images } : {}),
    });
    const { raw, latencyMs } = yield* this.stream(
      user.id,
      input.documentId,
      request,
      startedAt,
      signal,
      'RESEARCH',
    );

    const processed = postProcessChat(
      raw,
      allPassages.map((p) => p.id),
    );
    for (const key of processed.hallucinated) {
      hallucinatedCite.inc();
      this.logger.warn({ documentId: input.documentId, key }, 'HALLUCINATED_CITE');
    }
    const citations: ChatCitation[] = processed.cited.flatMap((key) => {
      const real = merged.byKey.get(key);
      const passage = allPassages.find((p) => p.id === key);
      if (real) {
        return [
          { key, sourceId: real.sourceId, chunkId: real.chunkId, label: passage?.shortRef ?? key },
        ];
      }
      const paper = kept.papers.get(key);
      if (paper) {
        return [{ key, sourceId: '', chunkId: '', label: passage?.shortRef ?? key, beyond: paper }];
      }
      const file = attached.byKey.get(key);
      return file
        ? [{ key, sourceId: '', chunkId: '', label: passage?.shortRef ?? key, attachment: file }]
        : [];
    });
    const summary: DeepSummary = {
      deep: true,
      papers: kept.passages.length,
      queries: plan.map((p) => p.query),
      note: deepNote(librarySources, kept.passages.length),
      plan: plan.map(({ title, question }) => ({ title, question })),
      libraryPapers: librarySources,
    };

    const answerId = randomUUID();
    const turns: StoredTurn[] = [
      ...history,
      { id: randomUUID(), role: 'user' as const, text: input.message },
      {
        id: answerId,
        role: 'assistant' as const,
        text: processed.text,
        citations,
        ...scripted(processed.outcome),
        research: summary,
      },
    ];
    const threadId = await this.threads.save(input.documentId, thread, turns, input.message);

    yield {
      event: 'done',
      data: {
        turnId: answerId,
        text: processed.text,
        outcome: processed.outcome,
        citations,
        passagesUsed: allPassages.length,
        latencyMs,
        research: summary,
        threadId,
      },
    };
  }

  /** The thesis scope the planner reads: the memory's, else the title and the chapter's note. */
  private async scopeForPlan(
    documentId: string,
    title: string,
    chapter: ChapterForChat,
  ): Promise<ScopeForQueries> {
    const memory = await this.prisma.documentMemory.findUnique({
      where: { documentId },
      select: { scope: true },
    });
    const stored = (memory?.scope ?? {}) as {
      workingTitle?: unknown;
      problemStatement?: unknown;
      objectives?: unknown;
    };
    const workingTitle =
      typeof stored.workingTitle === 'string' && stored.workingTitle.trim()
        ? stored.workingTitle.trim()
        : title;
    const problemStatement =
      typeof stored.problemStatement === 'string' && stored.problemStatement.trim()
        ? stored.problemStatement.trim()
        : (chapter.scopeNote ?? '');
    const objectives = Array.isArray(stored.objectives)
      ? stored.objectives.filter((o): o is string => typeof o === 'string').slice(0, 8)
      : [];
    return { workingTitle, problemStatement, objectives };
  }

  /**
   * A.4.1, logged as `RESEARCH`, within its time limit. A failed or empty plan is planned in
   * code from the question's own words (ADR-0074), one part: the question is never failed for it.
   */
  private async planDeep(
    userId: string,
    input: ChatInput,
    scope: ScopeForQueries,
    signal: AbortSignal,
  ): Promise<DeepPart[]> {
    const request = buildResearchPlanRequest({
      scope,
      question: input.message,
      userId,
      documentId: input.documentId,
      signal: AbortSignal.any([signal, AbortSignal.timeout(DEEP_RESEARCH.plannerTimeoutMs)]),
    });
    const startedAt = Date.now();
    let modelId = this.providers.llm.modelIdFor('strong');
    let parts: DeepPart[] = [];
    try {
      const result = await this.providers.llm.complete({ ...request, schema: researchPlanSchema });
      modelId = result.modelId;
      await this.log(
        userId,
        input.documentId,
        modelId,
        result.usage,
        Date.now() - startedAt,
        true,
        undefined,
        'RESEARCH',
      );
      parts = cleanResearchPlan(result.value);
    } catch (error) {
      if (signal.aborted) throw error;
      await this.log(
        userId,
        input.documentId,
        modelId,
        null,
        Date.now() - startedAt,
        false,
        error,
        'RESEARCH',
      );
      this.logger.warn(
        { err: error, documentId: input.documentId },
        'deep research: the plan failed; planning in code',
      );
    }
    if (parts.length > 0) return parts;
    const fallback = planResearchQueries(input.message, scope.workingTitle);
    return [
      {
        title: 'The question',
        question: input.message,
        query: fallback.keyword[0] ?? input.message.slice(0, 120),
      },
    ];
  }

  /**
   * ADR-0074: search the literature for a question the library is thin on, and keep the found
   * abstracts that are on it. Every step is shown as it happens. No model call: the plan is
   * `planResearchQueries`, the indexes are searched within `CHAT_RESEARCH.budget`, and relevance
   * is one embedding call over at most `CHAT_RESEARCH.maxCandidates` abstracts, logged as `EMBED`
   * so the ₹100 ceiling sees it.
   *
   * Nothing here fails the question: the student asked their library, and an index or the
   * embedding being down only means the answer is the library's alone (said in a step). The CHAT
   * unit is the caller's and is refunded there if the answer itself fails.
   */
  private async *research(
    userId: string,
    input: ChatInput,
    thesisTitle: string,
    chapter: ChapterForChat,
    coverage: LibraryCoverage,
    filters: ChatFilters,
    signal: AbortSignal,
  ): AsyncGenerator<ChatEvent, { found: BeyondPassages; queries: string[] } | null> {
    yield { event: 'step', data: thinStep(coverage) };
    const memoryTitle = await this.workingTitle(input.documentId);
    const plan = planResearchQueries(input.message, memoryTitle ?? thesisTitle ?? chapter.title);
    yield { event: 'step', data: queryStep(['OpenAlex'], input.message.slice(0, 160)) };
    for (const query of plan.keyword) {
      yield { event: 'step', data: queryStep(this.web.indexNames(), query) };
    }

    let found: BeyondPassages;
    try {
      const searched = await this.web.searchPlan(input.documentId, input.message, plan, signal);
      // ADR-0149: an index that did not answer is said, not hidden in "nothing found".
      const notice = statusOf(searched)?.notice ?? null;
      if (notice) yield { event: 'step', data: { id: 'notice', text: notice } };
      const results = researchCandidates(searched);
      yield { event: 'step', data: readStep(results.length) };
      if (results.length === 0) {
        yield { event: 'step', data: keptStep(0, 0) };
        return null;
      }
      const began = Date.now();
      const { vectors, tokens } = await this.providers.embeddings.embedWithUsage([
        plan.semantic,
        ...results.map((r) => researchEmbedText(r)),
      ]);
      await this.logEmbed(userId, input.documentId, tokens, Date.now() - began);
      const [asked, ...each] = vectors;
      found = researchPassages(
        results.map((result, i) => ({ result, cosine: cosine(asked ?? [], each[i] ?? []) })),
        beyondFilters(filters),
      );
      this.logger.log(
        {
          documentId: input.documentId,
          coverage,
          candidates: results.length,
          kept: found.passages.length,
          embedTokens: tokens,
        },
        'chat research',
      );
      yield { event: 'step', data: keptStep(found.passages.length, results.length) };
    } catch (error) {
      if (signal.aborted) throw error;
      this.logger.warn({ err: error, documentId: input.documentId }, 'chat research failed');
      yield {
        event: 'step',
        data: {
          id: 'kept',
          text: 'The search did not answer in time; answering from your library',
          params: { kept: 0, read: 0 },
        },
      };
      return null;
    }
    return found.passages.length > 0 ? { found, queries: plan.keyword } : null;
  }

  private async workingTitle(documentId: string): Promise<string | null> {
    const memory = await this.prisma.documentMemory.findUnique({
      where: { documentId },
      select: { scope: true },
    });
    const title = (memory?.scope as { workingTitle?: unknown } | null)?.workingTitle;
    return typeof title === 'string' && title.trim() ? title.trim() : null;
  }

  /**
   * The research path's embedding call, as the worker logs its own (`EMBED`, real tokens). Also
   * used by a research question asked with no thesis (ADR-0132), whose `documentId` is null.
   */
  async logEmbed(
    userId: string,
    documentId: string | null,
    tokens: number,
    latencyMs: number,
  ): Promise<void> {
    const cost = this.env.EMBED_PROVIDER !== 'mock' ? computeEmbeddingCost(tokens) : 0;
    if (cost > 0) aiCostMicroInr.inc({ action: 'EMBED' }, cost);
    await this.prisma.aiCallLog.create({
      data: {
        userId,
        documentId,
        action: 'EMBED',
        model: this.env.AI_EMBED_MODEL,
        inputTokens: tokens,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        costMicroInr: BigInt(cost),
        latencyMs,
        ok: true,
        error: null,
      },
    });
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
    thread: OpenThread,
    chapter: ChapterForChat,
    startedAt: number,
    signal: AbortSignal,
  ): AsyncGenerator<ChatEvent> {
    const history = thread.turns;
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
      // ADR-0149: an index that did not answer is said, not hidden in "no papers".
      if (found.notice) yield { event: 'step', data: { id: 'notice', text: found.notice } };
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
          text: found.notice ? searchDownReply(found.notice) : BEYOND_EMPTY_REPLY,
          outcome: 'beyond-empty',
          citations: [],
          passagesUsed: 0,
          latencyMs: Date.now() - startedAt,
          ...(thread.id ? { threadId: thread.id } : {}),
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
      tier: this.env.AI_CHAT_TIER,
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
        ...scripted(notEnough ? 'beyond-not-enough' : processed.outcome),
        ...(notEnough ? {} : { beyond }),
      },
    ];
    const threadId = await this.threads.save(input.documentId, thread, turns, input.message);

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
        threadId,
      },
    };
  }

  /**
   * The model call and its logging, shared by the library and beyond paths, and by a research
   * question asked with no thesis (ADR-0132, `documentId` null). Refunds the unit on a failure.
   */
  async *stream(
    userId: string,
    documentId: string | null,
    request: ReturnType<typeof buildChatRequest>,
    startedAt: number,
    signal: AbortSignal,
    action: ChatAction = 'CHAT',
  ): AsyncGenerator<ChatEvent, { raw: string; latencyMs: number }> {
    let raw = '';
    let ttfbMs: number | null = null;
    const tier = this.tierFor(action);
    let modelId = this.providers.llm.modelIdFor(tier);
    try {
      for await (const chunk of this.providers.llm.stream(request)) {
        if (signal.aborted) break;
        if (chunk.type === 'text') {
          if (ttfbMs === null) {
            ttfbMs = Date.now() - startedAt;
            aiTtfb.observe({ action }, ttfbMs);
          }
          raw += chunk.text;
          yield { event: 'token', data: { t: chunk.text } };
        } else {
          modelId = chunk.modelId;
          await this.log(
            userId,
            documentId,
            modelId,
            chunk.usage,
            Date.now() - startedAt,
            true,
            undefined,
            action,
          );
        }
      }
    } catch (error) {
      await this.usage.refund(userId, action);
      await this.log(
        userId,
        documentId,
        modelId,
        null,
        Date.now() - startedAt,
        false,
        error,
        action,
      );
      throw error;
    }
    const latencyMs = Date.now() - startedAt;
    aiCallLatency.observe({ action, tier }, latencyMs);
    return { raw, latencyMs };
  }

  /** A chat answer is on `AI_CHAT_TIER`; deep research (ADR-0080) is always on the strong tier. */
  private tierFor(action: ChatAction): 'fast' | 'strong' {
    return action === 'RESEARCH' ? 'strong' : this.env.AI_CHAT_TIER;
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
      select: { id: true, title: true },
    });
    if (!document) throw new NotFoundError('That document');
    return document;
  }

  /**
   * Thumbs on an answer (2026-10-04, from the Jenni study). Kept on the turn in its chat
   * (`ChatThreadsService.rate`), and logged. No model call.
   */
  async rate(
    ownerId: string,
    documentId: string,
    turnId: string,
    rating: 1 | -1 | 0,
    threadId?: string,
  ): Promise<{ ok: true }> {
    const rated = await this.threads.rate(ownerId, documentId, turnId, rating, threadId);
    this.logger.log({ documentId, threadId: rated.threadId, turnId, rating }, 'chat answer rated');
    return { ok: true };
  }

  private async log(
    userId: string,
    documentId: string | null,
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
    action: ChatAction = 'CHAT',
  ): Promise<void> {
    const cost =
      ok && usage && this.env.AI_PROVIDER !== 'mock'
        ? computeCallCost({ tier: this.tierFor(action), modelId: model, usage })
        : 0;
    if (cost > 0) aiCostMicroInr.inc({ action }, cost);
    await this.prisma.aiCallLog.create({
      data: {
        userId,
        documentId,
        action,
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
