/**
 * Citation suggestion — PRD §9.3 `POST /citations/suggest`, FR-4.5, A.3, PHASES 3.6.
 *
 * The same §10.2 sequence as Assist, with one extra gate in front of it: the claim heuristic. A
 * sentence that states nothing about prior work never reaches a provider call, so it costs the
 * student neither a CITE unit nor an interruption.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildCiteRequest,
  CITE,
  citeResultSchema,
  detectClaim,
  type Providers,
  usableCandidates,
} from '@tc/ai';
import { computeCallCost, type Env } from '@tc/config';
import { ENV } from '../../common/env.token.js';
import { NotFoundError } from '../../common/errors.js';
import {
  aiCallLatency,
  aiCostMicroInr,
  capExceeded,
  hallucinatedCite,
} from '../../common/metrics.js';
import { PrismaService } from '../../common/prisma.service.js';
import { PROVIDERS } from '../ai/ai.module.js';
import { refusal, UsageService } from '../usage/usage.service.js';
import { ContextService } from './context.service.js';

export type CiteSuggestion = {
  /** The prompt id, so the client can round-trip it. */
  key: string;
  sourceId: string;
  chunkId: string;
  support: 'direct' | 'partial';
  /** A.3's ≤ 20-word justification, quoted or closely paraphrased from the passage. */
  why: string;
  /** The passage itself, so the student judges it rather than trusting the model. */
  passage: string;
  page: number | null;
  shortRef: string;
  /** The label to render on the inserted citation node. */
  rendered: string;
};

export type CiteSuggestResult = {
  suggestions: CiteSuggestion[];
  /** False when the heuristic declined; no cap unit was spent. */
  triggered: boolean;
  reasons: string[];
};

@Injectable()
export class CiteService {
  private readonly logger = new Logger(CiteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
    private readonly context: ContextService,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async suggest(
    user: { id: string; plan: string },
    chapterId: string,
    sentence: string,
  ): Promise<CiteSuggestResult> {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, document: { ownerId: user.id } },
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
    if (!chapter) throw new NotFoundError('That chapter');

    // FR-4.5's gate. Declining here is free: no provider call, no cap unit, no interruption.
    const claim = detectClaim(sentence);
    if (!claim.isClaim) {
      return { suggestions: [], triggered: false, reasons: [] };
    }

    // Retrieval before the cap check: with nothing to cite there is nothing to charge for.
    const retrieved = await this.context.retrieve(chapter, sentence, 'CHAT');
    const passages = retrieved.passages.slice(0, CITE.topK);
    if (passages.length === 0) {
      return { suggestions: [], triggered: false, reasons: claim.reasons };
    }

    const cap = await this.usage.consume(
      user.id,
      user.plan as Parameters<UsageService['consume']>[1],
      'CITE',
    );
    if (!cap.ok) {
      capExceeded.inc({ action: 'CITE' });
      throw refusal('CITE', cap);
    }

    const memory = await this.context.memoryBlock(chapter);
    const request = buildCiteRequest({
      memoryBlock: memory.text,
      sentence,
      passages,
      userId: user.id,
      documentId: chapter.documentId,
    });

    const startedAt = Date.now();
    let modelId = this.providers.llm.modelIdFor('fast');
    try {
      const result = await this.providers.llm.complete({ ...request, schema: citeResultSchema });
      modelId = result.modelId;
      const latencyMs = Date.now() - startedAt;
      aiCallLatency.observe({ action: 'CITE', tier: 'fast' }, latencyMs);

      const { candidates, hallucinated } = usableCandidates(
        result.value,
        passages.map((p) => p.id),
        { sentence, passages },
      );
      for (const id of hallucinated) {
        hallucinatedCite.inc();
        this.logger.warn({ chapterId, id }, 'HALLUCINATED_CITE');
      }

      await this.log(user.id, chapter.documentId, modelId, result.usage, latencyMs, true);

      const byId = new Map(passages.map((p) => [p.id, p]));
      const suggestions = candidates.flatMap((candidate): CiteSuggestion[] => {
        const passage = byId.get(candidate.id);
        const real = retrieved.byKey.get(candidate.id);
        if (!passage || !real) return [];
        return [
          {
            key: candidate.id,
            sourceId: real.sourceId,
            chunkId: real.chunkId,
            support: candidate.support === 'direct' ? 'direct' : 'partial',
            why: candidate.why,
            passage: passage.text,
            page: passage.page,
            shortRef: real.shortRef,
            rendered: `(${real.shortRef})`,
          },
        ];
      });

      return { suggestions, triggered: true, reasons: claim.reasons };
    } catch (error) {
      // The student was never served, so the unit goes back (§11.5).
      await this.usage.refund(user.id, 'CITE');
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
        ? computeCallCost({ tier: 'fast', modelId: model, usage })
        : 0;
    if (cost > 0) aiCostMicroInr.inc({ action: 'CITE' }, cost);
    await this.prisma.aiCallLog.create({
      data: {
        userId,
        documentId,
        action: 'CITE',
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
