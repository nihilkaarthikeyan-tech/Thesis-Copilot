/**
 * The outline tree — PRD FR-3.2–3.5, §9.1, PHASES v2 W8.2, W8.3, W8.6.
 *
 * FR-3.4: "Edits write directly to `DocumentMemory.outline`; the tree UI and the prompt builder
 * read the same record." So this service is the only writer of that record besides the outline
 * job, and every write syncs `Chapter` rows by `outlineNodeId` — a rename here is the chapter's
 * new title in the next cached prompt block.
 *
 * A chapter is never deleted because a node vanished. Deleting a node the student has written in
 * is an explicit action with its own confirmation in the UI; anything else is reported as
 * orphaned and left alone.
 */

import { Inject, Injectable } from '@nestjs/common';
import {
  buildSectionScopeRequest,
  type Providers,
  type SectionScopeResult,
  sectionScopeSchema,
} from '@tc/ai';
import {
  computeCallCost,
  type Env,
  OUTLINE_CALLS_PER_DOCUMENT,
  suggestTemplate,
  TEMPLATE_SPECS,
  TEMPLATES,
  type Template,
} from '@tc/config';
import { type OutlineNode, outlineSchema, readOutline, walkOutline } from '@tc/types';
import { ENV } from '../../common/env.token.js';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { QueueService } from '../../common/queue.service.js';
import { PROVIDERS } from '../ai/ai.module.js';
import { emptyChapterDoc } from '../chapters/word-counts.js';

export type OutlineView = {
  template: Template | null;
  suggestedTemplate: Template;
  templates: Array<{ key: Template; name: string; summary: string; chapters: string[] }>;
  outline: OutlineNode[];
  chapters: Array<{
    id: string;
    outlineNodeId: string;
    title: string;
    order: number;
    wordCount: number;
    orphaned: boolean;
  }>;
  glossary: Record<string, unknown>;
  /** True while an outline job is in flight, so the screen can wait. */
  generating: boolean;
};

@Injectable()
export class OutlineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    @Inject(PROVIDERS) private readonly providers: Providers,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async owned(ownerId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true, field: true, template: true, meta: true },
    });
    if (!document) throw new NotFoundError('That document');
    return document;
  }

  async get(ownerId: string, documentId: string): Promise<OutlineView> {
    const document = await this.owned(ownerId, documentId);
    const [memory, chapters] = await Promise.all([
      this.prisma.documentMemory.findUnique({
        where: { documentId },
        select: { outline: true, glossary: true },
      }),
      this.prisma.chapter.findMany({
        where: { documentId },
        orderBy: { order: 'asc' },
        select: { id: true, outlineNodeId: true, title: true, order: true, wordCount: true },
      }),
    ]);
    const outline = readOutline(memory?.outline);
    const known = new Set(outline.map((n) => n.id));
    const meta = (document.meta as { outlineRun?: { status?: string } } | null) ?? {};

    return {
      template: (document.template as Template | null) ?? null,
      suggestedTemplate: suggestTemplate(document.field),
      templates: TEMPLATES.map((key) => ({
        key,
        name: TEMPLATE_SPECS[key].name,
        summary: TEMPLATE_SPECS[key].summary,
        chapters: TEMPLATE_SPECS[key].chapters.map((c) => c.title),
      })),
      outline,
      chapters: chapters.map((c) => ({ ...c, orphaned: !known.has(c.outlineNodeId) })),
      glossary: (memory?.glossary as Record<string, unknown>) ?? {},
      generating: meta.outlineRun?.status === 'RUNNING',
    };
  }

  /** FR-3.1: the student picks; `PATCH /documents/:id` also accepts it. */
  async setTemplate(
    ownerId: string,
    documentId: string,
    template: Template,
  ): Promise<{ template: Template }> {
    await this.owned(ownerId, documentId);
    await this.prisma.document.update({ where: { id: documentId }, data: { template } });
    return { template };
  }

  /** `POST /documents/:id/outline/generate` → job (FR-3.2). */
  async generate(
    ownerId: string,
    documentId: string,
    template?: Template,
  ): Promise<{ queued: true; template: Template }> {
    const document = await this.owned(ownerId, documentId);
    const memory = await this.prisma.documentMemory.findUnique({
      where: { documentId },
      select: { scope: true },
    });
    const scope = memory?.scope as { workingTitle?: string } | null;
    if (!scope?.workingTitle) {
      throw new ValidationError('Save the proposal first; the outline is generated from it.');
    }
    const chosen =
      template ?? (document.template as Template | null) ?? suggestTemplate(document.field);
    const meta = (document.meta as Record<string, unknown> | null) ?? {};
    await this.prisma.document.update({
      where: { id: documentId },
      data: {
        template: chosen,
        meta: { ...meta, outlineRun: { status: 'RUNNING', startedAt: new Date().toISOString() } },
      },
    });
    await this.queue.enqueue(
      'generate-outline',
      { documentId, userId: ownerId, template: chosen },
      { jobId: `generate-outline-${documentId}-${Date.now()}` },
    );
    return { queued: true, template: chosen };
  }

  /**
   * `PUT /documents/:id/memory/outline` — the tree after any edit (reorder, rename, merge, add,
   * delete). Validated against §10.7.2, ids checked for uniqueness, then chapters synced.
   */
  async save(
    ownerId: string,
    documentId: string,
    nodes: unknown,
  ): Promise<{ outline: OutlineNode[]; created: number; updated: number; orphaned: string[] }> {
    await this.owned(ownerId, documentId);
    const parsed = outlineSchema.safeParse(nodes);
    if (!parsed.success) throw new ValidationError('Invalid outline', parsed.error.issues);
    const outline = parsed.data;
    if (outline.length === 0) throw new ValidationError('A thesis needs at least one chapter.');

    const ids = walkOutline(outline).map((n) => n.id);
    if (new Set(ids).size !== ids.length) {
      throw new ValidationError('Two outline nodes share an id; ids must be unique.');
    }

    await this.prisma.documentMemory.update({
      where: { documentId },
      data: { outline: outline as never },
    });
    const sync = await this.syncChapters(documentId, outline);
    return { outline, ...sync };
  }

  /**
   * Deleting a chapter the student has written in (PHASES W8.3: "confirmation when a chapter has
   * content"). The confirmation is the UI's; this refuses silently-destructive calls by requiring
   * the word count the client saw.
   */
  async deleteChapter(
    ownerId: string,
    documentId: string,
    chapterId: string,
    expectWordCount: number,
  ): Promise<{ deleted: true }> {
    await this.owned(ownerId, documentId);
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, documentId },
      select: { id: true, wordCount: true, outlineNodeId: true },
    });
    if (!chapter) throw new NotFoundError('That chapter');
    if (chapter.wordCount !== expectWordCount) {
      throw new ConflictError(
        'That chapter changed since you opened the outline. Reload before deleting it.',
      );
    }
    const memory = await this.prisma.documentMemory.findUnique({
      where: { documentId },
      select: { outline: true },
    });
    const outline = readOutline(memory?.outline).filter((n) => n.id !== chapter.outlineNodeId);
    await this.prisma.$transaction([
      this.prisma.chapter.delete({ where: { id: chapterId } }),
      this.prisma.documentMemory.update({
        where: { documentId },
        data: { outline: outline as never },
      }),
    ]);
    return { deleted: true };
  }

  /** W8.6: the glossary editor writes the whole map, the way the outline does. */
  async saveGlossary(
    ownerId: string,
    documentId: string,
    glossary: Record<string, unknown>,
  ): Promise<{ terms: number }> {
    await this.owned(ownerId, documentId);
    await this.prisma.documentMemory.update({
      where: { documentId },
      data: { glossary: glossary as never },
    });
    return { terms: Object.keys(glossary).length };
  }

  /** The same rule the outline job uses: chapters follow top-level nodes, nothing is deleted. */
  /**
   * FR-3.6: rewrite one chapter's scope note, with its siblings in the prompt so the new note does
   * not repeat what the chapters either side already promise.
   *
   * Synchronous rather than a job: it is one Strong call about a paragraph, and the student is
   * looking at the tree waiting for it. It writes only that node; the rest of the outline and every
   * chapter's text are untouched.
   */
  async regenerateSection(
    user: { id: string; plan: string },
    documentId: string,
    nodeId: string,
    instruction?: string,
  ): Promise<{ node: OutlineNode }> {
    await this.owned(user.id, documentId);
    const memory = await this.prisma.documentMemory.findUnique({
      where: { documentId },
      select: { scope: true, outline: true },
    });
    const outline = readOutline(memory?.outline);
    const index = outline.findIndex((n) => n.id === nodeId);
    if (index < 0) throw new NotFoundError('That section');
    const node = outline[index] as OutlineNode;

    const scope = memory?.scope as Record<string, unknown> | null;
    if (!scope?.workingTitle) {
      throw new ValidationError('Save the proposal first; a scope note is written from it.');
    }

    // ADR-0008. `OUTLINE` has no §11.3 cap because §11.4 counts it once per document, and FR-3.6
    // lets a student ask for it again on every section. Without a bound this is unmetered Strong
    // spend, which §11 does not allow to ship. The count includes the first generation.
    const used = await this.prisma.aiCallLog.count({ where: { documentId, action: 'OUTLINE' } });
    if (used >= OUTLINE_CALLS_PER_DOCUMENT) {
      throw new ValidationError(
        `This thesis has used all ${OUTLINE_CALLS_PER_DOCUMENT} outline rewrites. Edit the scope note yourself — the outline tree is fully editable — or start the next revision in a new thesis.`,
      );
    }

    const request = buildSectionScopeRequest({
      scope: {
        workingTitle: String(scope.workingTitle),
        problemStatement: String(scope.problemStatement ?? ''),
        objectives: Array.isArray(scope.objectives) ? (scope.objectives as string[]) : [],
        ...(scope.whyOpen ? { whyOpen: String(scope.whyOpen) } : {}),
      },
      node: {
        id: node.id,
        title: node.title,
        scopeNote: node.scopeNote ?? '',
      },
      siblings: outline.flatMap((sibling, i) =>
        i === index
          ? []
          : [
              {
                title: sibling.title,
                scopeNote: sibling.scopeNote ?? '',
                position: (i < index ? 'before' : 'after') as 'before' | 'after',
              },
            ],
      ),
      ...(instruction ? { instruction } : {}),
      userId: user.id,
      documentId,
    });

    const startedAt = Date.now();
    let result: SectionScopeResult;
    try {
      const answer = await this.providers.llm.complete({ ...request, schema: sectionScopeSchema });
      await this.logCall(
        user.id,
        documentId,
        answer.modelId,
        answer.usage,
        Date.now() - startedAt,
        true,
      );
      result = answer.value;
    } catch (error) {
      await this.logCall(
        user.id,
        documentId,
        this.providers.llm.modelIdFor('strong'),
        null,
        Date.now() - startedAt,
        false,
        error,
      );
      throw error;
    }

    // The id never changes: chapters are bound to it (`Chapter.outlineNodeId`), and a new id would
    // orphan the student's written text.
    const updated: OutlineNode = {
      ...node,
      title: result.title,
      scopeNote: result.scopeNote,
      ...(result.children.length > 0
        ? {
            children: result.children.map((child, i) => ({
              id: `${node.id}-s${i + 1}`,
              title: child.title,
              scopeNote: child.scopeNote,
              children: [],
            })),
          }
        : {}),
    };
    const next = [...outline];
    next[index] = updated;

    await this.prisma.documentMemory.update({
      where: { documentId },
      data: { outline: next as never },
    });
    await this.syncChapters(documentId, next);
    return { node: updated };
  }

  private async logCall(
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

  private async syncChapters(
    documentId: string,
    nodes: readonly OutlineNode[],
  ): Promise<{ created: number; updated: number; orphaned: string[] }> {
    const existing = await this.prisma.chapter.findMany({
      where: { documentId },
      select: { id: true, outlineNodeId: true, title: true, scopeNote: true, order: true },
    });
    const byNode = new Map(existing.map((c) => [c.outlineNodeId, c]));
    let created = 0;
    let updated = 0;

    for (const [index, node] of nodes.entries()) {
      const order = index + 1;
      const row = byNode.get(node.id);
      if (!row) {
        await this.prisma.chapter.create({
          data: {
            documentId,
            outlineNodeId: node.id,
            title: node.title,
            scopeNote: node.scopeNote,
            order,
            content: emptyChapterDoc(node.title) as never,
          },
        });
        created++;
        continue;
      }
      if (row.title !== node.title || row.scopeNote !== node.scopeNote || row.order !== order) {
        await this.prisma.chapter.update({
          where: { id: row.id },
          data: { title: node.title, scopeNote: node.scopeNote, order },
        });
        updated++;
      }
    }

    const wanted = new Set(nodes.map((n) => n.id));
    const orphaned = existing.filter((c) => !wanted.has(c.outlineNodeId)).map((c) => c.id);
    for (const [i, id] of orphaned.entries()) {
      await this.prisma.chapter.update({ where: { id }, data: { order: nodes.length + i + 1 } });
    }
    return { created, updated, orphaned };
  }
}
