/**
 * `POST /equations/from-words` — an equation described in words (ADR-0063; the Jenni study,
 * coverage-map row 70). One COMMAND unit, taken atomically before the provider call and given
 * back when the provider fails or answers with LaTeX that does not render: the student is charged
 * for an equation they can use, not for one the model could not write.
 *
 * Nothing is inserted here. The answer goes back to the equation field, where the student sees it
 * rendered and read back in words, can edit it, and presses Insert — flag, don't fix.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildEquationRequest,
  EQUATION,
  equationResultSchema,
  type Providers,
  postProcessEquation,
} from '@tc/ai';
import { computeCallCost, type Env, type Plan } from '@tc/config';
import { ENV } from '../../common/env.token.js';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { aiCallLatency, aiCostMicroInr, capExceeded } from '../../common/metrics.js';
import { PrismaService } from '../../common/prisma.service.js';
import { PROVIDERS } from '../ai/ai.module.js';
import type { SessionUser } from '../auth/current-user.decorator.js';
import { refusal, UsageService } from '../usage/usage.service.js';

export type EquationInput = { documentId: string; description: string; current?: string | null };

export type EquationAnswer =
  | { ok: true; latex: string; reading: string }
  | { ok: false; refusal: string; reading: string };

/** How long one equation may take before it is given up (CLAUDE.md: no model call without one). */
const TIMEOUT_MS = 30_000;

@Injectable()
export class EquationService {
  private readonly logger = new Logger(EquationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async fromWords(user: SessionUser, input: EquationInput): Promise<EquationAnswer> {
    const description = input.description.trim();
    if (!description) throw new ValidationError('Describe the equation first.');
    if (description.length > EQUATION.maxDescriptionChars) {
      throw new ValidationError(
        `Describe one equation at a time, in under ${EQUATION.maxDescriptionChars} characters.`,
      );
    }
    const document = await this.prisma.document.findFirst({
      where: { id: input.documentId, ownerId: user.id },
      select: { id: true },
    });
    if (!document) throw new NotFoundError('That document');

    const cap = await this.usage.consume(user.id, user.plan as Plan, 'COMMAND');
    if (!cap.ok) {
      capExceeded.inc({ action: 'COMMAND' });
      throw refusal('COMMAND', cap);
    }

    const request = buildEquationRequest({
      description,
      current: input.current ?? null,
      userId: user.id,
      documentId: document.id,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const startedAt = Date.now();
    let modelId = this.providers.llm.modelIdFor(EQUATION.tier);
    try {
      const result = await this.providers.llm.complete({
        ...request,
        schema: equationResultSchema,
      });
      modelId = result.modelId;
      const latencyMs = Date.now() - startedAt;
      aiCallLatency.observe({ action: 'COMMAND', tier: EQUATION.tier }, latencyMs);
      await this.log(user.id, document.id, modelId, result.usage, latencyMs, true);

      const processed = postProcessEquation(result.value);
      if (!processed.ok) {
        // A refusal the student can do nothing with is not worth a unit.
        await this.usage.refund(user.id, 'COMMAND');
        this.logger.warn(
          { documentId: document.id, refusal: processed.refusal },
          'equation refused',
        );
      }
      return processed;
    } catch (error) {
      await this.usage.refund(user.id, 'COMMAND');
      await this.log(user.id, document.id, modelId, null, Date.now() - startedAt, false, error);
      this.logger.error({ err: error, documentId: document.id }, 'equation from words failed');
      return {
        ok: false,
        refusal: 'The equation could not be written just now. Nothing was charged; try again.',
        reading: '',
      };
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
        ? computeCallCost({ tier: EQUATION.tier, modelId: model, usage })
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
