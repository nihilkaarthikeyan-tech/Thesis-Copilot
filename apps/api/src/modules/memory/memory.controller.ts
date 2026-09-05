/**
 * Document memory — PRD §9.1 `PUT /documents/:id/memory/scope` (FR-1.4).
 *
 * The proposal skeleton the student edits. FR-1.4 is explicit that nothing is locked and that
 * "downstream prompts read the edited values, never the generated ones", so this is the only
 * writer of `DocumentMemory.scope`, and saving it also updates the document's working title.
 */

import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';

const scopeBody = z.object({
  workingTitle: z.string().trim().min(1, 'Give the thesis a working title').max(300),
  problemStatement: z.string().trim().max(4_000),
  objectives: z.array(z.string().trim().min(1).max(500)).max(20),
  whyOpen: z.string().trim().max(2_000),
});

export type ScopeView = z.infer<typeof scopeBody>;

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
      select: { id: true },
    });
    if (!document) throw new NotFoundError('That document');

    const scope = parsed.data;

    // FR-1.4: "Saved to `Document` + `DocumentMemory.scope`." Both in one transaction, so the
    // list and the proposal can never disagree about the title.
    await this.prisma.$transaction([
      this.prisma.document.update({
        where: { id: documentId },
        data: { title: scope.workingTitle },
      }),
      this.prisma.documentMemory.update({
        where: { documentId },
        data: { scope: scope as never },
      }),
    ]);

    return { saved: true, scope };
  }
}
