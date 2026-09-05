/**
 * Cross-paper pass — PRD FR-1.6, Appendix A.16, PHASES 6.2.
 *
 *   "extraction per paper; cross-paper pass (A.16 `xpaper.md`, Strong tier, structured:
 *    overlaps, contradictions, terminology differences); merged glossary."
 *
 * Runs after an extraction finishes, once the document holds two or more extracted papers, and
 * again after each further paper (the result is recomputed for the set, never appended to). The
 * flags are stored on `Document.meta.crossPaper`; the proposal screen renders them as a list
 * with each flag linking to the papers it came from. A failure here is logged and does not fail
 * the extraction that triggered it: the papers are read either way.
 */

import {
  buildCrossPaperRequest,
  type CrossPaperResult,
  crossPaperSchema,
  type LlmProvider,
  XPAPER,
} from '@tc/ai';
import { computeCallCost } from '@tc/config';
import type { PrismaClient } from '@tc/db';
import { type PaperExtraction, paperExtractionSchema } from '@tc/types';

export type CrossPaperDeps = {
  prisma: PrismaClient;
  llm: LlmProvider;
  /** `mock` skips the cost computation (₹0), as every other job does. */
  aiProvider: 'anthropic' | 'mock';
  log?: (event: Record<string, unknown>) => void;
};

export type CrossPaperStored = CrossPaperResult & {
  /** Which seed paper each `pN` id stands for, so a flag can link to its papers. */
  papers: Array<{ id: string; seedPaperId: string; title: string }>;
  at: string;
};

export type CrossPaperOutcome =
  | { ran: false; reason: 'too-few-papers'; papers: number }
  | { ran: true; overlaps: number; contradictions: number; terminology: number };

export async function runCrossPaper(
  input: { documentId: string; userId: string },
  deps: CrossPaperDeps,
): Promise<CrossPaperOutcome> {
  const log = deps.log ?? (() => undefined);
  const rows = await deps.prisma.seedPaper.findMany({
    where: { documentId: input.documentId, status: 'DONE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, filename: true, extraction: true },
  });
  const papers = rows
    .map((row, i) => {
      const parsed = paperExtractionSchema.safeParse(row.extraction);
      if (!parsed.success) return null;
      const extraction: PaperExtraction = parsed.data;
      return {
        id: `p${i + 1}`,
        seedPaperId: row.id,
        title: extraction.title || row.filename,
        extraction,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .slice(0, XPAPER.maxPapers);

  if (papers.length < XPAPER.minPapers) {
    return { ran: false, reason: 'too-few-papers', papers: papers.length };
  }

  const request = buildCrossPaperRequest({
    papers,
    userId: input.userId,
    documentId: input.documentId,
  });
  const startedAt = Date.now();
  let modelId = deps.llm.modelIdFor('strong');
  let result: CrossPaperResult;
  try {
    const answer = await deps.llm.complete({ ...request, schema: crossPaperSchema });
    modelId = answer.modelId;
    result = answer.value;
    await logCall(deps, input, modelId, answer.usage, Date.now() - startedAt, true);
  } catch (error) {
    await logCall(deps, input, modelId, null, Date.now() - startedAt, false, error);
    throw error;
  }

  const stored: CrossPaperStored = {
    ...result,
    papers: papers.map(({ id, seedPaperId, title }) => ({ id, seedPaperId, title })),
    at: new Date().toISOString(),
  };
  const document = await deps.prisma.document.findUnique({
    where: { id: input.documentId },
    select: { meta: true },
  });
  await deps.prisma.document.update({
    where: { id: input.documentId },
    data: {
      meta: { ...((document?.meta as Record<string, unknown> | null) ?? {}), crossPaper: stored },
    },
  });

  log({
    msg: 'cross-paper pass done',
    documentId: input.documentId,
    papers: papers.length,
    overlaps: result.overlaps.length,
    contradictions: result.contradictions.length,
    terminology: result.terminology.length,
  });
  return {
    ran: true,
    overlaps: result.overlaps.length,
    contradictions: result.contradictions.length,
    terminology: result.terminology.length,
  };
}

async function logCall(
  deps: CrossPaperDeps,
  input: { documentId: string; userId: string },
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
    ok && usage && deps.aiProvider !== 'mock'
      ? computeCallCost({ tier: 'strong', modelId: model, usage })
      : 0;
  await deps.prisma.aiCallLog.create({
    data: {
      userId: input.userId,
      documentId: input.documentId,
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
