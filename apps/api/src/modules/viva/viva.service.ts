/**
 * Viva preparation — ADR-0030.
 *
 * `generate` asks the Strong model for up to eight questions about passages of the thesis;
 * `answer` judges one typed answer against the question's passage and the ones it touches. Each
 * is one `VIVA` unit, taken before the provider is called and given back if nothing was served
 * (§10.2, §11.5). Nothing here writes to a chapter.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildVivaFeedbackRequest,
  buildVivaQuestionsRequest,
  type LlmRequest,
  type Providers,
  postProcessVivaFeedback,
  postProcessVivaQuestions,
  VIVA,
  type VivaFeedback,
  type VivaPassage,
  vivaFeedbackSchema,
  vivaQuestionsSchema,
} from '@tc/ai';
import { computeCallCost, type Env } from '@tc/config';
import type { Prisma } from '@tc/db';
import type { ZodType } from 'zod';
import { ENV } from '../../common/env.token.js';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { aiCostMicroInr, capExceeded, hallucinatedCite } from '../../common/metrics.js';
import { PrismaService } from '../../common/prisma.service.js';
import { PROVIDERS } from '../ai/ai.module.js';
import { refusal, UsageService } from '../usage/usage.service.js';
import { relatedPassages, selectVivaPassages } from './passages.js';

export type VivaQuestionView = {
  id: string;
  order: number;
  kind: string;
  question: string;
  probing: string;
  chapterId: string;
  chapterTitle: string;
  passage: string;
  /** Only while the chapter is as it was when the question was asked. */
  from?: number;
  to?: number;
  answer: string | null;
  feedback: StoredFeedback | null;
  answeredAt: string | null;
};

/** The feedback as kept: each quotation labelled with the chapter it is from, not a request id. */
export type StoredFeedback = Omit<VivaFeedback, 'thesisSays'> & {
  thesisSays: Array<{ quote: string; chapterTitle: string }>;
};

export type VivaView = {
  setId: string | null;
  createdAt: string | null;
  questions: VivaQuestionView[];
};

type Usage = {
  inputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  outputTokens: number;
};

@Injectable()
export class VivaService {
  private readonly logger = new Logger(VivaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async thesis(ownerId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: {
        id: true,
        title: true,
        chapters: {
          select: { id: true, title: true, order: true, content: true, updatedAt: true },
        },
      },
    });
    if (!document) throw new NotFoundError('That document');
    return document;
  }

  /** The latest question set, with any answers and feedback so far. */
  async view(ownerId: string, documentId: string): Promise<VivaView> {
    const document = await this.thesis(ownerId, documentId);
    const latest = await this.prisma.vivaQuestion.findFirst({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
      select: { setId: true, createdAt: true },
    });
    if (!latest) return { setId: null, createdAt: null, questions: [] };
    const rows = await this.prisma.vivaQuestion.findMany({
      where: { documentId, setId: latest.setId },
      orderBy: { order: 'asc' },
    });
    const chapters = new Map(document.chapters.map((c) => [c.id, c]));
    return {
      setId: latest.setId,
      createdAt: latest.createdAt.toISOString(),
      questions: rows.map((row) => {
        const chapter = chapters.get(row.chapterId);
        const unchanged = chapter ? chapter.updatedAt <= row.createdAt : false;
        return {
          id: row.id,
          order: row.order,
          kind: row.kind,
          question: row.question,
          probing: row.probing,
          chapterId: row.chapterId,
          chapterTitle: chapter?.title ?? 'A deleted chapter',
          passage: row.passage,
          ...(unchanged ? { from: row.from, to: row.to } : {}),
          answer: row.answer,
          feedback: (row.feedback as StoredFeedback | null) ?? null,
          answeredAt: row.answeredAt?.toISOString() ?? null,
        };
      }),
    };
  }

  async generate(user: { id: string; plan: string }, documentId: string): Promise<VivaView> {
    const document = await this.thesis(user.id, documentId);
    const passages = selectVivaPassages(document.chapters);
    // Refused before the unit is taken: there is nothing yet to be examined on.
    if (passages.length < VIVA.minPassages) {
      throw new ValidationError(
        'There is not enough of the thesis yet to be examined on. Viva questions need at least three full paragraphs of your own writing.',
      );
    }

    await this.take(user);
    let questions: ReturnType<typeof postProcessVivaQuestions>['questions'];
    try {
      const request = buildVivaQuestionsRequest({
        title: document.title,
        passages,
        userId: user.id,
        documentId,
      });
      const value = await this.call(user.id, documentId, request, vivaQuestionsSchema);
      const checked = postProcessVivaQuestions(value, new Set(passages.map((p) => p.id)));
      if (checked.dropped > 0) {
        hallucinatedCite.inc(checked.dropped);
        this.logger.warn({ documentId, dropped: checked.dropped }, 'HALLUCINATED_CITE (viva)');
      }
      if (checked.questions.length === 0) throw new Error('no usable viva question came back');
      questions = checked.questions;
    } catch (error) {
      await this.usage.refund(user.id, 'VIVA');
      throw error;
    }

    // PRD §0.2: ids are UUID v7, and the database is what makes them.
    const [generated] = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT uuid_generate_v7()::text AS id`;
    const setId = generated?.id;
    if (!setId) throw new Error('uuid_generate_v7() returned nothing');
    const byId = new Map(passages.map((p) => [p.id, p]));
    await this.prisma.vivaQuestion.createMany({
      data: questions.map((q, order) => {
        const passage = byId.get(q.passageId) as (typeof passages)[number];
        return {
          documentId,
          setId,
          order,
          kind: q.kind,
          question: q.question,
          probing: q.probing,
          chapterId: passage.chapterId,
          passage: passage.text,
          from: passage.from,
          to: passage.to,
        };
      }),
    });
    return this.view(user.id, documentId);
  }

  async answer(
    user: { id: string; plan: string },
    questionId: string,
    answer: string,
  ): Promise<VivaQuestionView> {
    const row = await this.prisma.vivaQuestion.findFirst({
      where: { id: questionId, document: { ownerId: user.id } },
    });
    if (!row) throw new NotFoundError('That question');
    const text = answer.trim();
    if (text.split(/\s+/).filter(Boolean).length < VIVA.answerMinWords) {
      throw new ValidationError('Type the answer you would give — a sentence or two at least.');
    }
    const document = await this.thesis(user.id, row.documentId);
    const own: VivaPassage = {
      id: 'p1',
      chapterTitle: document.chapters.find((c) => c.id === row.chapterId)?.title ?? 'Thesis',
      text: row.passage,
    };
    const passages: VivaPassage[] = [
      own,
      ...relatedPassages(row.passage, `${row.question} ${text}`, document.chapters).map((p, i) => ({
        id: `p${i + 2}`,
        chapterTitle: p.chapterTitle,
        text: p.text,
      })),
    ];

    await this.take(user);
    let feedback: StoredFeedback;
    try {
      const request = buildVivaFeedbackRequest({
        question: row.question,
        probing: row.probing,
        passages,
        answer: text,
        userId: user.id,
        documentId: row.documentId,
      });
      const value = await this.call(user.id, row.documentId, request, vivaFeedbackSchema);
      const checked = postProcessVivaFeedback(value, passages);
      feedback = {
        ...checked,
        thesisSays: checked.thesisSays.map((said) => ({
          quote: said.quote,
          chapterTitle: passages.find((p) => p.id === said.passageId)?.chapterTitle ?? 'Thesis',
        })),
      };
    } catch (error) {
      await this.usage.refund(user.id, 'VIVA');
      throw error;
    }

    await this.prisma.vivaQuestion.update({
      where: { id: row.id },
      data: {
        answer: text.slice(0, VIVA.answerMaxChars),
        feedback: feedback as unknown as Prisma.InputJsonValue,
        answeredAt: new Date(),
      },
    });
    const view = await this.view(user.id, row.documentId);
    const updated = view.questions.find((q) => q.id === row.id);
    // An answer to a question from an older set: return it as stored.
    return (
      updated ?? {
        id: row.id,
        order: row.order,
        kind: row.kind,
        question: row.question,
        probing: row.probing,
        chapterId: row.chapterId,
        chapterTitle: own.chapterTitle,
        passage: row.passage,
        answer: text,
        feedback,
        answeredAt: new Date().toISOString(),
      }
    );
  }

  /** §10.2: the cap check and increment, in one statement, before any provider call. */
  private async take(user: { id: string; plan: string }) {
    const cap = await this.usage.consume(
      user.id,
      user.plan as Parameters<UsageService['consume']>[1],
      'VIVA',
    );
    if (!cap.ok) {
      capExceeded.inc({ action: 'VIVA' });
      throw refusal('VIVA', cap);
    }
  }

  private async call<T>(
    userId: string,
    documentId: string,
    request: Omit<LlmRequest, 'schema'>,
    schema: ZodType<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    let modelId = this.providers.llm.modelIdFor('strong');
    try {
      const result = await this.providers.llm.complete({ ...request, schema });
      modelId = result.modelId;
      await this.log(userId, documentId, modelId, result.usage, Date.now() - startedAt, true);
      return result.value as T;
    } catch (error) {
      await this.log(userId, documentId, modelId, null, Date.now() - startedAt, false, error);
      throw error;
    }
  }

  private async log(
    userId: string,
    documentId: string,
    model: string,
    usage: Usage | null,
    latencyMs: number,
    ok: boolean,
    error?: unknown,
  ): Promise<void> {
    const cost =
      ok && usage && this.env.AI_PROVIDER !== 'mock'
        ? computeCallCost({ tier: 'strong', modelId: model, usage })
        : 0;
    if (cost > 0) aiCostMicroInr.inc({ action: 'VIVA' }, cost);
    await this.prisma.aiCallLog.create({
      data: {
        userId,
        documentId,
        action: 'VIVA',
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
