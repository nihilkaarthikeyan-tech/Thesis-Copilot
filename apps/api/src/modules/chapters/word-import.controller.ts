/**
 * `POST /documents/:id/import-docx` — "Import from Word" (2026-10-04). See `word-import.service.ts`.
 *
 * Multipart with one `.docx`, like every other upload (`@fastify/multipart`, `bootstrap.ts`). The
 * mode is a query parameter so it is known before the file is read:
 *   - `?mode=preview` converts and reports what it found, writing nothing;
 *   - `?mode=append` (the default) adds the chapters after the existing ones;
 *   - `?mode=replace` replaces a thesis whose chapters are all empty.
 */

import { Controller, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { IMPORT_MODES, WordImportService } from './word-import.service.js';

const modeQuery = z.object({ mode: z.enum(['preview', ...IMPORT_MODES]).default('append') });

@Controller('documents/:id')
@UseGuards(SessionGuard)
export class WordImportController {
  constructor(private readonly imports: WordImportService) {}

  @Post('import-docx')
  @HttpCode(200)
  async importDocx(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
  ) {
    const parsed = modeQuery.safeParse(query);
    if (!parsed.success) {
      throw new ValidationError('Choose preview, append or replace', parsed.error.issues);
    }
    const file = await (
      request as unknown as {
        file: () => Promise<{ filename: string; toBuffer: () => Promise<Buffer> } | undefined>;
      }
    ).file();
    if (!file) throw new ValidationError('Attach the Word document (.docx) to import.');
    const bytes = new Uint8Array(await file.toBuffer());
    const { mode } = parsed.data;
    return mode === 'preview'
      ? this.imports.preview(user, documentId, file.filename, bytes)
      : this.imports.import(user, documentId, file.filename, bytes, mode);
  }
}
