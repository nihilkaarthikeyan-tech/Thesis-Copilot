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

const templateBody = z.object({ template: z.enum(TEMPLATES) });
const generateBody = z.object({ template: z.enum(TEMPLATES).optional() });
const outlineBody = z.object({ outline: z.array(z.unknown()) });
const glossaryBody = z.object({ glossary: z.record(z.string(), z.unknown()) });
const deleteBody = z.object({ wordCount: z.number().int().min(0) });

@Controller('documents/:id')
@UseGuards(SessionGuard)
export class OutlineController {
  constructor(private readonly outline: OutlineService) {}

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
