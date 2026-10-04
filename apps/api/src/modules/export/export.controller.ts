/**
 * `/documents/:id/export` and the AI-usage log — PRD §9.4, FR-8.1, FR-8.6.
 *
 * Both answer a signed object-storage URL rather than the bytes: an export is generated once and
 * downloaded from storage, so a slow conversion never holds an HTTP connection open.
 */

import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { citationModeSchema, thesisDetailsSchema } from '@tc/types';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ExportService } from './export.service.js';
import { ThesisExportService } from './thesis-export.service.js';

const exportBody = z.object({
  format: z.enum(['docx', 'pdf']).default('docx'),
  /** Which chapter to export. §9.4 exports per chapter in P1; whole-document is Phase 2. */
  chapterId: z.string().uuid(),
  /** ADR-0055: plain, linked to the bibliography, or Word citation fields. `.docx` only. */
  citations: citationModeSchema.optional(),
});

const templateBody = z.object({ templateId: z.string().uuid() });
const thesisExportBody = z.object({
  // `latex` and `html` are ADR-0021's working formats; only the PDF is compliance-gated.
  format: z.enum(['docx', 'pdf', 'latex', 'html']).default('docx'),
  overrideReason: z.string().trim().min(10).max(500).optional(),
  /** ADR-0055: plain, linked to the bibliography, or Word citation fields. `.docx` only. */
  citations: citationModeSchema.optional(),
});

/** A calendar date, or null to clear it. Shape checked here; meaning checked in the service. */
const deadlineBody = z.object({
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .nullable(),
});

const usageBody = z.object({ format: z.enum(['docx', 'csv']).default('docx') });

@Controller('documents/:id')
@UseGuards(SessionGuard)
export class ExportController {
  constructor(
    private readonly exports: ExportService,
    private readonly thesis: ThesisExportService,
  ) {}

  /** D.3.2 step 1: the details a student fills once, plus the templates they can pick. */
  @Get('thesis-details')
  details(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.thesis.details(user.id, documentId);
  }

  @Put('thesis-details')
  saveDetails(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const parsed = thesisDetailsSchema.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationError('Check these details', parsed.error.issues);
    return this.thesis.saveDetails(user.id, documentId, parsed.data);
  }

  /** The university's formatting template; `PUT template` is the chapter skeleton (FR-3.1). */
  @Put('institution-template')
  setTemplate(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const parsed = templateBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Pick a template', parsed.error.issues);
    return this.thesis.setTemplate(user.id, documentId, parsed.data.templateId);
  }

  /** D.3.3: the checklist, before anything is generated. */
  @Get('compliance')
  compliance(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.thesis.check(user.id, documentId);
  }

  /** The checks joined to the deadline — what is left, and how long there is to do it. */
  @Get('readiness')
  readiness(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.thesis.readiness(user.id, documentId);
  }

  /** `{ deadline: 'YYYY-MM-DD' | null }` — the student telling us when it is due. */
  @Put('deadline')
  @HttpCode(200)
  setDeadline(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const parsed = deadlineBody.safeParse(body);
    if (!parsed.success)
      throw new ValidationError('Use YYYY-MM-DD, or null to clear it.', parsed.error.issues);
    return this.thesis.setDeadline(user.id, documentId, parsed.data.deadline);
  }

  /** The whole thesis. `.docx` always; `.pdf` only when the checklist passes or is overridden. */
  @Post('export/thesis')
  @HttpCode(200)
  exportThesis(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const parsed = thesisExportBody.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid export request', parsed.error.issues);
    return this.thesis.exportThesis(
      user,
      documentId,
      parsed.data.format,
      parsed.data.overrideReason,
      parsed.data.citations,
    );
  }

  /** ADR-0044: the SHA-256 fingerprints of this thesis's recent exports, for verification. */
  @Get('export/artifacts')
  artifacts(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.thesis.artifacts(user.id, documentId);
  }

  @Post('export')
  async exportChapter(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const parsed = exportBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid export request', parsed.error.issues);
    return this.exports.chapter(
      user.id,
      parsed.data.chapterId,
      parsed.data.format,
      parsed.data.citations,
    );
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
