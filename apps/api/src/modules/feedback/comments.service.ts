/**
 * Comments, classification and the review queue — PRD §5.7, Appendix D.2.2–D.2.4, A.13, A.14,
 * PHASES v2 B2.2–B2.5.
 *
 * The state machine in D.2.3 is the spine: a comment is OPEN until the student does something
 * about it, and every outcome — accepted, edited, rejected — is recorded with enough detail to
 * print the response-to-committee table months later.
 *
 * Two things this service will not do:
 *   - apply a revision the student has not seen (D.2.4 accepts explicitly, after a snapshot);
 *   - generate revisions in bulk for `SUBSTANTIVE` comments (D.2.3 — those need the student's own
 *     judgement, and offering a button that rewrites an argument is how a thesis stops being the
 *     student's).
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildClassifyRequest,
  buildReviseRequest,
  COMMENT,
  type CommentClass,
  classifySchema,
  findAnchor,
  type Providers,
  postProcessRevision,
} from '@tc/ai';
import { computeCallCost, type Env, type Plan } from '@tc/config';
import { type ChapterSentence, sentencesOf } from '@tc/retrieval';
import { ENV } from '../../common/env.token.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { PROVIDERS } from '../ai/ai.module.js';
import { ContextService } from '../assist/context.service.js';
import type { SessionUser } from '../auth/current-user.decorator.js';
import { refusal, UsageService } from '../usage/usage.service.js';
import { SharesService } from './shares.service.js';

export type CommentView = {
  id: string;
  chapterId: string | null;
  chapterTitle: string | null;
  chapterOrder: number | null;
  authorEmail: string;
  body: string;
  quotedText: string | null;
  anchorKey: string | null;
  class: string | null;
  status: string;
  suggestedRevision: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
  /** D.2.2: the range the quoted text currently occupies, or null when it could not be found. */
  anchor: { from: number; to: number } | null;
  /** The quoted text as the chapter reads now (D.2.4: "quoted text as it currently reads (live)"). */
  currentText: string | null;
};

/** D.2.4's ordering: chapter order, then class, then position. */
const CLASS_ORDER: Record<string, number> = { SUBSTANTIVE: 0, CLARIFICATION: 1, MECHANICAL: 2 };

/** Which comments a screen needs: the open ones (review queue, editor highlights) or one chapter's. */
export type CommentListFilter = { status?: 'OPEN' | 'ALL'; chapterId?: string };

/** The most comments one read returns — far above a real review, a ceiling on the pathological. */
export const COMMENT_LIST_MAX = 500;

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shares: SharesService,
    private readonly usage: UsageService,
    private readonly context: ContextService,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Either the owner, or a guide the document was shared with. */
  private async access(user: SessionUser, documentId: string): Promise<{ isOwner: boolean }> {
    const owned = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId: user.id },
      select: { id: true },
    });
    if (owned) return { isOwner: true };
    await this.shares.assertShared(user, documentId);
    return { isOwner: false };
  }

  /**
   * Creates a comment and classifies it (D.2.3: "Classification runs automatically when a comment
   * is created"). The classification is not awaited by the guide's request — a slow model must not
   * make a comment fail to save — and a failure leaves the class null, which the queue renders as
   * "unclassified" rather than pretending.
   */
  async create(
    user: SessionUser,
    documentId: string,
    input: {
      chapterId?: string | null;
      body: string;
      quotedText?: string | null;
      anchorKey?: string | null;
    },
  ): Promise<CommentView> {
    const { isOwner } = await this.access(user, documentId);
    if (input.chapterId) {
      const chapter = await this.prisma.chapter.findFirst({
        where: { id: input.chapterId, documentId },
        select: { id: true },
      });
      if (!chapter) throw new NotFoundError('That chapter');
    }

    const comment = await this.prisma.comment.create({
      data: {
        documentId,
        chapterId: input.chapterId ?? null,
        authorEmail: user.email.toLowerCase(),
        body: input.body.trim(),
        quotedText: input.quotedText?.trim() || null,
        anchorKey: input.anchorKey ?? null,
      },
    });

    // A student's note on their own text is not feedback to triage: no classification, and so no
    // model call (2026-10-04). A guide's comment is classified as before (D.2.3).
    if (!isOwner) {
      void this.classify(user, documentId, comment.id).catch((error: unknown) =>
        this.logger.warn({ err: error, commentId: comment.id }, 'classification failed'),
      );
    }

    const views = await this.list(user, documentId);
    return views.find((c) => c.id === comment.id) as CommentView;
  }

  /** A.13. Uncapped but logged (D.2.3). */
  async classify(user: SessionUser, documentId: string, commentId: string): Promise<void> {
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, documentId },
      select: { id: true, body: true, quotedText: true, chapterId: true },
    });
    if (!comment) return;
    const chapter = comment.chapterId
      ? await this.prisma.chapter.findUnique({
          where: { id: comment.chapterId },
          select: { title: true },
        })
      : null;

    const request = buildClassifyRequest({
      comment: comment.body,
      quotedText: comment.quotedText,
      chapterTitle: chapter?.title ?? 'the thesis',
      userId: user.id,
      documentId,
    });
    const startedAt = Date.now();
    try {
      const answer = await this.providers.llm.complete({ ...request, schema: classifySchema });
      await this.log(
        user.id,
        documentId,
        'CLASSIFY_COMMENT',
        'fast',
        answer.modelId,
        answer.usage,
        Date.now() - startedAt,
        true,
      );
      await this.prisma.comment.update({
        where: { id: comment.id },
        data: { class: answer.value.class },
      });
    } catch (error) {
      await this.log(
        user.id,
        documentId,
        'CLASSIFY_COMMENT',
        'fast',
        this.providers.llm.modelIdFor('fast'),
        null,
        Date.now() - startedAt,
        false,
        error,
      );
      throw error;
    }
  }

  /**
   * Every comment on the document, re-anchored against the chapters as they read now (D.2.2).
   *
   * The re-anchoring happens on read rather than on save because the text moves under a comment
   * continuously; computing it once at creation would be a snapshot that is wrong by the time
   * anyone looks.
   */
  async list(
    user: SessionUser,
    documentId: string,
    filter: CommentListFilter = {},
  ): Promise<CommentView[]> {
    await this.access(user, documentId);
    // 2026-09-28: comments are never deleted, so "every comment ever" grew with each review round
    // and was re-anchored in full on every read. Each screen now asks for what it shows — the
    // open ones, or one chapter's — and a ceiling bounds the rest (newest kept).
    const where = {
      documentId,
      ...(filter.status === 'OPEN' ? { status: 'OPEN' as const } : {}),
      ...(filter.chapterId ? { chapterId: filter.chapterId } : {}),
    };
    const [comments, chapters] = await Promise.all([
      this.prisma.comment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: COMMENT_LIST_MAX,
      }),
      this.prisma.chapter.findMany({
        where: { documentId, ...(filter.chapterId ? { id: filter.chapterId } : {}) },
        orderBy: { order: 'asc' },
        select: { id: true, title: true, order: true, content: true },
      }),
    ]);

    const sentencesByChapter = new Map<string, ChapterSentence[]>();
    for (const chapter of chapters) {
      sentencesByChapter.set(chapter.id, sentencesOf(chapter.id, chapter.content));
    }
    const byId = new Map(chapters.map((c) => [c.id, c]));

    const views = comments.map((comment): CommentView => {
      const chapter = comment.chapterId ? byId.get(comment.chapterId) : undefined;
      const sentences = chapter ? (sentencesByChapter.get(chapter.id) ?? []) : [];
      const match =
        comment.quotedText && sentences.length > 0
          ? findAnchor(comment.quotedText, sentences, COMMENT.reanchorSimilarity)
          : null;
      const currentText = match
        ? sentences
            .filter((s) => s.to > match.from && s.from < match.to)
            .map((s) => s.text)
            .join(' ')
        : null;
      return {
        id: comment.id,
        chapterId: comment.chapterId,
        chapterTitle: chapter?.title ?? null,
        chapterOrder: chapter?.order ?? null,
        authorEmail: comment.authorEmail,
        body: comment.body,
        quotedText: comment.quotedText,
        anchorKey: comment.anchorKey,
        class: comment.class,
        status: comment.status,
        suggestedRevision: comment.suggestedRevision,
        resolutionNote: comment.resolutionNote,
        resolvedAt: comment.resolvedAt?.toISOString() ?? null,
        createdAt: comment.createdAt.toISOString(),
        anchor: match ? { from: match.from, to: match.to } : null,
        currentText: currentText || comment.quotedText,
      };
    });

    // D.2.4's order.
    return views.sort(
      (a, b) =>
        (a.chapterOrder ?? 999) - (b.chapterOrder ?? 999) ||
        (CLASS_ORDER[a.class ?? ''] ?? 3) - (CLASS_ORDER[b.class ?? ''] ?? 3) ||
        (a.anchor?.from ?? 0) - (b.anchor?.from ?? 0),
    );
  }

  /** How many are open and how many are answered — the review queue's heading, without the rows. */
  async counts(user: SessionUser, documentId: string): Promise<{ open: number; done: number }> {
    await this.access(user, documentId);
    const groups = await this.prisma.comment.groupBy({
      by: ['status'],
      where: { documentId },
      _count: { _all: true },
    });
    let open = 0;
    let done = 0;
    for (const g of groups) {
      if (g.status === 'OPEN') open += g._count._all;
      else done += g._count._all;
    }
    return { open, done };
  }

  /**
   * A.14, on one comment, when the student asks (D.2.3). Capped as `COMMAND`.
   *
   * The revision is stored and shown; it is not applied. That is the difference between a tool
   * that helps a student answer their supervisor and one that answers for them.
   */
  async suggest(user: SessionUser, documentId: string, commentId: string): Promise<CommentView> {
    const { isOwner } = await this.access(user, documentId);
    if (!isOwner) throw new ForbiddenError('Only the student can ask for a revision.');

    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, documentId },
    });
    if (!comment) throw new NotFoundError('That comment');
    if (!comment.chapterId || !comment.quotedText) {
      throw new ValidationError(
        'That comment is not attached to a passage, so there is nothing to revise.',
      );
    }

    const chapter = await this.prisma.chapter.findUniqueOrThrow({
      where: { id: comment.chapterId },
      select: {
        id: true,
        title: true,
        documentId: true,
        content: true,
        scopeNote: true,
        outlineNodeId: true,
        // §2.2: the prompts answer in the document's language.
        document: { select: { language: true } },
      },
    });
    const sentences = sentencesOf(chapter.id, chapter.content);
    const match = findAnchor(comment.quotedText, sentences, COMMENT.reanchorSimilarity);
    if (!match) {
      throw new ValidationError(
        'The passage this comment points at has changed too much to revise automatically. Edit it yourself and mark the comment as edited.',
      );
    }

    // A.14: the target is the anchored range expanded to paragraph bounds, with one paragraph of
    // context each side.
    const target = sentences
      .filter((s) => s.to > match.from && s.from < match.to)
      .map((s) => s.text)
      .join(' ');
    const index = sentences.findIndex((s) => s.to > match.from);
    const contextBefore = sentences
      .slice(Math.max(0, index - 3), Math.max(0, index))
      .map((s) => s.text)
      .join(' ');
    const contextAfter = sentences
      .slice(index + 1, index + 4)
      .map((s) => s.text)
      .join(' ');

    const cap = await this.usage.consume(user.id, user.plan as Plan, 'COMMAND');
    if (!cap.ok) throw refusal('COMMAND', cap);

    const memory = await this.context.memoryBlock(chapter);
    // A.14 wants six passages for the target text; `CHAT` retrieves eight and the slice below
    // takes six — the same shape the section commands use, for the same reason.
    const retrieved = await this.context.retrieve(chapter, `${comment.body}\n${target}`, 'CHAT');
    const passages = retrieved.passages.slice(0, COMMENT.revisePassages);

    const request = buildReviseRequest({
      memoryBlock: memory.text,
      comment: comment.body,
      commentClass: (comment.class ?? 'CLARIFICATION') as CommentClass,
      target,
      contextBefore,
      contextAfter,
      passages,
      userId: user.id,
      documentId,
    });

    const startedAt = Date.now();
    let text = '';
    let modelId = this.providers.llm.modelIdFor('strong');
    let usage: {
      inputTokens: number;
      cachedInputTokens?: number;
      cacheWriteTokens?: number;
      outputTokens: number;
    } | null = null;
    try {
      for await (const chunk of this.providers.llm.stream(request)) {
        if (chunk.type === 'text') text += chunk.text;
        else {
          usage = chunk.usage;
          modelId = chunk.modelId;
        }
      }
    } catch (error) {
      // The student was never served, so the unit goes back (§11.5).
      await this.usage.refund(user.id, 'COMMAND');
      await this.log(
        user.id,
        documentId,
        'SCOPED_REVISION',
        'strong',
        modelId,
        null,
        Date.now() - startedAt,
        false,
        error,
      );
      throw error;
    }
    await this.log(
      user.id,
      documentId,
      'SCOPED_REVISION',
      'strong',
      modelId,
      usage,
      Date.now() - startedAt,
      true,
    );

    const processed = postProcessRevision(
      text,
      target,
      passages.map((p) => p.id),
    );
    if (processed.hallucinated.length > 0) {
      this.logger.warn(
        { commentId, keys: processed.hallucinated },
        'HALLUCINATED_CITE in scoped revision',
      );
    }

    await this.prisma.comment.update({
      where: { id: comment.id },
      data: { suggestedRevision: processed.text },
    });
    const views = await this.list(user, documentId);
    return views.find((c) => c.id === commentId) as CommentView;
  }

  /**
   * D.2.3's transitions. `ACCEPT` is the only one that touches the chapter, and it does so through
   * the caller (which snapshots first and applies the range) — this records the outcome.
   */
  async resolve(
    user: SessionUser,
    documentId: string,
    commentId: string,
    outcome: 'ACCEPTED' | 'EDITED' | 'REJECTED' | 'OPEN',
    note?: string,
  ): Promise<CommentView> {
    const { isOwner } = await this.access(user, documentId);
    const comment = await this.prisma.comment.findFirst({ where: { id: commentId, documentId } });
    if (!comment) throw new NotFoundError('That comment');

    // A guide may reopen what they raised; only the student closes one (D.2.3).
    if (!isOwner && outcome !== 'OPEN') {
      throw new ForbiddenError('Only the student can resolve a comment.');
    }
    if (outcome === 'REJECTED' && (note ?? '').trim().length < 10) {
      throw new ValidationError(
        'Say why in at least ten characters — the reason is printed in the response to your committee.',
      );
    }

    await this.prisma.comment.update({
      where: { id: commentId },
      data: {
        status: outcome,
        resolutionNote: note?.trim() || null,
        resolvedAt: outcome === 'OPEN' ? null : new Date(),
      },
    });
    const views = await this.list(user, documentId);
    return views.find((c) => c.id === commentId) as CommentView;
  }

  private async log(
    userId: string,
    documentId: string,
    action: 'CLASSIFY_COMMENT' | 'SCOPED_REVISION',
    tier: 'fast' | 'strong',
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
        ? computeCallCost({ tier, modelId: model, usage })
        : 0;
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
