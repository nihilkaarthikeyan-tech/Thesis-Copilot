/**
 * `/documents/:id/citations*` — PRD §9.3, FR-5.2–5.5, PHASES v2 W10.
 *
 * The editor asks for the rendered labels when it opens a chapter and again after a style switch;
 * the citations panel asks for the same payload, which also carries the bibliography and the
 * mechanical findings. One endpoint, because they are one computation.
 */

import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { CitationsService } from './citations.service.js';
import { CiteParseService } from './cite-parse.service.js';

const styleBody = z.object({ style: z.string().trim().min(1).max(60) });
const parseBody = z.object({ text: z.string().trim().min(4).max(20_000) });
const acceptBody = z.object({
  reference: z.string().trim().min(4).max(1_000),
  doi: z.string().trim().max(200).nullable().optional(),
});

@Controller('documents/:id')
@UseGuards(SessionGuard)
export class DocumentCitationsController {
  constructor(
    private readonly citations: CitationsService,
    private readonly citeParse: CiteParseService,
  ) {}

  /** Labels, bibliography and the FR-5.4 findings for the whole document. */
  @Get('citations')
  render(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.citations.render(user.id, documentId);
  }

  /** FR-5.2: global and instant — one column changes and the labels are recomputed. */
  @Put('citation-style')
  setStyle(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const parsed = styleBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Pick a style', parsed.error.issues);
    return this.citations.setStyle(user.id, documentId, parsed.data.style);
  }

  /** FR-5.5: parse a pasted reference (or a whole pasted list) and verify each against Crossref. */
  @Post('citations/parse')
  @HttpCode(200)
  parse(@CurrentUser() user: SessionUser, @Param('id') documentId: string, @Body() body: unknown) {
    const parsed = parseBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Paste a reference first', parsed.error.issues);
    return this.citeParse.parse(user, documentId, parsed.data.text);
  }

  /** The student accepted one: it enters the library through the normal resolution path. */
  @Post('citations/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: SessionUser, @Param('id') documentId: string, @Body() body: unknown) {
    const parsed = acceptBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid reference', parsed.error.issues);
    return this.citeParse.accept(user, documentId, parsed.data.reference, parsed.data.doi ?? null);
  }
}
