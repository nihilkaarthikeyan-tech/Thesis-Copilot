/**
 * `/documents/:id/export` and the AI-usage log — PRD §9.4, FR-8.1, FR-8.6.
 *
 * Both answer a signed object-storage URL rather than the bytes: an export is generated once and
 * downloaded from storage, so a slow conversion never holds an HTTP connection open.
 */

import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ExportService } from './export.service.js';

const exportBody = z.object({
  format: z.enum(['docx', 'pdf']).default('docx'),
  /** Which chapter to export. §9.4 exports per chapter in P1; whole-document is Phase 2. */
  chapterId: z.string().uuid(),
});

const usageBody = z.object({ format: z.enum(['docx', 'csv']).default('docx') });

@Controller('documents/:id')
@UseGuards(SessionGuard)
export class ExportController {
  constructor(private readonly exports: ExportService) {}

  @Post('export')
  async exportChapter(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const parsed = exportBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid export request', parsed.error.issues);
    return this.exports.chapter(user.id, parsed.data.chapterId, parsed.data.format);
  }

  @Post('export/ai-usage-log')
  async exportAiUsage(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const parsed = usageBody.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid export request', parsed.error.issues);
    return this.exports.aiUsage(user.id, documentId, parsed.data.format);
  }
}
