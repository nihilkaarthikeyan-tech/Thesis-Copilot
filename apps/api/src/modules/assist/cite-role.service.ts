/**
 * Citation role rewrite — PRD FR-5.6, ADR-0010.
 *
 * "Narrative ↔ parenthetical rewrite on request (strong tier; language task)." One Strong call,
 * metered as `COMMAND` (ADR-0008's reasoning: the same kind of act as a section command, and the
 * ₹100 ceiling has no room for a cap of its own).
 *
 * Like every other rewrite in the product, this one does not touch the chapter. It answers with
 * the sentence as it would read and a word-level diff, and the editor applies it when the student
 * presses Apply — §12.3, "flag, don't fix". A feature whose entire job is to rewrite a sentence is
 * exactly where that rule is easiest to forget.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildCiteRoleRequest,
  type CitationRole,
  commandResultSchema,
  type DiffOp,
  diffWords,
  type Providers,
  postProcessCiteRole,
} from '@tc/ai';
import { computeCallCost, type Env, type Plan } from '@tc/config';
import { ENV } from '../../common/env.token.js';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { aiCallLatency, aiCostMicroInr, capExceeded } from '../../common/metrics.js';
import { PrismaService } from '../../common/prisma.service.js';
import { PROVIDERS } from '../ai/ai.module.js';
import type { SessionUser } from '../auth/current-user.decorator.js';
import { refusal, UsageService } from '../usage/usage.service.js';
import { ContextService } from './context.service.js';

export type CiteRoleInput = {
  chapterId: string;
  /** The citation node's key, as the editor knows it. */
  citationId: string;
  targetRole: CitationRole;
  /** The sentence the citation sits in, exactly as the chapter reads now. */
  sentence: string;
};

export type CiteRoleResult = {
  sentence: string;
  diff: DiffOp[];
  targetRole: CitationRole;
  unchanged: boolean;
  /** Set when the rewrite broke a rule and was refused; the sentence is then the original. */
  refusal: string | null;
};

@Injectable()
export class CiteRoleService {
  private readonly logger = new Logger(CiteRoleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly context: ContextService,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async run(user: SessionUser, input: CiteRoleInput): Promise<CiteRoleResult> {
    const sentence = input.sentence.trim();
    if (!sentence) throw new ValidationError('There is no sentence to rewrite.');
    if (!sentence.includes(`{{cite:${input.citationId}}}`)) {
      // Without the marker there is nothing to move, and the model would invent a place for it.
      throw new ValidationError('That citation is not in the sentence you sent.');
    }

    const chapter = await this.prisma.chapter.findFirst({
      where: { id: input.chapterId, document: { ownerId: user.id } },
      select: {
        id: true,
        title: true,
        scopeNote: true,
        documentId: true,
        outlineNodeId: true,
        content: true,
        document: { select: { language: true } },
      },
    });
    if (!chapter) throw new NotFoundError('That chapter');

    const cap = await this.usage.consume(user.id, user.plan as Plan, 'COMMAND');
    if (!cap.ok) {
      capExceeded.inc({ action: 'COMMAND' });
      throw refusal('COMMAND', cap);
    }

    const memory = await this.context.memoryBlock(chapter);
    const request = buildCiteRoleRequest({
      sentence,
      citationId: input.citationId,
      targetRole: input.targetRole,
      memoryBlock: memory.text,
      userId: user.id,
      documentId: chapter.documentId,
    });

    const startedAt = Date.now();
    let modelId = this.providers.llm.modelIdFor('strong');
    try {
      const result = await this.providers.llm.complete({
        ...request,
        schema: commandResultSchema,
      });
      modelId = result.modelId;
      const latencyMs = Date.now() - startedAt;
      aiCallLatency.observe({ action: 'COMMAND', tier: 'strong' }, latencyMs);

      const processed = postProcessCiteRole(result.value.text, sentence, input.citationId);
      if (processed.refusal) {
        this.logger.warn(
          { chapterId: chapter.id, citationId: input.citationId, refusal: processed.refusal },
          'citation role rewrite refused',
        );
      }
      await this.log(user.id, chapter.documentId, modelId, result.usage, latencyMs, true);

      return {
        sentence: processed.sentence,
        diff:
          processed.ok && !processed.unchanged
            ? diffWords(sentence, processed.sentence)
            : [{ type: 'same', text: sentence }],
        targetRole: input.targetRole,
        unchanged: !processed.ok || processed.unchanged,
        refusal: processed.refusal,
      };
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
      throw error;
    }
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
