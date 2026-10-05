/**
 * The claims map — ADR-0086. One strong-tier pass over the library's papers (`claims.md`),
 * kept on `Document.meta.claims`, once per document per hour. Logged as `CROSS_PAPER`, not a
 * per-unit allowance: the cost is bounded by the hour and by the thirty papers sent.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildClaimsMapRequest,
  CLAIMS_MAP,
  type ClaimsMapPaper,
  claimsMapSchema,
  type MappedClaim,
  type Providers,
  postProcessClaimsMap,
  type ScopeForQueries,
} from '@tc/ai';
import { computeCallCost, type Env } from '@tc/config';
import { ENV } from '../../common/env.token.js';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors.js';
import { aiCostMicroInr } from '../../common/metrics.js';
import { PrismaService } from '../../common/prisma.service.js';
import { RedisService } from '../../common/redis.service.js';
import { PROVIDERS } from '../ai/ai.module.js';

export type ClaimsMap = {
  computedAt: string;
  /** The papers the map was read from, for the chips. */
  papers: Array<{ id: string; title: string; year: number | null }>;
  claims: MappedClaim[];
};

const MIN_PAPERS = 3;

@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The stored map, or null when the library has not been mapped. */
  async get(ownerId: string, documentId: string): Promise<{ map: ClaimsMap | null }> {
    const document = await this.owned(ownerId, documentId);
    const meta = (document.meta as { claims?: ClaimsMap } | null) ?? {};
    return { map: meta.claims ?? null };
  }

  async map(user: { id: string }, documentId: string): Promise<{ map: ClaimsMap }> {
    const document = await this.owned(user.id, documentId);
    const sources = await this.prisma.source.findMany({
      where: { documentId, status: 'RESOLVED' },
      orderBy: { createdAt: 'asc' },
      take: CLAIMS_MAP.maxPapers,
      select: {
        id: true,
        title: true,
        year: true,
        chunks: { orderBy: { ordinal: 'asc' }, take: 1, select: { text: true } },
      },
    });
    const papers: ClaimsMapPaper[] = sources.flatMap((s) => {
      // The first stored chunk: the abstract when that is all there is, else the paper's start.
      const text = (s.chunks[0]?.text ?? '').trim();
      return s.title && text ? [{ id: s.id, title: s.title, year: s.year, text }] : [];
    });
    if (papers.length < MIN_PAPERS) {
      throw new ValidationError(
        `Add at least ${MIN_PAPERS} papers that have been read to map the claims; ${papers.length} can be read now.`,
      );
    }

    const key = `claims:${documentId}`;
    const held = await this.redis.client.set(key, '1', 'EX', CLAIMS_MAP.cooldownSeconds, 'NX');
    if (held !== 'OK') {
      throw new ConflictError(
        'The claims were mapped less than an hour ago; the map below is current. Add papers and come back later to map them again.',
      );
    }

    const scope = await this.scopeFor(documentId, document.title);
    const request = buildClaimsMapRequest({
      scope,
      papers,
      userId: user.id,
      documentId,
      signal: AbortSignal.timeout(90_000),
    });
    const startedAt = Date.now();
    let modelId = this.providers.llm.modelIdFor('strong');
    try {
      const result = await this.providers.llm.complete({ ...request, schema: claimsMapSchema });
      modelId = result.modelId;
      await this.log(user.id, documentId, modelId, result.usage, Date.now() - startedAt, true);
      const processed = postProcessClaimsMap(
        result.value,
        papers.map((p) => p.id),
      );
      const map: ClaimsMap = {
        computedAt: new Date().toISOString(),
        papers: papers.map(({ id, title, year }) => ({ id, title, year })),
        claims: processed.claims,
      };
      const meta = (document.meta as Record<string, unknown> | null) ?? {};
      await this.prisma.document.update({
        where: { id: documentId },
        data: { meta: { ...meta, claims: map } },
      });
      this.logger.log(
        {
          documentId,
          papers: papers.length,
          claims: map.claims.length,
          stripped: processed.stripped,
        },
        'claims mapped',
      );
      return { map };
    } catch (error) {
      await this.redis.client.del(key);
      await this.log(user.id, documentId, modelId, null, Date.now() - startedAt, false, error);
      throw error;
    }
  }

  private async scopeFor(documentId: string, title: string): Promise<ScopeForQueries> {
    const memory = await this.prisma.documentMemory.findUnique({
      where: { documentId },
      select: { scope: true },
    });
    const s = (memory?.scope ?? {}) as {
      workingTitle?: unknown;
      problemStatement?: unknown;
      objectives?: unknown;
    };
    return {
      workingTitle:
        typeof s.workingTitle === 'string' && s.workingTitle.trim() ? s.workingTitle.trim() : title,
      problemStatement: typeof s.problemStatement === 'string' ? s.problemStatement : '',
      objectives: Array.isArray(s.objectives)
        ? s.objectives.filter((o): o is string => typeof o === 'string').slice(0, 8)
        : [],
    };
  }

  private async owned(ownerId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true, title: true, meta: true },
    });
    if (!document) throw new NotFoundError('That document');
    return document;
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
    if (cost > 0) aiCostMicroInr.inc({ action: 'CROSS_PAPER' }, cost);
    await this.prisma.aiCallLog.create({
      data: {
        userId,
        documentId,
        action: 'CROSS_PAPER',
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
