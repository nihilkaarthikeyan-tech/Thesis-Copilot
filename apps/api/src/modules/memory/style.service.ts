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
  /** The student's own note on their voice (ADR-0025), kept across every re-learn. */
  guidance: string;
  /** When "Re-learn my style" can next run — once a day, because it is a Strong-tier call. */
  relearnAvailableAt: string | null;
};

/** ADR-0025: re-learning is a Strong call on the student's click, so it is rationed. */
export const RELEARN_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const GUIDANCE_MAX_CHARS = 300;

/**
 * PRD §12.3: nothing in this product helps text pass as unassisted. Guidance is the student's own
 * words to the model, so it is the one place they could ask for that; such a note is refused with
 * the reason rather than stored. Narrow on purpose — "use 'detector' consistently" is fine in a
 * physics thesis.
 */
const EVASION =
  /\b(?:ai[- ]?(?:detect\w*|checkers?)|undetectable|turnitin|gptzero|zerogpt|humani[sz]\w*|bypass\w*|pass(?:es)? as human|sounds? (?:more )?human)\b/i;

type StoredProfile = { learnedAt?: string; guidance?: string } & Record<string, unknown>;

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
    const profile = memory?.styleProfile as StoredProfile | null;
    return this.statusOf(humanWords, profile);
  }

  private statusOf(humanWords: number, profile: StoredProfile | null): StyleStatus {
    const learnedAt = profile?.learnedAt ?? null;
    return {
      humanWords,
      thresholdWords: STYLE.thresholdWords,
      eligible: humanWords >= STYLE.thresholdWords,
      // A profile that is only the student's guidance has not been learned yet.
      profile: learnedAt ? profile : null,
      learnedAt,
      guidance: profile?.guidance ?? '',
      relearnAvailableAt: learnedAt
        ? new Date(Date.parse(learnedAt) + RELEARN_INTERVAL_MS).toISOString()
        : null,
    };
  }

  /**
   * ADR-0025: the student's own note on their voice — "British spelling", "call them farmers, not
   * respondents". It rides in the style profile, which A.0.1 already renders into every prompt, and
   * it survives re-learning: the model's reading of the student is replaced, their words are not.
   */
  async setGuidance(ownerId: string, documentId: string, guidance: string): Promise<StyleStatus> {
    const note = guidance.replace(/\s+/g, ' ').trim();
    if (note.length > GUIDANCE_MAX_CHARS) {
      throw new ValidationError(`Keep it under ${GUIDANCE_MAX_CHARS} characters.`);
    }
    if (EVASION.test(note)) {
      throw new ValidationError(
        'Thesis Copilot does not help text pass AI detection or hide that it was assisted (PRD §12.3). Everything the AI writes is marked, and your usage log says so.',
      );
    }
    const { humanWords } = await this.sample(ownerId, documentId);
    const memory = await this.prisma.documentMemory.findUnique({
      where: { documentId },
      select: { styleProfile: true },
    });
    const profile: StoredProfile = {
      ...((memory?.styleProfile as StoredProfile | null) ?? {}),
      guidance: note,
    };
    await this.prisma.documentMemory.update({
      where: { documentId },
      data: { styleProfile: profile as never },
    });
    return this.statusOf(humanWords, profile);
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

    const existing = (
      await this.prisma.documentMemory.findUnique({
        where: { documentId },
        select: { styleProfile: true },
      })
    )?.styleProfile as StoredProfile | null;
    // Once a day at most — the button is one click from a Strong-tier call (ADR-0025).
    const lastLearned = existing?.learnedAt ? Date.parse(existing.learnedAt) : Number.NaN;
    if (!force && Number.isFinite(lastLearned) && Date.now() - lastLearned < RELEARN_INTERVAL_MS) {
      throw new ValidationError(
        'Your style was learned in the last day. It can be re-learned once a day — write some more first.',
      );
    }

    const request = buildStyleRequest({ sample: text, userId: ownerId, documentId });
    const startedAt = Date.now();
    let modelId = this.providers.llm.modelIdFor('strong');
    try {
      const result = await this.providers.llm.complete({ ...request, schema: styleProfileSchema });
      modelId = result.modelId;
      await this.log(ownerId, documentId, modelId, result.usage, Date.now() - startedAt, true);
      const profile: StoredProfile = {
        ...result.value,
        learnedAt: new Date().toISOString(),
        fromWords: humanWords,
        // The student's own note outlives every re-learn.
        ...(existing?.guidance ? { guidance: existing.guidance } : {}),
      };
      await this.prisma.documentMemory.update({
        where: { documentId },
        data: { styleProfile: profile as never },
      });
      this.logger.log({ documentId, humanWords, voice: profile.voice }, 'style profile learned');
      return this.statusOf(humanWords, profile);
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
    // Learned already — not merely holding the student's guidance (ADR-0025).
    if ((memory?.styleProfile as StoredProfile | null)?.learnedAt) return false;
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
