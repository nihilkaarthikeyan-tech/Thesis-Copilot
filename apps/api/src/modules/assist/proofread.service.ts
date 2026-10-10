/**
 * `POST /proofread` — ADR-0026. One chapter, read for spelling, grammar, punctuation and
 * agreement; each correction returned for the student to accept or dismiss in the editor.
 *
 * Nothing here changes the chapter. The corrections go back as data, and only the editor, on the
 * student's click, applies one — "flag, don't fix", the rule every AI feature in the product keeps.
 *
 * One `COMMAND` unit a run, charged before the first call and refunded if nothing was served
 * (§11.5). A run reads up to `PROOFREAD.maxWords` words, in batches; a long chapter is read in
 * more than one run, and the response says how far this one got.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildProofreadRequest,
  type Correction,
  PROOFREAD,
  type Providers,
  postProcessProofread,
  proofreadSchema,
} from '@tc/ai';
import { computeCallCost, type Env } from '@tc/config';
import { blocksOf, sentencesOf } from '@tc/retrieval';
import { ENV } from '../../common/env.token.js';
import { NotFoundError } from '../../common/errors.js';
import { aiCostMicroInr, capExceeded } from '../../common/metrics.js';
import { PrismaService } from '../../common/prisma.service.js';
import { PROVIDERS } from '../ai/ai.module.js';
import { PROOFREAD_RUN_KIND } from '../documents/ai-statement.service.js';
import { refusal, UsageService } from '../usage/usage.service.js';
import { type CheckRange, sentencesInRange } from './check-range.js';

export type ProofreadCorrection = Correction & {
  /** The sentence as it was read, so the editor can find the span even if positions moved. */
  sentence: string;
  /** Where the span was when the chapter was read — a hint for placing it, not an address. */
  near: number;
};

export type ProofreadRunResult = {
  corrections: ProofreadCorrection[];
  /** Words read this run, of the chapter's total. */
  checkedWords: number;
  totalWords: number;
  /** Suggestions the checks refused as larger than a correction (ADR-0026). */
  refused: number;
  /** Where the next run should start, when this one stopped short of the chapter's end. */
  nextSentence: number | null;
};

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

@Injectable()
export class ProofreadService {
  private readonly logger = new Logger(ProofreadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * `range` (R26, ADR-0126): read only the sentences inside it — one paragraph, from the block
   * handle. `fromSentence` then counts within the range.
   */
  async run(
    user: { id: string; plan: string },
    chapterId: string,
    fromSentence = 0,
    range?: CheckRange,
  ): Promise<ProofreadRunResult> {
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

    // A pending AI draft is not the student's text yet (FR-4.10), so it is not read; nor is a
    // sentence with no letters in it — a heading of "2.1" or an equation has nothing to fix.
    const drafts = blocksOf(chapter.content).filter((b) => b.type === 'draftBlock');
    const sentences = sentencesInRange(
      sentencesOf(chapter.id, chapter.content).filter(
        (s) => /\p{L}{2}/u.test(s.text) && !drafts.some((d) => s.from >= d.from && s.to <= d.to),
      ),
      range,
    );
    const totalWords = sentences.reduce((n, s) => n + wordCount(s.text), 0);
    const toCheck: typeof sentences = [];
    let checkedWords = 0;
    let next = Math.max(0, fromSentence);
    for (; next < sentences.length; next++) {
      const sentence = sentences[next] as (typeof sentences)[number];
      const words = wordCount(sentence.text);
      if (checkedWords + words > PROOFREAD.maxWords && toCheck.length > 0) break;
      toCheck.push(sentence);
      checkedWords += words;
    }
    const nextSentence = next < sentences.length ? next : null;
    // Nothing to read is not a run: no unit is charged for it.
    if (toCheck.length === 0) {
      return { corrections: [], checkedWords: 0, totalWords, refused: 0, nextSentence: null };
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

    const corrections: ProofreadCorrection[] = [];
    let refused = 0;
    let served = 0;
    try {
      for (let i = 0; i < toCheck.length; i += PROOFREAD.batch) {
        const batch = toCheck.slice(i, i + PROOFREAD.batch);
        const request = buildProofreadRequest({
          sentences: batch.map((s) => ({ id: s.id, text: s.text })),
          language: chapter.document.language,
          userId: user.id,
          documentId: chapter.documentId,
        });
        const startedAt = Date.now();
        let modelId = this.providers.llm.modelIdFor('fast');
        try {
          const result = await this.providers.llm.complete({ ...request, schema: proofreadSchema });
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
          const checked = postProcessProofread(result.value, batch);
          refused += checked.refused;
          const byId = new Map(batch.map((s) => [s.id, s]));
          for (const c of checked.corrections) {
            const sentence = byId.get(c.sentenceId);
            if (!sentence) continue;
            // The hint points at the span itself, so a word misspelled twice in the chapter is
            // corrected where this sentence has it, not at the other one.
            const near = sentence.from + Math.max(0, sentence.text.indexOf(c.original));
            corrections.push({ ...c, sentence: sentence.text, near });
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
          // A later batch failing keeps what the earlier ones found; the first failing serves nothing.
          if (served === 0) throw error;
          this.logger.warn({ err: error, chapterId }, 'proofread batch failed; returning the rest');
          break;
        }
      }
    } catch (error) {
      // §11.5: the student was never served, so the unit goes back.
      await this.usage.refund(user.id, 'COMMAND');
      throw error;
    }
    if (refused > 0)
      this.logger.log({ chapterId, refused }, 'proofread suggestions refused as rewrites');
    // ADR-0148: proofreading shares the COMMAND log with edit commands, so the AI use statement
    // can only name it if a run leaves its own mark — with the calls it made, which the statement
    // takes back out of the edit count. Not a model call; must never fail the run.
    await this.prisma.auditEvent
      .create({
        data: {
          kind: PROOFREAD_RUN_KIND,
          userId: user.id,
          documentId: chapter.documentId,
          detail: { chapterId, calls: served, checkedWords, corrections: corrections.length },
        },
      })
      .catch((error: unknown) =>
        this.logger.warn({ err: error, chapterId }, 'proofread run was not recorded'),
      );
    return { corrections, checkedWords, totalWords, refused, nextSentence };
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
