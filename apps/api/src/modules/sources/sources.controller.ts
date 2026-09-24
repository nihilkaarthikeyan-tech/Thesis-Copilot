/**
 * Sources and seed papers — PRD §9.1 and §9.2.
 *
 * Multipart uploads go through `@fastify/multipart`, registered in `bootstrap.ts` with the outer
 * size ceiling; the per-plan limit is enforced in `upload-rules.ts` (PRD §11.3, §12.1).
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Plan } from '@tc/config';
import { PLANS } from '@tc/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { SearchService } from './search.service.js';
import { SourcesService, UploadRejected } from './sources.service.js';

const refixBody = z.object({ doi: z.string().trim().min(3).max(200) });

const exportFormat = z.enum(['bib', 'ris', 'csv']);

const resolveBody = z.object({
  references: z
    .array(z.object({ raw: z.string().trim().min(1), doi: z.string().trim().optional() }))
    .max(500),
});

const planOf = (user: SessionUser): Plan =>
  (PLANS as readonly string[]).includes(user.plan) ? (user.plan as Plan) : 'FREE_TRIAL';

/** Reads the single uploaded file from a multipart request. */
async function readUpload(
  request: FastifyRequest,
): Promise<{ filename: string; bytes: Uint8Array }> {
  const file = await (
    request as unknown as {
      file: () => Promise<{ filename: string; toBuffer: () => Promise<Buffer> } | undefined>;
    }
  ).file();

  if (!file) throw new ValidationError('Attach a file to upload.');
  const buffer = await file.toBuffer();
  return { filename: file.filename, bytes: new Uint8Array(buffer) };
}

@Controller()
@UseGuards(SessionGuard)
export class SourcesController {
  constructor(
    private readonly sources: SourcesService,
    private readonly search: SearchService,
  ) {}

  /** FR-2.9: BibTeX/RIS from Zotero or Mendeley into the resolve pipeline. */
  @Post('documents/:id/sources/import')
  async importBibliography(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Req() request: FastifyRequest,
  ) {
    const { filename, bytes } = await readUpload(request);
    return this.search.importBibliography(user.id, documentId, filename, Buffer.from(bytes));
  }

  /**
   * The library as a download. A plain GET with `Content-Disposition`, so the screen can use an
   * ordinary link: the session cookie goes with a top-level navigation, and nothing is stored or
   * signed for a file that takes milliseconds to write.
   */
  @Get('documents/:id/sources/export')
  async exportLibrary(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Query('format') format: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const parsed = exportFormat.safeParse(format ?? 'bib');
    if (!parsed.success) throw new ValidationError('Choose bib, ris or csv.', parsed.error.issues);
    const file = await this.sources.exportLibrary(user.id, documentId, parsed.data);
    reply.header('content-type', file.mimeType);
    reply.header('content-disposition', `attachment; filename="${file.filename}"`);
    reply.header('x-library-count', String(file.count));
    return file.body;
  }

  @Post('documents/:id/seed-papers')
  async addSeedPaper(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Req() request: FastifyRequest,
  ) {
    const { filename, bytes } = await readUpload(request);
    return this.sources.addSeedPaper({
      ownerId: user.id,
      plan: planOf(user),
      documentId,
      filename,
      bytes,
    });
  }

  @Get('documents/:id/seed-papers')
  listSeedPapers(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.sources.listSeedPapers(user.id, documentId);
  }

  @Get('documents/:documentId/seed-papers/:spId')
  seedPaper(@CurrentUser() user: SessionUser, @Param('spId') seedPaperId: string) {
    return this.sources.seedPaper(user.id, seedPaperId);
  }

  @Get('documents/:id/sources')
  listSources(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.sources.listSources(user.id, documentId);
  }

  @Post('documents/:id/sources/resolve')
  async resolve(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const parsed = resolveBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Invalid reference list', parsed.error.issues);
    return this.sources.resolveReferences(user.id, documentId, parsed.data.references);
  }

  @Post('documents/:id/sources/upload')
  async uploadLibraryPdf(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Req() request: FastifyRequest,
  ) {
    const { filename, bytes } = await readUpload(request);
    return this.sources.uploadLibraryPdf({
      ownerId: user.id,
      plan: planOf(user),
      documentId,
      filename,
      bytes,
    });
  }

  @Post('sources/:id/refix')
  async refix(
    @CurrentUser() user: SessionUser,
    @Param('id') sourceId: string,
    @Body() body: unknown,
  ) {
    const parsed = refixBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Enter a DOI', parsed.error.issues);
    return this.sources.refixSource(user.id, sourceId, parsed.data.doi);
  }

  /** PHASES 3.5: the passage a citation stands on, plus a signed PDF link for "Open at page". */
  @Get('sources/:id/chunks/:chunkId')
  passage(
    @CurrentUser() user: SessionUser,
    @Param('id') sourceId: string,
    @Param('chunkId') chunkId: string,
  ) {
    return this.sources.passage(user.id, sourceId, chunkId);
  }

  @Get('sources/:id/file')
  fileUrl(@CurrentUser() user: SessionUser, @Param('id') sourceId: string) {
    return this.sources.fileUrl(user.id, sourceId);
  }

  @Delete('sources/:id')
  remove(@CurrentUser() user: SessionUser, @Param('id') sourceId: string) {
    return this.sources.removeSource(user.id, sourceId);
  }
}

export { UploadRejected };
