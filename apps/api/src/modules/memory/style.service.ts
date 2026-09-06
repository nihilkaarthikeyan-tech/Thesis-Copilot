/**
 * Style profile — PRD FR-4.7, §9.3 `POST /documents/:id/style-profile`, A.10, PHASES v2 W9.1.
 *
 * Counted from provenance, not from the chapter word count: a document full of accepted drafts
 * never reaches the threshold, which is the point of FR-4.7. The profile goes into
 * `DocumentMemory.styleProfile`, which `buildMemoryBlock` already renders into the cached block,
 * so the next suggestion is in the student's voice without any other change.
 *
 * The call is Strong and once per document until the student asks again ("Re-learn my style"),
 * so it is amortised like `EXTRACT` (§11.4) rather than capped.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { buildStyleRequest, humanText, type Providers, STYLE, styleProfileSchema } from '@tc/ai';
import { computeCallCost, type Env } from '@tc/config';
import { ENV } from '../../common/env.token.js';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { PROVIDERS } from '../ai/ai.module.js';

export type StyleStatus = {
  humanWords: number;
  thresholdWords: number;
  eligible: boolean;
  profile: unknown;
  /** ISO timestamp of the last successful inference, when there is one. */
  learnedAt: string | null;
};

@Injectable()
export class StyleService {
  private readonly logger = new Logger(StyleService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Words of the student's own text across the document, and whether a profile can be inferred. */
  async status(ownerId: string, documentId: string): Promise<StyleStatus> {
    const { humanWords } = await this.sample(ownerId, documentId);
    const memory = await this.prisma.documentMemory.findUnique({
      where: { documentId },
      select: { styleProfile: true },
    });
    const profile = memory?.styleProfile as { learnedAt?: string } | null;
    return {
      humanWords,
      thresholdWords: STYLE.thresholdWords,
      eligible: humanWords >= STYLE.thresholdWords,
      profile: profile ?? null,
      learnedAt: profile?.learnedAt ?? null,
    };
  }

  /**
   * `POST /documents/:id/style-profile`. Refuses below the threshold rather than inferring from
   * too little text — a profile from 200 words would be noise the cached block then carries.
   */
  async learn(ownerId: string, documentId: string, force = false): Promise<StyleStatus> {
    const { humanWords, text } = await this.sample(ownerId, documentId);
    if (!force && humanWords < STYLE.thresholdWords) {
      throw new ValidationError(
        `Write about ${STYLE.thresholdWords - humanWords} more words of your own first; a style profile needs ${STYLE.thresholdWords}.`,
      );
    }
    if (text.trim().length === 0) throw new ValidationError('There is no text of your own yet.');

    const request = buildStyleRequest({ sample: text, userId: ownerId, documentId });
    const startedAt = Date.now();
    let modelId = this.providers.llm.modelIdFor('strong');
    try {
      const result = await this.providers.llm.complete({ ...request, schema: styleProfileSchema });
      modelId = result.modelId;
      await this.log(ownerId, documentId, modelId, result.usage, Date.now() - startedAt, true);
      const profile = {
        ...result.value,
        learnedAt: new Date().toISOString(),
        fromWords: humanWords,
      };
      await this.prisma.documentMemory.update({
        where: { documentId },
        data: { styleProfile: profile as never },
      });
      this.logger.log({ documentId, humanWords, voice: profile.voice }, 'style profile learned');
      return {
        humanWords,
        thresholdWords: STYLE.thresholdWords,
        eligible: true,
        profile,
        learnedAt: profile.learnedAt,
      };
    } catch (error) {
      await this.log(ownerId, documentId, modelId, null, Date.now() - startedAt, false, error);
      throw error;
    }
  }

  /**
   * Called after a chapter save: infers the profile the first time the document passes the
   * threshold, and never again on its own. Failure is swallowed — a save must not fail because a
   * style call did.
   */
  async maybeLearn(ownerId: string, documentId: string): Promise<boolean> {
    const memory = await this.prisma.documentMemory.findUnique({
      where: { documentId },
      select: { styleProfile: true },
    });
    if (memory?.styleProfile) return false;
    const { humanWords } = await this.sample(ownerId, documentId);
    if (humanWords < STYLE.thresholdWords) return false;
    try {
      await this.learn(ownerId, documentId);
      return true;
    } catch (error) {
      this.logger.warn(
        { err: error, documentId },
        'style profile inference failed; will retry later',
      );
      return false;
    }
  }

  /** HUMAN-provenance words and text across every chapter, oldest first. */
  private async sample(
    ownerId: string,
    documentId: string,
  ): Promise<{ humanWords: number; text: string }> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: {
        id: true,
        chapters: { orderBy: { order: 'asc' }, select: { content: true } },
      },
    });
    if (!document) throw new NotFoundError('That document');

    let humanWords = 0;
    const parts: string[] = [];
    for (const chapter of document.chapters) {
      const { words, text } = humanText(chapter.content);
      humanWords += words;
      if (text) parts.push(text);
    }
    return { humanWords, text: parts.join('\n\n') };
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
        action: 'STYLE_PROFILE',
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
