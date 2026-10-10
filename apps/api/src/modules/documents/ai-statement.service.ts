/**
 * The AI use statement — ADR-0148. Universities ask a student to declare how AI tools were used;
 * this thesis already records the answer: every run of text carries a provenance mark (Appendix
 * B.4), every model call is in `AiCallLog`, every suggestion and draft in `SuggestionEvent`, every
 * build in `ChapterBuild`, and the library knows which papers the product added on its own.
 *
 * `facts()` counts those rows for one thesis and nothing else: no model call, no allowance, no
 * estimate. The sentences are put together in the web app, in the student's interface language,
 * and edited by the student before use. `insertAppendix()` then stores what they settled on as an
 * ordinary chapter at the end of the outline — editable like any other, nothing special about it.
 *
 * What the record cannot tell, the statement says: text pasted in from outside is marked as the
 * student's own writing, because the editor saw it typed; edits inside accepted AI text are
 * counted only where the student touched the text, so "edited" is a floor. Nothing here is, or
 * may be presented as, evidence about AI detection (PRD §12.3).
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  type AiStatementAppendix,
  type AiStatementChapter,
  type AiStatementFacts,
  type AiStatementTable,
  emptyAiStatementFeatures,
  type OutlineNode,
  outlineSchema,
  readOutline,
  walkOutline,
} from '@tc/types';
import { thesisExtensions } from '@tc/ui';
import { getSchema } from '@tiptap/core';
import { ConflictError, NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { totalWords, wordCountsOf } from '../chapters/word-counts.js';
import { runIsLive } from '../memory/outline.service.js';

/** `AuditEvent.kind` a proofreading run writes, so the statement can name proofreading. */
export const PROOFREAD_RUN_KIND = 'PROOFREAD_RUN';

const KEPT_OUTCOMES = ['ACCEPTED', 'PARTIAL', 'EDITED'] as const;

const day = (date: Date | null | undefined): string | null =>
  date ? date.toISOString().slice(0, 10) : null;

/** `Chapter.wordCounts` as stored on save; a chapter never saved has none, and reads as empty. */
function countsOf(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

const SCOPE_NOTE =
  'How AI tools were used in preparing this thesis, from the record Thesis Copilot keeps.';

export type InsertedAppendix = { chapterId: string; title: string };

@Injectable()
export class AiStatementService {
  private readonly logger = new Logger(AiStatementService.name);
  private readonly schema = getSchema(
    thesisExtensions({
      ghostText: {
        chapterId: 'server',
        request: () => {
          throw new Error('Ghost text does not run on the server');
        },
      },
      resizableTables: false,
    }),
  );

  constructor(private readonly prisma: PrismaService) {}

  async facts(ownerId: string, documentId: string): Promise<AiStatementFacts> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: {
        id: true,
        title: true,
        language: true,
        createdAt: true,
        chapters: {
          orderBy: { order: 'asc' },
          select: { id: true, title: true, order: true, wordCounts: true, scopeNote: true },
        },
      },
    });
    if (!document) throw new NotFoundError('That document');

    const [calls, callRange, events, eventRange, builds, sources, autoAdded, cited, proofreads] =
      await Promise.all([
        this.prisma.aiCallLog.groupBy({
          by: ['action'],
          where: { documentId, ok: true },
          _count: { _all: true },
        }),
        this.prisma.aiCallLog.aggregate({
          where: { documentId, ok: true },
          _min: { createdAt: true },
          _max: { createdAt: true },
        }),
        this.prisma.suggestionEvent.groupBy({
          by: ['chapterId', 'action', 'outcome'],
          where: { documentId },
          _count: { _all: true },
        }),
        this.prisma.suggestionEvent.aggregate({
          where: { documentId },
          _min: { createdAt: true },
          _max: { createdAt: true },
        }),
        this.prisma.chapterBuild.groupBy({
          by: ['kind'],
          where: { documentId, status: 'DONE' },
          _count: { _all: true },
        }),
        this.prisma.source.count({ where: { documentId } }),
        this.prisma.source.count({ where: { documentId, autoAddedAt: { not: null } } }),
        this.prisma.citation.findMany({
          where: { chapter: { documentId } },
          distinct: ['sourceId'],
          select: { sourceId: true },
        }),
        this.prisma.auditEvent.findMany({
          where: { documentId, kind: PROOFREAD_RUN_KIND },
          select: { detail: true },
        }),
      ]);

    const callCount = new Map(calls.map((row) => [row.action as string, row._count._all]));
    const callsOf = (...actions: string[]) =>
      actions.reduce((sum, action) => sum + (callCount.get(action) ?? 0), 0);

    // Proofreading went through the COMMAND allowance and log (§11.5) until ADR-0152. Those runs
    // record how many calls they made, so the edit-command count is what is left after them.
    // Runs before ADR-0148 recorded nothing and stay inside "edits"; runs since ADR-0152 are
    // logged as PROOFREAD (their mark says `action`) and are not in the COMMAND count at all.
    const proofreadCalls = proofreads.reduce((sum, row) => {
      const detail = row.detail as { calls?: unknown; action?: unknown } | null;
      if (detail?.action === 'PROOFREAD') return sum;
      return sum + (typeof detail?.calls === 'number' ? detail.calls : 0);
    }, 0);

    const features = emptyAiStatementFeatures();
    let shown = 0;
    let kept = 0;
    let draftsShown = 0;
    let draftsAccepted = 0;
    const actionsByChapter = new Map<string, number>();
    for (const row of events) {
      const n = row._count._all;
      if (row.chapterId) {
        actionsByChapter.set(row.chapterId, (actionsByChapter.get(row.chapterId) ?? 0) + n);
      }
      const isKept = (KEPT_OUTCOMES as readonly string[]).includes(row.outcome);
      if (row.action === 'ASSIST') {
        shown += n;
        if (isKept) kept += n;
      } else if (row.action === 'DRAFT') {
        draftsShown += n;
        if (isKept) draftsAccepted += n;
      }
    }
    features.suggestions = shown;
    features.drafting = draftsShown;
    features.edits = Math.max(0, callsOf('COMMAND') - proofreadCalls);
    features.proofreading = proofreads.length;
    features.citations = callsOf('CITE');
    features.chat = callsOf('CHAT');
    features.research = callsOf('RESEARCH');
    features.literatureSearch = callsOf('SEARCH_QUERIES');
    features.planning = callsOf('OUTLINE', 'PROPOSAL');
    features.checks = callsOf('COHERENCE', 'CROSS_PAPER');
    features.examinerReview = callsOf('EXAMINER_REVIEW');
    features.viva = callsOf('VIVA');
    for (const row of builds) {
      if (row.kind === 'LIT_REVIEW') features.litReviewBuild += row._count._all;
      else features.chapterBuild += row._count._all;
    }

    // A statement already inserted as an appendix is not part of the thesis it describes: counted,
    // its own words would raise the "my own writing" share every time it was regenerated.
    const thesisChapters = document.chapters.filter((chapter) => chapter.scopeNote !== SCOPE_NOTE);
    const chapters: AiStatementChapter[] = thesisChapters.map((chapter) => {
      const c = countsOf(chapter.wordCounts);
      const aiUnedited = (c.ASSIST ?? 0) + (c.DRAFT ?? 0) + (c.COMMAND ?? 0);
      const aiEdited = c.HUMAN_EDITED ?? 0;
      const own = c.HUMAN ?? 0;
      return {
        title: chapter.title,
        order: chapter.order,
        total: own + aiUnedited + aiEdited,
        aiUnedited,
        aiEdited,
        own,
        actions: actionsByChapter.get(chapter.id) ?? 0,
      };
    });
    const words = chapters.reduce(
      (sum, c) => ({
        total: sum.total + c.total,
        aiUnedited: sum.aiUnedited + c.aiUnedited,
        aiEdited: sum.aiEdited + c.aiEdited,
        own: sum.own + c.own,
      }),
      { total: 0, aiUnedited: 0, aiEdited: 0, own: 0 },
    );

    const stamps = [
      callRange._min.createdAt,
      callRange._max.createdAt,
      eventRange._min.createdAt,
      eventRange._max.createdAt,
    ].filter((d): d is Date => d instanceof Date);
    const from = stamps.length ? new Date(Math.min(...stamps.map((d) => d.getTime()))) : null;
    const to = stamps.length ? new Date(Math.max(...stamps.map((d) => d.getTime()))) : null;

    return {
      documentTitle: document.title,
      documentLanguage: document.language,
      createdOn: day(document.createdAt) as string,
      from: day(from),
      to: day(to),
      features,
      suggestions: { shown, kept },
      drafts: { shown: draftsShown, accepted: draftsAccepted },
      words,
      chapters,
      sources: { total: sources, autoAdded, cited: cited.length },
    };
  }

  /**
   * The statement, as the student edited it, becomes the last chapter of the outline: a title
   * heading, the paragraphs, and the per-chapter table when one was asked for. Plain text in,
   * ordinary nodes out; the student's own words from here on.
   */
  async insertAppendix(
    ownerId: string,
    documentId: string,
    statement: AiStatementAppendix,
  ): Promise<InsertedAppendix> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true },
    });
    if (!document) throw new NotFoundError('That document');
    await this.prisma.documentMemory.upsert({
      where: { documentId },
      create: { documentId, scope: {}, outline: [], glossary: {} },
      update: {},
    });

    const json = appendixDoc(statement);
    let content: Record<string, unknown>;
    try {
      const node = this.schema.nodeFromJSON(json);
      node.check();
      content = node.toJSON() as Record<string, unknown>;
    } catch (error) {
      this.logger.error({ err: error, documentId }, 'AI use statement failed the schema');
      throw new Error('The statement could not be made into a chapter');
    }
    const counts = wordCountsOf(content);

    return this.prisma.$transaction(
      async (tx) => {
        // The outline row is the lock (ADR-0097): two presses wait for each other here.
        const locked = await tx.$queryRaw<Array<{ outline: unknown }>>`
          SELECT "outline" FROM "DocumentMemory" WHERE "documentId" = ${documentId}::uuid FOR UPDATE`;
        const row = await tx.document.findUniqueOrThrow({
          where: { id: documentId },
          select: { meta: true },
        });
        const meta = (row.meta as { outlineRun?: unknown } | null) ?? {};
        if (runIsLive(meta.outlineRun as never, new Date())) {
          throw new ConflictError(
            'Your chapters are still being planned. Insert the statement once the plan is ready.',
          );
        }

        const chapters = await tx.chapter.findMany({
          where: { documentId },
          orderBy: { order: 'asc' },
          select: { id: true, outlineNodeId: true, title: true, scopeNote: true, order: true },
        });
        const taken = new Set(chapters.map((c) => c.title.trim().toLowerCase()));
        let title = statement.title;
        for (let n = 2; taken.has(title.toLowerCase()); n++) title = `${statement.title} (${n})`;

        // At the end of the outline; a thesis with no outline adopts its chapters into one first.
        const outline = readOutline(locked[0]?.outline);
        const base: OutlineNode[] =
          outline.length > 0
            ? outline
            : chapters.map((c) => ({
                id: c.outlineNodeId,
                title: c.title,
                scopeNote: c.scopeNote ?? '',
                children: [],
              }));
        const usedIds = new Set(walkOutline(base).map((n) => n.id));
        let nodeId = 'ai-use-statement';
        for (let n = 2; usedIds.has(nodeId); n++) nodeId = `ai-use-statement-${n}`;
        const nodes = outlineSchema.parse([
          ...base,
          { id: nodeId, title, scopeNote: SCOPE_NOTE, children: [] },
        ]);
        const position = new Map(nodes.map((n, i) => [n.id, i + 1]));
        const outside = chapters.filter((c) => !position.has(c.outlineNodeId));
        for (const chapter of chapters) {
          const order =
            position.get(chapter.outlineNodeId) ?? nodes.length + outside.indexOf(chapter) + 1;
          if (order !== chapter.order) {
            await tx.chapter.update({ where: { id: chapter.id }, data: { order } });
          }
        }

        // The title in the document is the chapter's: the heading is retitled if the name had to
        // be made unique.
        const body = title === statement.title ? content : retitle(content, title);
        const created = await tx.chapter.create({
          data: {
            documentId,
            outlineNodeId: nodeId,
            title,
            scopeNote: SCOPE_NOTE,
            order: position.get(nodeId) as number,
            content: body as never,
            wordCounts: counts,
            wordCount: totalWords(counts),
          },
          select: { id: true },
        });
        await tx.documentMemory.update({
          where: { documentId },
          data: { outline: nodes as never },
        });
        this.logger.log(
          { documentId, chapterId: created.id, paragraphs: statement.paragraphs.length },
          'AI use statement inserted as an appendix',
        );
        return { chapterId: created.id, title };
      },
      { timeout: 20_000 },
    );
  }
}

type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string };

const text = (value: string): Node => ({ type: 'text', text: value });
const paragraph = (value: string): Node =>
  value.trim() ? { type: 'paragraph', content: [text(value)] } : { type: 'paragraph' };

/** The statement as the editor's own nodes: H1, paragraphs, and the table if asked for. */
export function appendixDoc(statement: AiStatementAppendix): Node {
  const content: Node[] = [
    { type: 'heading', attrs: { level: 1 }, content: [text(statement.title)] },
    ...statement.paragraphs.map(paragraph),
  ];
  if (statement.table) content.push(tableNode(statement.table));
  return { type: 'doc', content };
}

function tableNode(table: AiStatementTable): Node {
  const cell = (type: 'tableHeader' | 'tableCell', value: string): Node => ({
    type,
    content: [paragraph(value)],
  });
  return {
    type: 'table',
    content: [
      { type: 'tableRow', content: table.header.map((h) => cell('tableHeader', h)) },
      ...table.rows.map((row) => ({
        type: 'tableRow',
        content: row.map((value) => cell('tableCell', value)),
      })),
    ],
  };
}

function retitle(doc: Record<string, unknown>, title: string): Record<string, unknown> {
  const content = Array.isArray(doc.content) ? [...(doc.content as Node[])] : [];
  const first = content[0];
  if (first?.type === 'heading') content[0] = { ...first, content: [text(title)] };
  return { ...doc, content };
}
