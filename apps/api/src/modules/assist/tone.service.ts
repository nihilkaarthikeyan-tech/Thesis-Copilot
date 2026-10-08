/**
 * `POST /tone-review` — ADR-0084. One chapter, read against a sample of the tone the student
 * wants: their own writing profile (A.10), or a passage of a library paper they chose. Each
 * sentence whose tone clearly differs comes back with a rewrite, for the student to accept or
 * dismiss in the editor, as proofreading's corrections do. Nothing here changes the chapter.
 *
 * One `COMMAND` unit a run, charged before the first call and refunded if nothing was served
 * (§11.5); up to `TONE.maxWords` words a run, in batches, with `nextSentence` for the rest.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildToneRequest,
  type Providers,
  paperSample,
  postProcessTone,
  renderStyleSample,
  type StyleProfile,
  TONE,
  type ToneItem,
  toneSchema,
} from '@tc/ai';
import { computeCallCost, type Env } from '@tc/config';
import { blocksOf, sentencesOf } from '@tc/retrieval';
import { ENV } from '../../common/env.token.js';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { aiCostMicroInr, capExceeded } from '../../common/metrics.js';
import { PrismaService } from '../../common/prisma.service.js';
import { PROVIDERS } from '../ai/ai.module.js';
import { refusal, UsageService } from '../usage/usage.service.js';
import { type CheckRange, sentencesInRange } from './check-range.js';

export type ToneCorrection = ToneItem & { sentence: string; near: number };

export type ToneRunResult = {
  corrections: ToneCorrection[];
  checkedWords: number;
  totalWords: number;
  refused: number;
  nextSentence: number | null;
  /** What the chapter was compared with, in the student's words. */
  sample: { kind: 'profile' | 'paper'; label: string };
};

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

@Injectable()
export class ToneService {
  private readonly logger = new Logger(ToneService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async run(
    user: { id: string; plan: string },
    chapterId: string,
    /** `range` (R26, ADR-0126): only the sentences inside it — one paragraph. */
    options: { sampleSourceId?: string; fromSentence?: number; range?: CheckRange } = {},
  ): Promise<ToneRunResult> {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, document: { ownerId: user.id } },
      select: {
        id: true,
        documentId: true,
        content: true,
        document: { select: { language: true } },
      },
    });
    if (!chapter) throw new NotFoundError('That chapter');

    const sample = await this.sampleFor(chapter.documentId, options.sampleSourceId);

    const drafts = blocksOf(chapter.content).filter((b) => b.type === 'draftBlock');
    const sentences = sentencesInRange(
      sentencesOf(chapter.id, chapter.content).filter(
        (s) => /\p{L}{2}/u.test(s.text) && !drafts.some((d) => s.from >= d.from && s.to <= d.to),
      ),
      options.range,
    );
    const totalWords = sentences.reduce((n, s) => n + wordCount(s.text), 0);
    const toCheck: typeof sentences = [];
    let checkedWords = 0;
    let next = Math.max(0, options.fromSentence ?? 0);
    for (; next < sentences.length; next++) {
      const sentence = sentences[next] as (typeof sentences)[number];
      const n = wordCount(sentence.text);
      if (checkedWords + n > TONE.maxWords && toCheck.length > 0) break;
      toCheck.push(sentence);
      checkedWords += n;
    }
    const nextSentence = next < sentences.length ? next : null;
    if (toCheck.length === 0) {
      return {
        corrections: [],
        checkedWords: 0,
        totalWords,
        refused: 0,
        nextSentence: null,
        sample: sample.summary,
      };
    }

    const cap = await this.usage.consume(
      user.id,
      user.plan as Parameters<UsageService['consume']>[1],
      'COMMAND',
    );
    if (!cap.ok) {
      capExceeded.inc({ action: 'COMMAND' });
      throw refusal('COMMAND', cap);
    }

    const corrections: ToneCorrection[] = [];
    let refused = 0;
    let served = 0;
    try {
      for (let i = 0; i < toCheck.length; i += TONE.batch) {
        const batch = toCheck.slice(i, i + TONE.batch);
        const request = buildToneRequest({
          sentences: batch.map((s) => ({ id: s.id, text: s.text })),
          sample: sample.text,
          language: chapter.document.language,
          userId: user.id,
          documentId: chapter.documentId,
          signal: AbortSignal.timeout(60_000),
        });
        const startedAt = Date.now();
        let modelId = this.providers.llm.modelIdFor('fast');
        try {
          const result = await this.providers.llm.complete({ ...request, schema: toneSchema });
          modelId = result.modelId;
          await this.log(
            user.id,
            chapter.documentId,
            modelId,
            result.usage,
            Date.now() - startedAt,
            true,
          );
          served += 1;
          const checked = postProcessTone(result.value, batch);
          refused += checked.refused;
          const byId = new Map(batch.map((s) => [s.id, s]));
          for (const item of checked.items) {
            const sentence = byId.get(item.sentenceId);
            if (!sentence) continue;
            corrections.push({ ...item, sentence: sentence.text, near: sentence.from });
          }
        } catch (error) {
          await this.log(
            user.id,
            chapter.documentId,
            modelId,
            null,
            Date.now() - startedAt,
            false,
            error,
          );
          if (served === 0) throw error;
          this.logger.warn({ err: error, chapterId }, 'tone batch failed; returning the rest');
          break;
        }
      }
    } catch (error) {
      await this.usage.refund(user.id, 'COMMAND');
      throw error;
    }
    this.logger.log(
      { chapterId, sample: sample.summary.kind, items: corrections.length, refused },
      'tone review',
    );
    return { corrections, checkedWords, totalWords, refused, nextSentence, sample: sample.summary };
  }

  /** The sample: a chosen paper's first passages, else the learned writing profile. */
  private async sampleFor(
    documentId: string,
    sampleSourceId: string | undefined,
  ): Promise<{ text: string; summary: ToneRunResult['sample'] }> {
    if (sampleSourceId) {
      const source = await this.prisma.source.findFirst({
        where: { id: sampleSourceId, documentId },
        select: {
          title: true,
          authors: true,
          year: true,
          chunks: { orderBy: { ordinal: 'asc' }, take: 12, select: { text: true } },
        },
      });
      if (!source) throw new NotFoundError('That paper');
      const text = paperSample(source.chunks.map((c) => c.text));
      if (wordCount(text) < 80) {
        throw new ValidationError(
          'That paper has too little readable text to be a model. Choose one with its full text, or your own profile.',
        );
      }
      const first = Array.isArray(source.authors)
        ? ((source.authors[0] as { family?: string } | undefined)?.family ?? '')
        : '';
      const label = `${first || source.title?.slice(0, 40) || 'the paper'}${source.year ? ` ${source.year}` : ''}`;
      return { text, summary: { kind: 'paper', label } };
    }
    const memory = await this.prisma.documentMemory.findUnique({
      where: { documentId },
      select: { styleProfile: true },
    });
    const stored = memory?.styleProfile as
      | (StyleProfile & { learnedAt?: string; guidance?: string })
      | null;
    if (!stored?.learnedAt) {
      throw new ValidationError(
        'There is no writing profile to compare with yet. Write about 300 words of your own first, or choose a paper from your library as the model.',
      );
    }
    return {
      text: renderStyleSample(stored, stored.guidance ?? ''),
      summary: { kind: 'profile', label: 'your own writing profile' },
    };
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
    if (cost > 0) aiCostMicroInr.inc({ action: 'COMMAND' }, cost);
    await this.prisma.aiCallLog.create({
      data: {
        userId,
        documentId,
        action: 'COMMAND',
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
