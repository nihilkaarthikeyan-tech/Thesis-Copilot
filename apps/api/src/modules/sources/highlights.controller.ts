/**
 * Highlights and notes in the reader — see `highlights.service.ts` (ADR-0130).
 *
 *   GET    /sources/:id/highlights     the student's highlights on this paper, in reading order
 *   POST   /sources/:id/highlights     { view, page, chunkId, start, end, exact, prefix, suffix,
 *                                        quote, colour, note? }
 *   PATCH  /highlights/:id             { colour?, note? }
 *   DELETE /highlights/:id
 */

import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { readerHighlightCreate, readerHighlightUpdate } from '@tc/types';
import type { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { HighlightsService } from './highlights.service.js';

function parse<T extends z.ZodType>(schema: T, body: unknown, message: string): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ValidationError(message, parsed.error.issues);
  return parsed.data;
}

@Controller()
@UseGuards(SessionGuard)
export class HighlightsController {
  constructor(private readonly highlights: HighlightsService) {}

  @Get('sources/:id/highlights')
  list(@CurrentUser() user: SessionUser, @Param('id') sourceId: string) {
    return this.highlights.list(user.id, sourceId);
  }

  @Post('sources/:id/highlights')
  create(@CurrentUser() user: SessionUser, @Param('id') sourceId: string, @Body() body: unknown) {
    const input = parse(readerHighlightCreate, body, 'That highlight could not be saved.');
    return this.highlights.create(user.id, sourceId, input);
  }

  @Patch('highlights/:id')
  update(
    @CurrentUser() user: SessionUser,
    @Param('id') highlightId: string,
    @Body() body: unknown,
  ) {
    const input = parse(readerHighlightUpdate, body, 'That change could not be saved.');
    return this.highlights.update(user.id, highlightId, input);
  }

  @Delete('highlights/:id')
  remove(@CurrentUser() user: SessionUser, @Param('id') highlightId: string) {
    return this.highlights.remove(user.id, highlightId);
  }
}
