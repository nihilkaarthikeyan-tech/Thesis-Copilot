/**
 * Sources and seed papers — PRD §9.1 and §9.2.
 *
 * Multipart uploads go through `@fastify/multipart`, registered in `bootstrap.ts` with the outer
 * size ceiling; the per-plan limit is enforced in `upload-rules.ts` (PRD §11.3, §12.1).
 */

import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Plan } from '@tc/config';
import { PLANS } from '@tc/config';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { SourcesService, UploadRejected } from './sources.service.js';

const refixBody = z.object({ doi: z.string().trim().min(3).max(200) });

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
  constructor(private readonly sources: SourcesService) {}

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
