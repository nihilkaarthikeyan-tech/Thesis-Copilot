/**
 * Import from Zotero by API key — ADR-0062 (ADR-0059 row 36).
 *
 * FR-2.9 by another transport: the student's items are read once from the Zotero Web API and go
 * down the same resolve pipeline as a .bib file (`SourcesService.resolveReferences`), so the
 * dedupe and the job ids are the .bib import's own. Nothing is linked or synced afterwards.
 *
 * ## The key
 *
 * It arrives in the request body (which the Pino logger redacts, `app.module.ts`), is passed to
 * `@tc/retrieval`'s client, sent to Zotero in a header, and dropped when the request ends. It is
 * never written to the database, a job payload, a log line or an error message: the client builds
 * every message from the status alone and never attaches the fetch failure as a `cause`, and this
 * service redacts anything that reaches it regardless. `test/zotero-import.spec.ts` checks every
 * table, every Redis value and every log call for it.
 */

import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type BibEntry,
  listZoteroCollections,
  readZoteroItems,
  redactKey,
  ZOTERO_IMPORT_CAP,
  type ZoteroCollection,
  type ZoteroCredentials,
  ZoteroError,
} from '@tc/retrieval';
import { AppError, NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { SourcesService } from './sources.service.js';

export type ZoteroImportResult = {
  /** References read from Zotero (notes and attachments left out). */
  entries: number;
  /** References with neither a title nor a DOI. */
  skipped: number;
  /** Notes, standalone attachments and annotations, which are not references. */
  notReferences: number;
  queued: number;
  alreadyPresent: number;
};

const normaliseDoi = (doi: string | null): string | null =>
  doi
    ? doi
        .trim()
        .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
        .toLowerCase()
    : null;

/** A Zotero failure as the problem-details error the web app shows. */
function toAppError(error: unknown, apiKey: string): AppError {
  if (error instanceof ZoteroError) {
    const message = redactKey(error.message, apiKey);
    switch (error.failure) {
      case 'BAD_KEY':
        return new AppError(
          'ZOTERO_REFUSED',
          'Zotero refused the key',
          HttpStatus.BAD_REQUEST,
          message,
        );
      case 'NOT_FOUND':
        return new AppError(
          'ZOTERO_NOT_FOUND',
          'Not found in Zotero',
          HttpStatus.BAD_REQUEST,
          message,
        );
      case 'TOO_MANY':
        return new AppError('ZOTERO_TOO_MANY', 'Too many items', HttpStatus.BAD_REQUEST, message, {
          total: error.total,
          cap: ZOTERO_IMPORT_CAP,
        });
      case 'RATE_LIMITED':
        return new AppError(
          'ZOTERO_UNAVAILABLE',
          'Zotero is busy',
          HttpStatus.SERVICE_UNAVAILABLE,
          message,
        );
      default:
        return new AppError(
          'ZOTERO_UNAVAILABLE',
          'Zotero could not be reached',
          HttpStatus.BAD_GATEWAY,
          message,
        );
    }
  }
  // Anything else is ours, not Zotero's. Its text is not trusted to be free of the key.
  return new AppError(
    'ZOTERO_UNAVAILABLE',
    'Zotero import failed',
    HttpStatus.BAD_GATEWAY,
    'The import from Zotero did not work. Try again, or export a .bib file from Zotero instead.',
  );
}

@Injectable()
export class ZoteroImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: SourcesService,
  ) {}

  /** Owner only, and checked before Zotero is called: the server is nobody's proxy. */
  private async assertOwner(ownerId: string, documentId: string): Promise<void> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true },
    });
    if (!document) throw new NotFoundError('That document');
  }

  /** Checks the key by listing the library's collections, for the "which collection?" choice. */
  async collections(
    ownerId: string,
    documentId: string,
    credentials: ZoteroCredentials,
  ): Promise<{ collections: ZoteroCollection[]; cap: number }> {
    await this.assertOwner(ownerId, documentId);
    try {
      return { collections: await listZoteroCollections(credentials), cap: ZOTERO_IMPORT_CAP };
    } catch (error) {
      throw toAppError(error, credentials.apiKey);
    }
  }

  async importItems(
    ownerId: string,
    documentId: string,
    credentials: ZoteroCredentials,
    collectionKey: string | null,
  ): Promise<ZoteroImportResult> {
    await this.assertOwner(ownerId, documentId);
    let read: Awaited<ReturnType<typeof readZoteroItems>>;
    try {
      read = await readZoteroItems(credentials, { collectionKey });
    } catch (error) {
      throw toAppError(error, credentials.apiKey);
    }

    // The resolve pipeline dedupes on the reference line; a paper already in the library from a
    // .bib file or a search has a different line, so a DOI match counts as present too.
    const existing = await this.prisma.source.findMany({
      where: { documentId, doi: { not: null } },
      select: { doi: true },
    });
    const dois = new Set(existing.map((s) => normaliseDoi(s.doi)).filter(Boolean));
    const fresh: BibEntry[] = [];
    let presentByDoi = 0;
    for (const entry of read.entries) {
      const doi = normaliseDoi(entry.doi);
      if (doi && dois.has(doi)) {
        presentByDoi++;
        continue;
      }
      if (doi) dois.add(doi);
      fresh.push(entry);
    }

    const result = await this.sources.resolveReferences(
      ownerId,
      documentId,
      fresh.map((e) => ({ raw: e.raw, ...(e.doi ? { doi: e.doi } : {}) })),
    );
    return {
      entries: read.entries.length,
      skipped: read.skipped,
      notReferences: read.notReferences,
      queued: result.queued,
      alreadyPresent: result.alreadyPresent + presentByDoi,
    };
  }
}
