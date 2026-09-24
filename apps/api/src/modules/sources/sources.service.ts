/**
 * Seed papers and the sources library — PRD §9.1 (`POST /documents/:id/seed-papers`), §9.2
 * (library, upload, resolve, file) and FR-1.1, FR-2.1 to FR-2.3.
 *
 * Every query is scoped by the document owner (PRD §12.1); nothing is fetched by id alone.
 */

import { Injectable, Logger } from '@nestjs/common';
import { exportLibrary, type LibraryFile, type LibraryFormat } from '@tc/citations';
import type { Plan } from '@tc/config';
import type { Prisma } from '@tc/db';
import { jobId, jobKeyDigest } from '@tc/types';
import { AppError, NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { QueueService } from '../../common/queue.service.js';
import { StorageService } from '../../common/storage.service.js';
import {
  checkLibraryQuota,
  checkSeedPaperQuota,
  checkUpload,
  seedPaperKey,
  type UploadRejection,
} from './upload-rules.js';

/** An upload the rules refused. 400 with the stable slug so the UI can explain it (FR-1.1 AC). */
export class UploadRejected extends AppError {
  constructor(reason: UploadRejection, detail: string) {
    super(reason, 'That file was not accepted', 400, detail);
  }
}

export type SeedPaperView = {
  id: string;
  filename: string;
  status: string;
  error: string | null;
  createdAt: string;
  hasExtraction: boolean;
};

export type SourceView = {
  id: string;
  status: string;
  title: string | null;
  authors: unknown;
  year: number | null;
  venue: string | null;
  doi: string | null;
  groundingLevel: string;
  citationCount: number | null;
  /** ADR-0022: the journal's 2-year mean citedness (OpenAlex); null when not known. */
  venueCitedness: number | null;
  isPreprint: boolean;
  isRetracted: boolean;
  hasFile: boolean;
  rawReference: string | null;
};

@Injectable()
export class SourcesService {
  private readonly logger = new Logger(SourcesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
  ) {}

  private async ownedDocument(ownerId: string, documentId: string): Promise<{ id: string }> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true },
    });
    if (!document) throw new NotFoundError('That document');
    return document;
  }

  /**
   * FR-1.1: upload a seed paper, store the bytes, record it PENDING and enqueue `extract-paper`.
   *
   * The row is created before the object is stored so the id can name the object; if the store
   * then fails the row is deleted, leaving no record pointing at nothing.
   */
  async addSeedPaper(input: {
    ownerId: string;
    plan: Plan;
    documentId: string;
    filename: string;
    bytes: Uint8Array;
  }): Promise<SeedPaperView> {
    await this.ownedDocument(input.ownerId, input.documentId);

    // The file itself is checked before the quota: a student who uploads the wrong file while at
    // quota should be told the file is wrong, which is the thing they can act on. The check is a
    // few bytes and costs nothing.
    const check = checkUpload({ filename: input.filename, bytes: input.bytes, plan: input.plan });
    if (!check.ok) throw new UploadRejected(check.reason, check.detail);

    const existing = await this.prisma.seedPaper.count({ where: { documentId: input.documentId } });
    const quota = checkSeedPaperQuota(existing, input.plan);
    if (!quota.ok) throw new UploadRejected(quota.reason, quota.detail);

    const seedPaper = await this.prisma.seedPaper.create({
      data: {
        documentId: input.documentId,
        filename: input.filename,
        fileKey: '',
        status: 'PENDING',
      },
      select: { id: true, filename: true, status: true, error: true, createdAt: true },
    });

    const key = seedPaperKey(input.documentId, seedPaper.id, check.kind);
    try {
      await this.storage.put(key, Buffer.from(input.bytes), {
        'Content-Type':
          check.kind === 'pdf'
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      await this.prisma.seedPaper.update({ where: { id: seedPaper.id }, data: { fileKey: key } });
    } catch (error) {
      await this.prisma.seedPaper.delete({ where: { id: seedPaper.id } });
      this.logger.error({ err: error, key }, 'seed paper upload failed');
      throw error;
    }

    // `jobId` makes this idempotent: a retried request cannot start the extraction twice.
    await this.queue.enqueue(
      'extract-paper',
      { seedPaperId: seedPaper.id, documentId: input.documentId, userId: input.ownerId },
      { jobId: jobId('extract-paper', seedPaper.id) },
    );

    return {
      id: seedPaper.id,
      filename: seedPaper.filename,
      status: seedPaper.status,
      error: seedPaper.error,
      createdAt: seedPaper.createdAt.toISOString(),
      hasExtraction: false,
    };
  }

  /** PRD §9.1 `GET /documents/:id/seed-papers/:spId` — extraction status and result. */
  async seedPaper(
    ownerId: string,
    seedPaperId: string,
  ): Promise<SeedPaperView & { extraction: unknown }> {
    const row = await this.prisma.seedPaper.findFirst({
      where: { id: seedPaperId, document: { ownerId } },
      select: {
        id: true,
        filename: true,
        status: true,
        error: true,
        createdAt: true,
        extraction: true,
      },
    });
    if (!row) throw new NotFoundError('That paper');
    return {
      id: row.id,
      filename: row.filename,
      status: row.status,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      hasExtraction: row.extraction !== null,
      extraction: row.extraction,
    };
  }

  async listSeedPapers(ownerId: string, documentId: string): Promise<SeedPaperView[]> {
    await this.ownedDocument(ownerId, documentId);
    const rows = await this.prisma.seedPaper.findMany({
      where: { documentId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        filename: true,
        status: true,
        error: true,
        createdAt: true,
        extraction: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      status: r.status,
      error: r.error,
      createdAt: r.createdAt.toISOString(),
      hasExtraction: r.extraction !== null,
    }));
  }

  /** PRD §9.2 `GET /documents/:id/sources` — the library, with grounding badges (FR-2.2 AC). */
  async listSources(ownerId: string, documentId: string): Promise<SourceView[]> {
    await this.ownedDocument(ownerId, documentId);
    const rows = await this.prisma.source.findMany({
      where: { documentId },
      orderBy: [{ status: 'asc' }, { year: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        status: true,
        title: true,
        authors: true,
        year: true,
        venue: true,
        doi: true,
        groundingLevel: true,
        citationCount: true,
        venueCitedness: true,
        isPreprint: true,
        isRetracted: true,
        fileKey: true,
        rawReference: true,
      },
    });
    return rows.map(({ fileKey, ...rest }) => ({ ...rest, hasFile: Boolean(fileKey) }));
  }

  /**
   * The library as a `.bib`, `.ris` or `.csv` — the way out that import always implied.
   *
   * Ordered by when each source was added, and only by that: `citationKeys` gives a colliding key
   * to whichever source claimed it first, so any other order would renumber `LeCun2015Deepb` into
   * `LeCun2015Deep` between two exports and break a student's LaTeX. Every source is included,
   * unresolved ones too, marked as such — a partial export would be a quiet way to lose references.
   */
  async exportLibrary(
    ownerId: string,
    documentId: string,
    format: LibraryFormat,
  ): Promise<LibraryFile & { filename: string; count: number }> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true, title: true },
    });
    if (!document) throw new NotFoundError('That document');
    const sources = await this.prisma.source.findMany({
      where: { documentId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        status: true,
        title: true,
        authors: true,
        year: true,
        venue: true,
        doi: true,
        cslJson: true,
        isPreprint: true,
        isRetracted: true,
        rawReference: true,
        citationCount: true,
        groundingLevel: true,
        oaStatus: true,
      },
    });
    const file = exportLibrary(sources, format);
    const slug =
      document.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'thesis';
    return { ...file, filename: `${slug}-library.${file.extension}`, count: sources.length };
  }

  /**
   * FR-2.1: turn the extracted reference strings into `Source` rows and enqueue one resolution job
   * each. Idempotent by `documentId + rawReference`, so re-running after a partial failure does not
   * duplicate the library.
   */
  async resolveReferences(
    ownerId: string,
    documentId: string,
    references: ReadonlyArray<{ raw: string; doi?: string }>,
  ): Promise<{ queued: number; alreadyPresent: number }> {
    await this.ownedDocument(ownerId, documentId);

    const existing = await this.prisma.source.findMany({
      where: { documentId },
      select: { rawReference: true },
    });
    const seen = new Set(existing.map((s) => s.rawReference).filter(Boolean));

    let queued = 0;
    let alreadyPresent = 0;

    for (const reference of references) {
      const raw = reference.raw.trim();
      if (!raw) continue;
      if (seen.has(raw)) {
        alreadyPresent++;
        continue;
      }
      seen.add(raw);

      await this.prisma.source.create({
        data: {
          documentId,
          status: 'PENDING',
          rawReference: raw,
          ...(reference.doi ? { doi: reference.doi } : {}),
        },
      });

      await this.queue.enqueue(
        'resolve-reference',
        {
          documentId,
          userId: ownerId,
          rawReference: raw,
          ...(reference.doi ? { printedDoi: reference.doi } : {}),
        },
        { jobId: jobId('resolve-reference', documentId, jobKeyDigest(raw)) },
      );
      queued++;
    }

    return { queued, alreadyPresent };
  }

  /** FR-2.3: the student's own PDF joins the library and goes through the same indexing pipeline. */
  async uploadLibraryPdf(input: {
    ownerId: string;
    plan: Plan;
    documentId: string;
    filename: string;
    bytes: Uint8Array;
  }): Promise<SourceView> {
    await this.ownedDocument(input.ownerId, input.documentId);

    const existing = await this.prisma.source.count({
      where: { documentId: input.documentId, fileKey: { not: null } },
    });
    const quota = checkLibraryQuota(existing, input.plan);
    if (!quota.ok) throw new UploadRejected(quota.reason, quota.detail);

    const check = checkUpload({ filename: input.filename, bytes: input.bytes, plan: input.plan });
    if (!check.ok) throw new UploadRejected(check.reason, check.detail);
    if (check.kind !== 'pdf') {
      throw new UploadRejected(
        'UNSUPPORTED_TYPE',
        'The library takes PDFs. Convert the file first.',
      );
    }

    const source = await this.prisma.source.create({
      data: {
        documentId: input.documentId,
        status: 'PENDING',
        title: input.filename.replace(/\.pdf$/i, ''),
        groundingLevel: 'NONE',
      },
    });

    const key = `sources/${input.documentId}/${source.id}.pdf`;
    await this.storage.put(key, Buffer.from(input.bytes), { 'Content-Type': 'application/pdf' });
    await this.prisma.source.update({ where: { id: source.id }, data: { fileKey: key } });

    await this.queue.enqueue(
      'index-source',
      { sourceId: source.id, documentId: input.documentId, userId: input.ownerId },
      { jobId: jobId('index-source', source.id) },
    );

    const view = await this.prisma.source.findFirstOrThrow({
      where: { id: source.id },
      select: {
        id: true,
        status: true,
        title: true,
        authors: true,
        year: true,
        venue: true,
        doi: true,
        groundingLevel: true,
        citationCount: true,
        venueCitedness: true,
        isPreprint: true,
        isRetracted: true,
        fileKey: true,
        rawReference: true,
      },
    });
    const { fileKey, ...rest } = view;
    return { ...rest, hasFile: Boolean(fileKey) };
  }

  /**
   * PHASES 2.8 "Fix reference": the student supplies the DOI for a reference the resolver could not
   * place, and it is queued for another attempt. The DOI is stored first so the retry has it even
   * if the queue is briefly unavailable.
   */
  async refixSource(
    ownerId: string,
    sourceId: string,
    doi: string,
  ): Promise<{ queued: true; doi: string }> {
    const source = await this.prisma.source.findFirst({
      where: { id: sourceId, document: { ownerId } },
      select: { id: true, documentId: true, rawReference: true },
    });
    if (!source) throw new NotFoundError('That source');

    const normalised = doi
      .trim()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
      .replace(/^doi:\s*/i, '');

    await this.prisma.source.update({
      where: { id: source.id },
      data: { doi: normalised, status: 'PENDING' },
    });

    await this.queue.enqueue(
      'resolve-reference',
      {
        documentId: source.documentId,
        userId: ownerId,
        rawReference: source.rawReference ?? normalised,
        printedDoi: normalised,
      },
      // A new id each time, so a re-fix is not swallowed as a duplicate of the first attempt.
      {
        jobId: jobId(
          'resolve-reference',
          source.documentId,
          jobKeyDigest(`${normalised}:${Date.now()}`),
        ),
      },
    );

    return { queued: true, doi: normalised };
  }

  /**
   * PHASES 3.5: the passage behind a citation, for the hover popover and "Open PDF at page".
   * Ownership is checked through the source's document; the chunk must belong to that source, so
   * a chunk id from another student's library answers 404 rather than leaking a passage.
   */
  async passage(
    ownerId: string,
    sourceId: string,
    chunkId: string,
  ): Promise<{
    chunkId: string;
    sourceId: string;
    text: string;
    page: number | null;
    section: string | null;
    source: {
      title: string | null;
      year: number | null;
      authors: unknown;
      groundingLevel: string;
      hasFile: boolean;
    };
    /** Signed, time-limited; null when there is no PDF. The client appends `#page=N`. */
    pdfUrl: string | null;
  }> {
    const chunk = await this.prisma.sourceChunk.findFirst({
      where: { id: chunkId, sourceId, source: { document: { ownerId } } },
      select: {
        id: true,
        text: true,
        page: true,
        section: true,
        source: {
          select: {
            id: true,
            title: true,
            year: true,
            authors: true,
            groundingLevel: true,
            fileKey: true,
          },
        },
      },
    });
    if (!chunk) throw new NotFoundError('That passage');

    return {
      chunkId: chunk.id,
      sourceId: chunk.source.id,
      text: chunk.text,
      page: chunk.page,
      section: chunk.section,
      source: {
        title: chunk.source.title,
        year: chunk.source.year,
        authors: chunk.source.authors,
        groundingLevel: chunk.source.groundingLevel,
        hasFile: Boolean(chunk.source.fileKey),
      },
      pdfUrl: chunk.source.fileKey ? await this.storage.signedUrl(chunk.source.fileKey) : null,
    };
  }

  /** PRD §9.2 `GET /sources/:id/file` — a time-limited link, issued only after an ownership check. */
  async fileUrl(ownerId: string, sourceId: string): Promise<{ url: string }> {
    const source = await this.prisma.source.findFirst({
      where: { id: sourceId, document: { ownerId } },
      select: { fileKey: true },
    });
    if (!source?.fileKey) throw new NotFoundError('A file for that source');
    return { url: await this.storage.signedUrl(source.fileKey) };
  }

  /** PRD §9.2 `DELETE /sources/:id`. The citation nodes that pointed at it go red, never deleted (B.5). */
  async removeSource(ownerId: string, sourceId: string): Promise<{ removed: true }> {
    const source = await this.prisma.source.findFirst({
      where: { id: sourceId, document: { ownerId } },
      select: { id: true, fileKey: true },
    });
    if (!source) throw new NotFoundError('That source');

    await this.prisma.source.delete({ where: { id: source.id } });
    if (source.fileKey) {
      await this.storage.remove(source.fileKey).catch(() => undefined);
    }
    return { removed: true };
  }

  /** Stores the extraction the worker produced and seeds document memory (FR-1.2, FR-3.5). */
  async saveExtraction(seedPaperId: string, extraction: Prisma.InputJsonValue): Promise<void> {
    await this.prisma.seedPaper.update({
      where: { id: seedPaperId },
      data: { extraction, status: 'DONE', error: null },
    });
  }
}
