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
  dropPlaceholderSections,
  enforceTemplateShape,
  type GapMapTheme,
  type LlmProvider,
  outlineRequestSchema,
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

/** One A.9 call's time limit. */
const OUTLINE_TIMEOUT_MS = 180_000;

export type GenerateOutlineJob = {
  documentId: string;
  userId: string;
  template?: Template;
  /** ADR-0072: plan from the thesis title when there is no saved proposal. */
  fromTitle?: boolean;
};

export type GenerateOutlineDeps = {
  prisma: PrismaClient;
  llm: LlmProvider;
  aiProvider: 'anthropic' | 'mock';
  /** An empty chapter body, so a created chapter opens on something (the API owns the shape). */
  /**
   * A new chapter's body. ADR-0087: with the plan's section titles, each is a heading in the
   * chapter with an empty line under it, as Jenni lays out its headings, so the editor's opener
   * (ADR-0078) offers a first sentence under the first one.
   */
  emptyChapter: (title: string, sections?: readonly string[]) => unknown;
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
      title: true,
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
  // ADR-0072: a thesis begun with "Start writing now" has only its title. The same A.9 request
  // goes out with the title as the working title and the rest of the scope empty; a proposal
  // saved since the job was queued is used instead.
  const scope =
    readScope(document.memory?.scope) ??
    (job.fromTitle ? readScope({ workingTitle: document.title }) : null);
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
    // No model call without a time limit (BUILD_LOG, 2026-10-01). A title-only plan took 34 s on
    // gpt-5-mini (ADR-0072); the job's retries cover a call that runs out.
    signal: AbortSignal.timeout(OUTLINE_TIMEOUT_MS),
  });
  const startedAt = Date.now();
  let nodes: OutlineNode[];
  try {
    const answer = await deps.llm.complete({ ...request, schema: outlineRequestSchema });
    await logCall(deps, job, answer.modelId, answer.usage, Date.now() - startedAt, true);
    nodes = dropPlaceholderSections(
      enforceTemplateShape(readOutlineResult(answer.value), template),
    );
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
/** ADR-0087: a chapter's planned sections, as headings for its body. */
export function sectionTitles(node: OutlineNode): string[] {
  return node.children.map((c) => c.title.trim()).filter((t) => t.length > 0);
}

/** Whether a chapter body holds no writing: headings and empty paragraphs only. */
export function isBlankChapter(content: unknown): boolean {
  let text = '';
  const visit = (
    node: { type?: string; text?: string; content?: unknown[] },
    inHeading: boolean,
  ) => {
    if (node.type === 'text' && !inHeading) text += node.text ?? '';
    for (const child of (node.content ?? []) as Array<Parameters<typeof visit>[0]>) {
      visit(child, inHeading || node.type === 'heading');
    }
  };
  if (content && typeof content === 'object') visit(content as Parameters<typeof visit>[0], false);
  return text.trim().length === 0;
}

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
      content: true,
    },
  });
  let created = 0;
  let updated = 0;

  // A new thesis has one chapter, made before there was any plan. When the first outline does
  // not contain it, that chapter becomes the outline's first rather than an orphan: the outline
  // now starts as the student leaves the proposal (2026-10-04), and anything they type in the
  // meantime must stay in the chapter they see, not move to a detached copy at the end.
  const only = existing.length === 1 ? existing[0] : undefined;
  const first = nodes[0];
  if (only && first && !nodes.some((n) => n.id === only.outlineNodeId)) {
    // ADR-0087: an untouched first chapter gets the plan's headings too; one with writing in it
    // keeps exactly what the student wrote.
    // The body itself decides when there is one: the stored word count can count the title.
    const blank = only.content != null ? isBlankChapter(only.content) : (only.wordCount ?? 0) === 0;
    await deps.prisma.chapter.update({
      where: { id: only.id },
      data: {
        outlineNodeId: first.id,
        title: first.title,
        scopeNote: first.scopeNote,
        order: 1,
        ...(blank
          ? { content: deps.emptyChapter(first.title, sectionTitles(first)) as never }
          : {}),
      },
    });
    existing[0] = {
      ...only,
      outlineNodeId: first.id,
      title: first.title,
      scopeNote: first.scopeNote,
      order: 1,
    };
    updated++;
  }
  const byNode = new Map(existing.map((c) => [c.outlineNodeId, c]));

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
          content: deps.emptyChapter(node.title, sectionTitles(node)) as never,
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
