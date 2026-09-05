/**
 * Document memory — PRD §9.1 `PUT /documents/:id/memory/scope` (FR-1.4).
 *
 * The proposal skeleton the student edits. FR-1.4 is explicit that nothing is locked and that
 * "downstream prompts read the edited values, never the generated ones", so this is the only
 * writer of `DocumentMemory.scope`, and saving it also updates the document's working title.
 */

import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { Prisma } from '@tc/db';
import {
  firstChapterOutline,
  type OutlineNode,
  type PaperExtraction,
  paperExtractionSchema,
  readOutline,
} from '@tc/types';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { emptyChapterDoc } from '../chapters/word-counts.js';

const scopeBody = z.object({
  workingTitle: z.string().trim().min(1, 'Give the thesis a working title').max(300),
  problemStatement: z.string().trim().max(4_000),
  objectives: z.array(z.string().trim().min(1).max(500)).max(20),
  whyOpen: z.string().trim().max(2_000),
});

export type ScopeView = z.infer<typeof scopeBody>;

/** The stored extraction, or null when it is missing or does not validate (§10.7.1). */
function readExtraction(value: unknown): PaperExtraction | null {
  if (!value) return null;
  const parsed = paperExtractionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

@Controller('documents/:id/memory')
@UseGuards(SessionGuard)
export class MemoryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('scope')
  async getScope(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    const memory = await this.prisma.documentMemory.findFirst({
      where: { documentId, document: { ownerId: user.id } },
      select: { scope: true, glossary: true, outline: true },
    });
    if (!memory) throw new NotFoundError('That document');
    return memory;
  }

  @Put('scope')
  async putScope(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const parsed = scopeBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid proposal', parsed.error.issues);

    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId: user.id },
      select: {
        id: true,
        memory: { select: { outline: true } },
        seedPapers: {
          where: { extraction: { not: Prisma.JsonNull } },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { extraction: true },
        },
        chapters: {
          orderBy: { order: 'asc' },
          take: 1,
          select: { id: true, title: true, scopeNote: true, wordCount: true, outlineNodeId: true },
        },
      },
    });
    if (!document) throw new NotFoundError('That document');

    const scope = parsed.data;

    // PHASES 3.1: Continue is where the placeholder chapter becomes the real first chapter, taken
    // from the paper's own first section (FR-3.3: map, never invent). A chapter the student has
    // already written in is left alone — the outline exists to serve their draft, not overwrite it.
    const extraction = readExtraction(document.seedPapers[0]?.extraction);
    const existingOutline = readOutline(document.memory?.outline);
    const chapter = document.chapters[0];
    const node: OutlineNode =
      existingOutline[0] ?? firstChapterOutline(extraction, scope.workingTitle);
    const renameChapter = Boolean(chapter) && chapter?.wordCount === 0 && !existingOutline[0];

    // FR-1.4: "Saved to `Document` + `DocumentMemory.scope`." All of it in one transaction, so the
    // list, the proposal, the outline and the chapter can never disagree.
    await this.prisma.$transaction([
      this.prisma.document.update({
        where: { id: documentId },
        data: { title: scope.workingTitle },
      }),
      this.prisma.documentMemory.update({
        where: { documentId },
        data: {
          scope: scope as never,
          // FR-3.4: the tree UI and the prompt builder read this one record.
          ...(existingOutline.length === 0 ? { outline: [node] as never } : {}),
        },
      }),
      ...(renameChapter && chapter
        ? [
            this.prisma.chapter.update({
              where: { id: chapter.id },
              data: {
                title: node.title,
                scopeNote: node.scopeNote,
                outlineNodeId: node.id,
                content: emptyChapterDoc(node.title) as never,
              },
            }),
          ]
        : []),
    ]);

    return { saved: true, scope, outline: [node] };
  }
}
