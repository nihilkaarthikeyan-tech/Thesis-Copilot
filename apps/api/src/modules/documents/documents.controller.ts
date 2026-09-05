/**
 * Documents — PRD §9.1.
 *
 * Create, list and get. Every document is created together with its `DocumentMemory` row (PRD §8)
 * and a first chapter, so the editor has somewhere to land (§6.1: `write/:chapterId` is the
 * default landing once a chapter exists). Path B derives the real chapter list from the paper in
 * Phase 1 week 3 (PHASES 3.1); the full outline tree is Phase 2.
 *
 * PRD §12.1: every query is scoped by `ownerId`. Nothing is ever fetched by id alone, and a
 * document belonging to someone else reads as absent rather than forbidden.
 */

import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { Prisma } from '@tc/db';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { emptyChapterDoc } from '../chapters/word-counts.js';

const createDocument = z.object({
  title: z.string().trim().min(1, 'Give the thesis a working title').max(300),
  entryPath: z.enum(['A_TOPIC', 'B_PAPER']),
  field: z.string().trim().max(200).optional(),
});

export type DocumentSummary = {
  id: string;
  title: string;
  entryPath: string;
  createdAt: string;
  updatedAt: string;
  /** The chapter the editor opens by default. */
  firstChapterId: string | null;
};

export type DocumentDetail = DocumentSummary & {
  chapters: Array<{
    id: string;
    title: string;
    order: number;
    outlineNodeId: string;
    wordCount: number;
  }>;
  memory: { scope: unknown; outline: unknown; glossary: unknown } | null;
  /** PRD §9.1 "(meta)": the Path A conversation and cross-paper flags live here. */
  meta: unknown;
};

const summarySelect = {
  id: true,
  title: true,
  entryPath: true,
  createdAt: true,
  updatedAt: true,
  chapters: { orderBy: { order: 'asc' }, take: 1, select: { id: true } },
} satisfies Prisma.DocumentSelect;

type SummaryRow = Prisma.DocumentGetPayload<{ select: typeof summarySelect }>;

function toSummary(d: SummaryRow): DocumentSummary {
  return {
    id: d.id,
    title: d.title,
    entryPath: d.entryPath,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    firstChapterId: d.chapters[0]?.id ?? null,
  };
}

@Controller('documents')
@UseGuards(SessionGuard)
export class DocumentsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Not in §9.1, which has no list route, but the document list screen in §6.1 needs one. */
  @Get()
  async list(@CurrentUser() user: SessionUser): Promise<DocumentSummary[]> {
    const documents = await this.prisma.document.findMany({
      where: { ownerId: user.id },
      orderBy: { updatedAt: 'desc' },
      select: summarySelect,
    });
    return documents.map(toSummary);
  }

  @Post()
  async create(@CurrentUser() user: SessionUser, @Body() body: unknown): Promise<DocumentSummary> {
    const parsed = createDocument.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('The document could not be created.', parsed.error.issues);
    }

    const document = await this.prisma.document.create({
      data: {
        ownerId: user.id,
        title: parsed.data.title,
        entryPath: parsed.data.entryPath,
        ...(parsed.data.field ? { field: parsed.data.field } : {}),
        // Every document has exactly one memory row (PRD §8). Created with the document so nothing
        // downstream has to handle its absence.
        memory: { create: { scope: {}, outline: [], glossary: {} } },
        // A first chapter so the editor has somewhere to land (§6.1).
        chapters: {
          create: {
            outlineNodeId: 'ch-1',
            title: 'Chapter 1',
            order: 1,
            content: emptyChapterDoc('Chapter 1') as Prisma.InputJsonValue,
          },
        },
      },
      select: summarySelect,
    });

    return toSummary(document);
  }

  /** PRD §9.1: document + memory + chapters (meta). */
  @Get(':id')
  async get(@CurrentUser() user: SessionUser, @Param('id') id: string): Promise<DocumentDetail> {
    const document = await this.prisma.document.findFirst({
      where: { id, ownerId: user.id },
      select: {
        ...summarySelect,
        memory: { select: { scope: true, outline: true, glossary: true } },
        meta: true,
        chapters: {
          orderBy: { order: 'asc' },
          select: { id: true, title: true, order: true, outlineNodeId: true, wordCount: true },
        },
      },
    });

    if (!document) throw new NotFoundError('That document');

    return {
      ...toSummary({ ...document, chapters: document.chapters.map((c) => ({ id: c.id })) }),
      chapters: document.chapters,
      memory: document.memory,
      meta: document.meta,
    };
  }
}
