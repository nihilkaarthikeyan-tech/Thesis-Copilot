/**
 * Documents — PRD §9.1.
 *
 * Phase 0 implements create and list only, which is what the web app needs to prove sign-in and
 * document creation work end to end (PHASES task 0.8). The rest of §9.1 lands with the features
 * that use it.
 *
 * PRD §12.1: every query is scoped by `ownerId`. Nothing is ever fetched by id alone, and a
 * document belonging to someone else reads as absent rather than forbidden.
 */

import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';

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
};

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
      select: { id: true, title: true, entryPath: true, createdAt: true, updatedAt: true },
    });

    return documents.map((d) => ({
      id: d.id,
      title: d.title,
      entryPath: d.entryPath,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    }));
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
      },
      select: { id: true, title: true, entryPath: true, createdAt: true, updatedAt: true },
    });

    return {
      id: document.id,
      title: document.title,
      entryPath: document.entryPath,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    };
  }

  @Get(':id')
  async get(@CurrentUser() user: SessionUser, @Param('id') id: string): Promise<DocumentSummary> {
    const document = await this.prisma.document.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true, title: true, entryPath: true, createdAt: true, updatedAt: true },
    });

    if (!document) throw new NotFoundError('That document');

    return {
      id: document.id,
      title: document.title,
      entryPath: document.entryPath,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    };
  }
}
