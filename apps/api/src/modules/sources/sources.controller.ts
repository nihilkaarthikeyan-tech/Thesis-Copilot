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
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { DETAIL_TYPES } from '@tc/citations';
import type { Plan } from '@tc/config';
import { PLANS } from '@tc/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { LibraryFilingService } from '../../common/library-filing.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { PaperIdService } from './paper-id.service.js';
import { SearchService } from './search.service.js';
import { SourcesService, UploadRejected } from './sources.service.js';
import { ZoteroImportService } from './zotero-import.service.js';

const refixBody = z.object({ doi: z.string().trim().min(3).max(200) });

const mergeBody = z.object({ duplicateId: z.string().uuid() });

const exportFormat = z.enum(['bib', 'ris', 'csv']);

const resolveBody = z.object({
  references: z
    .array(z.object({ raw: z.string().trim().min(1), doi: z.string().trim().optional() }))
    .max(500),
  /** R18 (ADR-0129): the collection to file the papers into; absent or null, the library only. */
  collectionId: z.string().uuid().nullable().optional(),
});

/**
 * ADR-0062: the Zotero user ID and key. Checked by shape only — Zotero says whether they are
 * right. The issues are never echoed back: a rejected key would otherwise appear in the response.
 */
const zoteroCredentials = z.object({
  userId: z
    .string()
    .trim()
    .regex(/^\d{1,12}$/),
  apiKey: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{8,64}$/),
});
const zoteroImport = zoteroCredentials.extend({
  collectionKey: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{1,16}$/)
    .nullable()
    .optional(),
});

function parseZotero<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    throw new ValidationError(
      field === 'userId'
        ? 'Enter your Zotero user ID: the number shown on the keys page, not your username.'
        : field === 'apiKey'
          ? 'Paste the API key exactly as Zotero shows it: letters and numbers only.'
          : 'That collection is not one Zotero listed.',
    );
  }
  return parsed.data;
}

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

const nameBody = z.object({
  family: z.string().max(200).optional(),
  given: z.string().max(200).optional(),
  literal: z.string().max(300).optional(),
});
const detailsBody = z.object({
  type: z.enum(DETAIL_TYPES),
  title: z.string().trim().min(1, 'A paper needs a title.').max(1_000),
  authors: z.array(nameBody).max(100),
  year: z.number().int().min(1000).max(2100).nullable(),
  container: z.string().max(500),
  volume: z.string().max(50),
  issue: z.string().max(50),
  pages: z.string().max(50),
  publisher: z.string().max(300),
  doi: z.string().max(300),
  url: z.string().max(2_000),
});

const importIdBody = z.object({ q: z.string().trim().min(1).max(300) });
const fetchPdfsBody = z.object({ sourceIds: z.array(z.string().uuid()).max(200).optional() });
const qualityChapter = z.string().uuid().optional();

@Controller()
@UseGuards(SessionGuard)
export class SourcesController {
  constructor(
    private readonly sources: SourcesService,
    private readonly search: SearchService,
    private readonly zotero: ZoteroImportService,
    private readonly paperIds: PaperIdService,
    private readonly filing: LibraryFilingService,
  ) {}

  /**
   * ADR-0062: checks a Zotero key by listing the library's collections. A POST so the key travels
   * in the body (which is never logged), not the URL (which is).
   */
  @Post('documents/:id/sources/zotero/collections')
  @HttpCode(200)
  zoteroCollections(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const { userId, apiKey } = parseZotero(zoteroCredentials, body);
    return this.zotero.collections(user.id, documentId, { userId, apiKey });
  }

  /** ADR-0062: reads the library (or one collection) once into the resolve pipeline. */
  @Post('documents/:id/sources/zotero/import')
  @HttpCode(200)
  zoteroImport(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const { userId, apiKey, collectionKey } = parseZotero(zoteroImport, body);
    return this.zotero.importItems(user.id, documentId, { userId, apiKey }, collectionKey ?? null);
  }

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

  /** R19 (ADR-0106): every paper the thesis cites, how often and where. Free. */
  @Get('documents/:id/cited-sources')
  citedSources(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.sources.citedSources(user.id, documentId);
  }

  /** R19 (ADR-0106): keep the cited papers that were found for the student as their own. */
  @Post('documents/:id/cited-sources/keep')
  @HttpCode(200)
  keepCited(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const parsed = fetchPdfsBody.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid request', parsed.error.issues);
    return this.sources.keepCitedFound(user.id, documentId, parsed.data.sourceIds);
  }

  /** R16 (ADR-0103): what a pasted DOI, arXiv id, PubMed id or ISBN names. Free. */
  @Get('documents/:id/sources/lookup-id')
  lookupId(@CurrentUser() _user: SessionUser, @Query('q') q: string | undefined) {
    if (!q?.trim() || q.length > 300)
      throw new ValidationError('Paste a DOI, arXiv id, PubMed id or ISBN.');
    return this.paperIds.lookup(q);
  }

  /** R16 (ADR-0103): add the paper an identifier names. Free. */
  @Post('documents/:id/sources/import-id')
  importId(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const parsed = importIdBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Paste a DOI, arXiv id, PubMed id or ISBN.');
    return this.paperIds.import(user.id, documentId, parsed.data.q);
  }

  /** R15 (ADR-0102): a paper's details for the edit form. */
  @Get('sources/:id/details')
  details(@CurrentUser() user: SessionUser, @Param('id') sourceId: string) {
    return this.sources.details(user.id, sourceId);
  }

  /** R15 (ADR-0102): the student's corrections; every citation of the paper follows. Free. */
  @Put('sources/:id/details')
  saveDetails(
    @CurrentUser() user: SessionUser,
    @Param('id') sourceId: string,
    @Body() body: unknown,
  ) {
    const parsed = detailsBody.safeParse(body);
    if (!parsed.success) throw new ValidationError('Check the details', parsed.error.issues);
    return this.sources.saveDetails(user.id, sourceId, parsed.data);
  }

  /** R14 (ADR-0101): look again for open-access copies of papers that have no PDF. Free. */
  @Post('documents/:id/sources/fetch-pdfs')
  @HttpCode(202)
  fetchPdfs(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Body() body: unknown,
  ) {
    const parsed = fetchPdfsBody.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationError('Invalid request', parsed.error.issues);
    return this.sources.fetchMissingPdfs(user.id, documentId, parsed.data.sourceIds);
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
    // Checked before the add, so a collection that is not this thesis's adds nothing.
    const target = await this.filing.target(user.id, documentId, parsed.data.collectionId);
    const result = await this.sources.resolveReferences(
      user.id,
      documentId,
      parsed.data.references,
    );
    const filedIn = await this.filing.file(documentId, target, result.sourceIds);
    return { ...result, filedIn };
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

  /**
   * ADR-0076: papers with a standing problem (retracted, preprint, uncited, weak venue). Free.
   * `?chapterId=` adds that chapter's bibliography notes, a year chart and venue spread (ADR-0112).
   */
  @Get('documents/:id/sources/quality')
  quality(
    @CurrentUser() user: SessionUser,
    @Param('id') documentId: string,
    @Query('chapterId') chapterId: string | undefined,
  ) {
    const parsed = qualityChapter.safeParse(chapterId);
    if (!parsed.success) throw new ValidationError('Invalid chapter', parsed.error.issues);
    return this.sources.sourceQuality(user.id, documentId, parsed.data);
  }

  /** Possible duplicates in the library — the same DOI, or the same title, year and first author. */
  @Get('documents/:id/sources/duplicates')
  duplicates(@CurrentUser() user: SessionUser, @Param('id') documentId: string) {
    return this.sources.listDuplicates(user.id, documentId);
  }

  /** Keeps `:id`, moves the duplicate's citations, pins and PDF onto it, and removes the duplicate. */
  @Post('sources/:id/merge')
  merge(@CurrentUser() user: SessionUser, @Param('id') keepId: string, @Body() body: unknown) {
    const parsed = mergeBody.safeParse(body);
    if (!parsed.success)
      throw new ValidationError('Name the duplicate to merge', parsed.error.issues);
    return this.sources.mergeSources(user.id, keepId, parsed.data.duplicateId);
  }

  /** "Add the PDF" to a source already in the library, which is then read again. */
  @Post('sources/:id/upload')
  async attachPdf(
    @CurrentUser() user: SessionUser,
    @Param('id') sourceId: string,
    @Req() request: FastifyRequest,
  ) {
    const { filename, bytes } = await readUpload(request);
    return this.sources.attachPdf({
      ownerId: user.id,
      plan: planOf(user),
      sourceId,
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

  /**
   * ADR-0068: the PDF's bytes for the reader's own pdf.js view. Fetched by the page with the
   * session cookie, so it is never framed and the host's `X-Frame-Options` on storage links does
   * not apply. `private`: a shared cache must never hold one student's paper for another.
   */
  @Get('sources/:id/file/content')
  async fileContent(
    @CurrentUser() user: SessionUser,
    @Param('id') sourceId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    const file = await this.sources.openFile(user.id, sourceId);
    reply.header('cache-control', 'private, max-age=300');
    return new StreamableFile(file.stream, {
      type: 'application/pdf',
      disposition: 'inline; filename="paper.pdf"',
      length: file.size,
    });
  }

  /** ADR-0068: one paper for the reader page — the row, its collections, where reading stands. */
  @Get('sources/:id')
  readerView(@CurrentUser() user: SessionUser, @Param('id') sourceId: string) {
    return this.sources.readerView(user.id, sourceId);
  }

  /** ADR-0068: the paper's text as held — passages in order, page and section on each. */
  @Get('sources/:id/text')
  readerText(@CurrentUser() user: SessionUser, @Param('id') sourceId: string) {
    return this.sources.readerText(user.id, sourceId);
  }

  @Delete('sources/:id')
  remove(@CurrentUser() user: SessionUser, @Param('id') sourceId: string) {
    return this.sources.removeSource(user.id, sourceId);
  }
}

export { UploadRejected };
