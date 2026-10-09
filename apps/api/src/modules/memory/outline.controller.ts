/**
 * Outline and glossary — PRD §9.1 (`/memory/outline`, `/outline/generate`), FR-3.1–3.5.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { TEMPLATES } from '@tc/config';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { OutlineService } from './outline.service.js';
import { StyleService } from './style.service.js';

const templateBody = z.object({ template: z.enum(TEMPLATES) });
const regenerateBody = z.object({
  instruction: z.string().trim().max(500).optional(),
});

const generateBody = z.object({ template: z.enum(TEMPLATES).optional() });
const outlineBody = z.object({ outline: z.array(z.unknown()) });
const restartBody = z.object({
  structure: z.enum(['standard', 'none']),
  /** The chapter on screen, which stays (as the first chapter) so its address keeps working. */
  chapterId: z.string().uuid().optional(),
});
const sectionNoteBody = z.object({
  chapterId: z.string().uuid(),
  title: z.string().trim().min(1).max(300),
  scopeNote: z.string().max(2_000),
});
const glossaryBody = z.object({ glossary: z.record(z.string(), z.unknown()) });
const deleteBody = z.object({ wordCount: z.number().int().min(0) });
/** The service measures and screens it; this only bounds what is accepted at all. */
const guidanceBody = z.object({ guidance: z.string().max(2_000) });

@Controller('documents/:id')
@UseGuards(SessionGuard)
export class OutlineController {
  constructor(
    private readonly outline: OutlineService,
    private readonly style: StyleService,
  ) {}

  /** FR-4.7: how close the student is to a style profile, and the profile itself. */
  @Get('style-profile')
  styleStatus(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.style.status(user.id, documentId);
  }

  /** PRD 9.3 `POST /documents/:id/style-profile` - "Re-learn my style". */
  @Post('style-profile')
  @HttpCode(200)
  learnStyle(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.style.learn(user.id, documentId);
  }

  /** ADR-0025: the student's own note on their voice. An empty string clears it. */
  @Put('style-profile/guidance')
  setStyleGuidance(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const parsed = guidanceBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid guidance', parsed.error.issues);
    return this.style.setGuidance(user.id, documentId, parsed.data.guidance);
  }

  /** Template, outline tree, chapters and glossary in one read — the outline screen's state. */
  @Get('outline')
  get(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.outline.get(user.id, documentId);
  }

  /** FR-3.1. */
  @Put('template')
  setTemplate(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const parsed = templateBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Unknown template', parsed.error.issues);
    return this.outline.setTemplate(user.id, documentId, parsed.data.template);
  }

  /** FR-3.6: rewrite one chapter's scope note, with its siblings for context. */
  @Post('outline/:nodeId/regenerate')
  @HttpCode(200)
  regenerateSection(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Param('nodeId') nodeId: string,
    @Body() body: unknown,
  ) {
    const parsed = regenerateBody.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid request', parsed.error.issues);
    return this.outline.regenerateSection(user, documentId, nodeId, parsed.data.instruction);
  }

  /** FR-3.2: Strong-tier generation as a job. */
  @Post('outline/generate')
  @HttpCode(202)
  generate(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const parsed = generateBody.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationError('Unknown template', parsed.error.issues);
    return this.outline.generate(user.id, documentId, parsed.data.template);
  }

  /** ADR-0072: "Plan my chapters from the title", for a thesis with no outline yet. */
  @Post('outline/plan-from-title')
  @HttpCode(202)
  planFromTitle(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.outline.planFromTitle(user, documentId);
  }

  /**
   * ADR-0145: the setup card's "Standard chapters" or "No headings" in place of a plan, while no
   * chapter has writing in it. Free; no model.
   */
  @Post('outline/restart')
  @HttpCode(200)
  restart(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const parsed = restartBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Choose a structure', parsed.error.issues);
    return this.outline.restart(user.id, documentId, parsed.data.structure, parsed.data.chapterId);
  }

  /** R10 (ADR-0097): one section's note, from the editor's Sections panel. */
  @Put('outline/section-note')
  sectionNote(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const parsed = sectionNoteBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid note', parsed.error.issues);
    return this.outline.setSectionNote(user.id, documentId, parsed.data);
  }

  /** FR-3.4: every tree edit lands here. */
  @Put('memory/outline')
  save(@CurrentUser() user: SessionUser, @Param('id') documentId: string, @Body() body: unknown) {
    const parsed = outlineBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid outline', parsed.error.issues);
    return this.outline.save(user.id, documentId, parsed.data.outline);
  }

  /** W8.6: the glossary editor. */
  @Put('memory/glossary')
  saveGlossary(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const parsed = glossaryBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid glossary', parsed.error.issues);
    return this.outline.saveGlossary(user.id, documentId, parsed.data.glossary);
  }

  /** Deleting a chapter with content needs the word count the student was shown. */
  @Delete('chapters/:chapterId')
  deleteChapter(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Param('chapterId') chapterId: string,
    @Body() body: unknown,
  ) {
    const parsed = deleteBody.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationError('Confirm the word count', parsed.error.issues);
    return this.outline.deleteChapter(user.id, documentId, chapterId, parsed.data.wordCount);
  }
}
