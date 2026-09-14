/**
 * `generate-outline` — PRD FR-3.2, FR-3.3, Appendix A.9, PHASES v2 W8.2.
 *
 * One Strong structured call per run, from the template shape, the saved scope, the gap map and
 * (Path B) the paper's extraction. The tree it returns is normalised to stable slug ids, checked
 * against the template's chapter list, written to `DocumentMemory.outline`, and synced to
 * `Chapter` rows — created or updated by `outlineNodeId`, so a re-run renames rather than
 * duplicates and a chapter the student has written in keeps its text.
 *
 * A chapter whose node disappears from the outline is NOT deleted: FR-3.4 lets the student
 * restructure, and losing a written chapter to a model's re-run would be unrecoverable. Such
 * chapters are reported as `orphaned` for the UI to offer a merge or delete.
 */

import {
  buildOutlineRequest,
  enforceTemplateShape,
  type GapMapTheme,
  type LlmProvider,
  outlineRequestSchema,
  outlineResultSchema,
  readOutlineResult,
  type ScopeForQueries,
} from '@tc/ai';
import { computeCallCost, TEMPLATE_SPECS, type Template } from '@tc/config';
import type { PrismaClient } from '@tc/db';
import {
  type OutlineNode,
  type PaperExtraction,
  paperExtractionSchema,
  walkOutline,
} from '@tc/types';

export type GenerateOutlineJob = {
  documentId: string;
  userId: string;
  template?: Template;
};

export type GenerateOutlineDeps = {
  prisma: PrismaClient;
  llm: LlmProvider;
  aiProvider: 'anthropic' | 'mock';
  /** An empty chapter body, so a created chapter opens on something (the API owns the shape). */
  emptyChapter: (title: string) => unknown;
  log?: (event: Record<string, unknown>) => void;
};

export type GenerateOutlineResult = {
  documentId: string;
  template: Template;
  chapters: number;
  sections: number;
  created: number;
  updated: number;
  orphaned: string[];
};

function readScope(value: unknown): ScopeForQueries | null {
  const scope = value as Partial<ScopeForQueries> | null;
  if (!scope || typeof scope.workingTitle !== 'string' || !scope.workingTitle.trim()) return null;
  return {
    workingTitle: scope.workingTitle,
    problemStatement: scope.problemStatement ?? '',
    objectives: Array.isArray(scope.objectives) ? scope.objectives : [],
    ...(scope.whyOpen ? { whyOpen: scope.whyOpen } : {}),
  };
}

function readGapMap(value: unknown): GapMapTheme[] {
  const map = value as { themes?: Array<{ name?: string; count?: number; thin?: boolean }> } | null;
  return (map?.themes ?? [])
    .filter((t): t is { name: string; count: number; thin: boolean } => typeof t?.name === 'string')
    .map((t) => ({ name: t.name, count: t.count ?? 0, thin: Boolean(t.thin) }));
}

export async function runGenerateOutline(
  job: GenerateOutlineJob,
  deps: GenerateOutlineDeps,
): Promise<GenerateOutlineResult> {
  const log = deps.log ?? (() => undefined);
  const document = await deps.prisma.document.findUnique({
    where: { id: job.documentId },
    select: {
      id: true,
      template: true,
      memory: { select: { scope: true, gapMap: true } },
      seedPapers: {
        where: { status: 'DONE' },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { extraction: true },
      },
    },
  });
  if (!document) throw new Error(`document ${job.documentId} no longer exists`);

  const template = (job.template ?? document.template ?? 'STEM_EMPIRICAL') as Template;
  const scope = readScope(document.memory?.scope);
  if (!scope) throw new Error('Save the proposal first: the outline is generated from it.');
  const parsedExtraction = document.seedPapers[0]?.extraction
    ? paperExtractionSchema.safeParse(document.seedPapers[0].extraction)
    : null;
  const extraction: PaperExtraction | null = parsedExtraction?.success
    ? parsedExtraction.data
    : null;

  const request = buildOutlineRequest({
    template,
    scope,
    gapMap: readGapMap(document.memory?.gapMap),
    extraction,
    userId: job.userId,
    documentId: job.documentId,
  });
  const startedAt = Date.now();
  let nodes: OutlineNode[];
  try {
    const answer = await deps.llm.complete({ ...request, schema: outlineRequestSchema });
    await logCall(deps, job, answer.modelId, answer.usage, Date.now() - startedAt, true);
    nodes = enforceTemplateShape(readOutlineResult(answer.value), template);
  } catch (error) {
    await logCall(
      deps,
      job,
      deps.llm.modelIdFor('strong'),
      null,
      Date.now() - startedAt,
      false,
      error,
    );
    throw error;
  }
  if (nodes.length === 0) throw new Error('The outline came back empty.');

  await deps.prisma.documentMemory.update({
    where: { documentId: job.documentId },
    data: { outline: nodes as never },
  });
  if (document.template !== template) {
    await deps.prisma.document.update({ where: { id: job.documentId }, data: { template } });
  }

  const sync = await syncChapters(deps, job.documentId, nodes);
  const result: GenerateOutlineResult = {
    documentId: job.documentId,
    template,
    chapters: nodes.length,
    sections: walkOutline(nodes).length - nodes.length,
    ...sync,
  };
  log({
    msg: 'outline generated',
    ...result,
    flexible: TEMPLATE_SPECS[template].flexibleChapterCount,
  });
  return result;
}

/**
 * FR-3.4: "the tree UI and the prompt builder read the same record". `Chapter` rows follow the
 * top-level nodes, keyed by `outlineNodeId`, and are never deleted by a re-run.
 */
export async function syncChapters(
  deps: Pick<GenerateOutlineDeps, 'prisma' | 'emptyChapter'>,
  documentId: string,
  nodes: readonly OutlineNode[],
): Promise<{ created: number; updated: number; orphaned: string[] }> {
  const existing = await deps.prisma.chapter.findMany({
    where: { documentId },
    select: {
      id: true,
      outlineNodeId: true,
      title: true,
      scopeNote: true,
      order: true,
      wordCount: true,
    },
  });
  const byNode = new Map(existing.map((c) => [c.outlineNodeId, c]));
  let created = 0;
  let updated = 0;

  for (const [index, node] of nodes.entries()) {
    const order = index + 1;
    const row = byNode.get(node.id);
    if (!row) {
      await deps.prisma.chapter.create({
        data: {
          documentId,
          outlineNodeId: node.id,
          title: node.title,
          scopeNote: node.scopeNote,
          order,
          content: deps.emptyChapter(node.title) as never,
        },
      });
      created++;
      continue;
    }
    if (row.title !== node.title || row.scopeNote !== node.scopeNote || row.order !== order) {
      await deps.prisma.chapter.update({
        where: { id: row.id },
        data: { title: node.title, scopeNote: node.scopeNote, order },
      });
      updated++;
    }
  }

  const wanted = new Set(nodes.map((n) => n.id));
  const orphaned = existing.filter((c) => !wanted.has(c.outlineNodeId)).map((c) => c.id);
  // Push orphans to the end so the numbering of the real chapters is contiguous.
  for (const [i, id] of orphaned.entries()) {
    await deps.prisma.chapter.update({
      where: { id },
      data: { order: nodes.length + i + 1 },
    });
  }
  return { created, updated, orphaned };
}

async function logCall(
  deps: GenerateOutlineDeps,
  job: GenerateOutlineJob,
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
      userId: job.userId,
      documentId: job.documentId,
      action: 'OUTLINE',
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
