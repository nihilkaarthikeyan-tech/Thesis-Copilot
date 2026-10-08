/**
 * Seed papers and the sources library — PRD §9.1 (`POST /documents/:id/seed-papers`), §9.2
 * (library, upload, resolve, file) and FR-1.1, FR-2.1 to FR-2.3.
 *
 * Every query is scoped by the document owner (PRD §12.1); nothing is fetched by id alone.
 */

import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  detailsOf,
  exportLibrary,
  type LibraryFile,
  type LibraryFormat,
  type SourceDetails,
  withDetails,
} from '@tc/citations';
import type { Plan } from '@tc/config';
import type { Prisma } from '@tc/db';
import { openAccessFromStatus } from '@tc/retrieval';
import { jobId, jobKeyDigest } from '@tc/types';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { QueueService } from '../../common/queue.service.js';
import { StorageService } from '../../common/storage.service.js';
import { SnapshotsService } from '../chapters/snapshots.service.js';
import { type BibliographyNotes, bibliographyNotes } from './bibliography-notes.js';
import {
  type DuplicatePair,
  findDuplicates,
  type HygieneSource,
  QUALITY_ADVICE,
  type QualityIssue,
  qualityIssues,
  repointCitations,
  whyNoFullText,
} from './library-hygiene.js';
import { type ReaderPassage, readerPassages } from './reader-text.js';
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
  /** The open-access route as OpenAlex / Unpaywall named it; null when not looked up. */
  oaStatus: string | null;
  /** Free to read (true), closed (false), not known (null) — from `oaStatus`. */
  openAccess: boolean | null;
  isPreprint: boolean;
  isRetracted: boolean;
  hasFile: boolean;
  rawReference: string | null;
  /** ADR-0037: when the system added it because the library had nothing on a section. */
  autoAddedAt: Date | null;
  /** Why the AI cannot quote it in full, as far as the record shows; null when it can. */
  noFullTextReason: string | null;
};

/** A library row as `GET /documents/:id/sources` lists it: with the collections it is in. */
export type LibrarySourceView = SourceView & { collectionIds: string[] };

/**
 * Where reading a paper stands, as the reader page says it (ADR-0068):
 *
 *   LOOKING_UP  — the reference is still being identified
 *   READING     — a PDF or an open-access copy is being read now
 *   FULL_TEXT   — the whole paper's text is held
 *   ABSTRACT    — only the abstract is held
 *   UNREADABLE  — a PDF is attached and nothing could be read from it
 *   NOTHING     — no text at all (no abstract, no copy, or the reference was never found)
 */
export type ReadingState =
  | 'LOOKING_UP'
  | 'READING'
  | 'FULL_TEXT'
  | 'ABSTRACT'
  | 'UNREADABLE'
  | 'NOTHING';

export function readingState(
  view: Pick<SourceView, 'status' | 'groundingLevel' | 'hasFile'>,
  jobUnfinished: boolean,
): ReadingState {
  // An uploaded PDF is read before its record is identified: the text is there to read.
  if (view.groundingLevel === 'FULL_TEXT') return 'FULL_TEXT';
  if (view.status === 'PENDING') return 'LOOKING_UP';
  if (jobUnfinished) return 'READING';
  if (view.hasFile) return 'UNREADABLE';
  return view.groundingLevel === 'ABSTRACT' ? 'ABSTRACT' : 'NOTHING';
}

/** One paper as the reader page shows it (ADR-0068). */
export type ReaderSourceView = SourceView & {
  documentId: string;
  collections: Array<{ id: string; name: string }>;
  /** How many passages of text are held — zero means there is nothing for the Text view. */
  passageCount: number;
  reading: ReadingState;
  /** R17: the abstract the record carries, for the library drawer; null when none. */
  abstract: string | null;
};

/** One side of a possible duplicate, with what the thesis does with it. */
export type DuplicateSide = SourceView & { citeCount: number; pinCount: number };

export type DuplicateView = {
  reason: DuplicatePair['reason'];
  keep: DuplicateSide;
  drop: DuplicateSide;
};

export type MergeResult = {
  keptId: string;
  removedId: string;
  /** Citation nodes in chapters that now point at the kept source. */
  citationsMoved: number;
  /** Of those, the ones whose passage could not be matched in the kept source. */
  passagesCleared: number;
  pinsMoved: number;
  chaptersChanged: number;
  /** True when the removed record's PDF now belongs to the kept one (it had none). */
  fileMoved: boolean;
};

const SOURCE_VIEW_SELECT = {
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
  oaStatus: true,
  isPreprint: true,
  isRetracted: true,
  fileKey: true,
  rawReference: true,
  autoAddedAt: true,
  fullTextNote: true,
  // R17 (ADR-0104): the library's kind filter.
  type: true,
} as const;

type SourceViewRow = {
  id: string;
  status: string;
  title: string | null;
  authors: unknown;
  year: number | null;
  venue: string | null;
  doi: string | null;
  groundingLevel: string;
  citationCount: number | null;
  venueCitedness: number | null;
  oaStatus: string | null;
  isPreprint: boolean;
  isRetracted: boolean;
  fileKey: string | null;
  rawReference: string | null;
  autoAddedAt: Date | null;
  fullTextNote?: string | null;
  type?: string | null;
};

function toView({ fileKey, fullTextNote, ...rest }: SourceViewRow): SourceView {
  const hasFile = Boolean(fileKey);
  return {
    ...rest,
    openAccess: openAccessFromStatus(rest.oaStatus),
    hasFile,
    noFullTextReason: whyNoFullText({
      status: rest.status,
      groundingLevel: rest.groundingLevel,
      doi: rest.doi,
      hasFile,
      fullTextNote: fullTextNote ?? null,
    }),
  };
}

/** R14: papers looked for again in one press; a library is rarely larger, and each is a download. */
const FETCH_PDFS_MAX = 60;

@Injectable()
export class SourcesService {
  private readonly logger = new Logger(SourcesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
    private readonly snapshots: SnapshotsService,
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

    // A paper that could not be read does not use the allowance (2026-10-04): it counted, and on
    // the trial's one paper a failed upload left the student with nothing to do but start over.
    const existing = await this.prisma.seedPaper.count({
      where: { documentId: input.documentId, status: { not: 'FAILED' } },
    });
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
  async listSources(ownerId: string, documentId: string): Promise<LibrarySourceView[]> {
    await this.ownedDocument(ownerId, documentId);
    const rows = await this.prisma.source.findMany({
      where: { documentId },
      orderBy: [{ status: 'asc' }, { year: 'desc' }, { createdAt: 'asc' }],
      select: { ...SOURCE_VIEW_SELECT, collectionItems: { select: { collectionId: true } } },
    });
    // The collections each paper is in, so the screen can filter and count without a second call.
    return rows.map(({ collectionItems, ...row }) => ({
      ...toView(row),
      collectionIds: collectionItems.map((item) => item.collectionId),
    }));
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
  ): Promise<{
    queued: number;
    alreadyPresent: number;
    /**
     * ADR-0069: the library row each reference now has, in the order they were sent — the new
     * row, or the one already there under the same text; null for an empty reference. The Chrome
     * add-on opens the paper from it and files it into a collection.
     */
    sourceIds: Array<string | null>;
  }> {
    await this.ownedDocument(ownerId, documentId);

    const existing = await this.prisma.source.findMany({
      where: { documentId },
      select: { id: true, rawReference: true },
    });
    const seen = new Map<string, string>();
    for (const row of existing) if (row.rawReference) seen.set(row.rawReference, row.id);

    let queued = 0;
    let alreadyPresent = 0;
    const sourceIds: Array<string | null> = [];

    for (const reference of references) {
      const raw = reference.raw.trim();
      if (!raw) {
        sourceIds.push(null);
        continue;
      }
      const known = seen.get(raw);
      if (known) {
        alreadyPresent++;
        sourceIds.push(known);
        continue;
      }

      const created = await this.prisma.source.create({
        data: {
          documentId,
          status: 'PENDING',
          rawReference: raw,
          ...(reference.doi ? { doi: reference.doi } : {}),
        },
        select: { id: true },
      });
      seen.set(raw, created.id);
      sourceIds.push(created.id);

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

    return { queued, alreadyPresent, sourceIds };
  }

  /** FR-2.3: the student's own PDF joins the library and goes through the same indexing pipeline. */
  /** R15 (ADR-0102): a paper's details as the edit form shows them. */
  async details(ownerId: string, sourceId: string): Promise<SourceDetails> {
    const source = await this.prisma.source.findFirst({
      where: { id: sourceId, document: { ownerId } },
      select: {
        id: true,
        title: true,
        authors: true,
        year: true,
        venue: true,
        doi: true,
        cslJson: true,
        isPreprint: true,
        rawReference: true,
      },
    });
    if (!source) throw new NotFoundError('That source');
    return detailsOf(source);
  }

  /**
   * R15 (ADR-0102): the student's corrections to a paper's details, written to the stored CSL
   * record (which a citation is built from first) and to the row's own columns, so every citation
   * of it — in every chapter and the bibliography — follows on its next render. Free.
   */
  async saveDetails(
    ownerId: string,
    sourceId: string,
    details: SourceDetails,
  ): Promise<{ details: SourceDetails }> {
    const source = await this.prisma.source.findFirst({
      where: { id: sourceId, document: { ownerId } },
      select: { id: true, cslJson: true },
    });
    if (!source) throw new NotFoundError('That source');
    const cslJson = withDetails(source.cslJson, details);
    const updated = await this.prisma.source.update({
      where: { id: sourceId },
      data: {
        cslJson: cslJson as Prisma.InputJsonValue,
        title: details.title.trim() || null,
        authors: details.authors as unknown as Prisma.InputJsonValue,
        year: details.year,
        venue: details.container.trim() || null,
        doi: details.doi.trim() || null,
        type: details.type,
        // A student who has corrected the record has identified the paper.
        status: 'RESOLVED',
      },
      select: {
        id: true,
        title: true,
        authors: true,
        year: true,
        venue: true,
        doi: true,
        cslJson: true,
        isPreprint: true,
        rawReference: true,
      },
    });
    return { details: detailsOf(updated) };
  }

  /**
   * Jenni build plan R14 (ADR-0101): "Fetch PDF" — look again for an open-access copy of papers
   * that have none. `index-source` already tries arXiv, every copy Unpaywall lists and CORE; this
   * runs it again for each paper with a DOI and no file (a repository that was down, a copy that has
   * appeared since). The job id carries the minute, so a second press in the same minute adds
   * nothing and a later one is a real retry (CLAUDE.md: key a job on what it reads — here, the
   * outside world at that moment). Papers without a DOI cannot be looked up and are counted.
   */
  async fetchMissingPdfs(
    ownerId: string,
    documentId: string,
    sourceIds?: readonly string[],
  ): Promise<{ queued: number; noDoi: number }> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true },
    });
    if (!document) throw new NotFoundError('That document');
    const candidates = await this.prisma.source.findMany({
      where: {
        documentId,
        fileKey: null,
        status: { not: 'PENDING' },
        ...(sourceIds && sourceIds.length > 0 ? { id: { in: [...sourceIds] } } : {}),
      },
      select: { id: true, doi: true },
      orderBy: { createdAt: 'asc' },
      take: FETCH_PDFS_MAX,
    });
    const minute = Math.floor(Date.now() / 60_000);
    let queued = 0;
    let noDoi = 0;
    for (const source of candidates) {
      if (!source.doi) {
        noDoi += 1;
        continue;
      }
      await this.queue.enqueue(
        'index-source',
        { sourceId: source.id, documentId, userId: ownerId },
        { jobId: jobId('index-source', source.id, jobKeyDigest(`fetch-pdf ${minute}`)) },
      );
      queued += 1;
    }
    return { queued, noDoi };
  }

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
      select: SOURCE_VIEW_SELECT,
    });
    return toView(view);
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
      /** The record behind the citation, shown in the citation card (2026-09-30). */
      venue: string | null;
      doi: string | null;
      /**
       * What was fetched about the paper when it was resolved (coverage map rows 21, 32, 46).
       * Null means not known, never zero. The client maps them onto `CitationPassage.record`.
       */
      citationCount: number | null;
      oaStatus: string | null;
      openAccess: boolean | null;
      /** ADR-0022: the journal's 2-year mean citedness, from OpenAlex. */
      venueCitedness: number | null;
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
            venue: true,
            doi: true,
            citationCount: true,
            oaStatus: true,
            venueCitedness: true,
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
        venue: chunk.source.venue,
        doi: chunk.source.doi,
        citationCount: chunk.source.citationCount,
        oaStatus: chunk.source.oaStatus,
        openAccess: openAccessFromStatus(chunk.source.oaStatus),
        venueCitedness: chunk.source.venueCitedness,
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

  /**
   * ADR-0068: the source's PDF itself, for the reader's own pdf.js view. Owner only, like every
   * route here; anyone else gets the same 404 as an id that never existed. The bytes pass through
   * the API, so the browser never holds a storage link it could hand on.
   */
  async openFile(
    ownerId: string,
    sourceId: string,
  ): Promise<{ stream: import('node:stream').Readable; size: number }> {
    const source = await this.prisma.source.findFirst({
      where: { id: sourceId, document: { ownerId } },
      select: { fileKey: true },
    });
    if (!source?.fileKey) throw new NotFoundError('A file for that source');
    try {
      return await this.storage.open(source.fileKey);
    } catch (error) {
      // A row pointing at an object that is gone is a missing file, not a server fault.
      this.logger.warn({ err: error, sourceId }, 'source file missing from storage');
      throw new NotFoundError('A file for that source');
    }
  }

  /**
   * ADR-0068: one paper for the reader page — the library row, the collections it is in, and
   * where its reading stands, so the page can say honestly what it can show.
   */
  async readerView(ownerId: string, sourceId: string): Promise<ReaderSourceView> {
    const row = await this.prisma.source.findFirst({
      where: { id: sourceId, document: { ownerId } },
      select: {
        ...SOURCE_VIEW_SELECT,
        documentId: true,
        collectionItems: { select: { collection: { select: { id: true, name: true } } } },
        _count: { select: { chunks: true } },
        // R17 (ADR-0104): the library drawer shows the abstract.
        cslJson: true,
      },
    });
    if (!row) throw new NotFoundError('That source');
    const { documentId, collectionItems, _count, cslJson, ...rest } = row;
    const view = toView(rest);
    const storedAbstract = (cslJson as { abstract?: unknown } | null)?.abstract;

    // Only asked when it could change the answer: a paper with full text, or none and no file
    // and nothing queued, is settled.
    const unsettled =
      view.status !== 'PENDING' && view.groundingLevel !== 'FULL_TEXT'
        ? await this.queue.hasUnfinishedFor('index-source', view.id).catch(() => false)
        : false;

    return {
      ...view,
      documentId,
      collections: collectionItems.map((item) => item.collection),
      passageCount: _count.chunks,
      reading: readingState(view, unsettled),
      abstract: typeof storedAbstract === 'string' && storedAbstract.trim() ? storedAbstract : null,
    };
  }

  /** ADR-0068: the paper's text as we hold it, in order and without the chunker's overlaps. */
  async readerText(ownerId: string, sourceId: string): Promise<{ passages: ReaderPassage[] }> {
    const source = await this.prisma.source.findFirst({
      where: { id: sourceId, document: { ownerId } },
      select: { id: true },
    });
    if (!source) throw new NotFoundError('That source');
    const rows = await this.prisma.sourceChunk.findMany({
      where: { sourceId },
      orderBy: { ordinal: 'asc' },
      select: {
        id: true,
        ordinal: true,
        page: true,
        section: true,
        text: true,
        charStart: true,
        charEnd: true,
      },
    });
    return { passages: readerPassages(rows) };
  }

  /**
   * "Add the PDF" for a source already in the library (2026-10-04, the Jenni "Missing PDFs" tab):
   * the student's copy of a paper the system could only read the abstract of.
   *
   * The object key carries a digest of the bytes, and so does the job id: `index-source` reads the
   * file, so the job keys on the file (CLAUDE.md, "a job id must key on what the job will read").
   * The same file twice is one job; a different file is a new one, even for the same source.
   */
  async attachPdf(input: {
    ownerId: string;
    plan: Plan;
    sourceId: string;
    filename: string;
    bytes: Uint8Array;
  }): Promise<SourceView> {
    const source = await this.prisma.source.findFirst({
      where: { id: input.sourceId, document: { ownerId: input.ownerId } },
      select: { id: true, documentId: true, fileKey: true },
    });
    if (!source) throw new NotFoundError('That source');

    const check = checkUpload({ filename: input.filename, bytes: input.bytes, plan: input.plan });
    if (!check.ok) throw new UploadRejected(check.reason, check.detail);
    if (check.kind !== 'pdf') {
      throw new UploadRejected('UNSUPPORTED_TYPE', 'Attach a PDF. Convert the file first.');
    }

    // Replacing this source's own file does not take another slot of the allowance.
    if (!source.fileKey) {
      const existing = await this.prisma.source.count({
        where: { documentId: source.documentId, fileKey: { not: null } },
      });
      const quota = checkLibraryQuota(existing, input.plan);
      if (!quota.ok) throw new UploadRejected(quota.reason, quota.detail);
    }

    const digest = createHash('sha256').update(input.bytes).digest('hex').slice(0, 16);
    const key = `sources/${source.documentId}/${source.id}-${digest}.pdf`;
    await this.storage.put(key, Buffer.from(input.bytes), { 'Content-Type': 'application/pdf' });
    await this.prisma.source.update({ where: { id: source.id }, data: { fileKey: key } });
    if (source.fileKey && source.fileKey !== key) {
      await this.storage.remove(source.fileKey).catch(() => undefined);
    }

    await this.queue.enqueue(
      'index-source',
      {
        sourceId: source.id,
        documentId: source.documentId,
        userId: input.ownerId,
        contentKey: key,
      },
      { jobId: jobId('index-source', source.id, jobKeyDigest(key)) },
    );

    const view = await this.prisma.source.findFirstOrThrow({
      where: { id: source.id },
      select: SOURCE_VIEW_SELECT,
    });
    return toView(view);
  }

  /**
   * Jenni build plan R19 (ADR-0106): "Sources in this thesis" — every paper the chapters cite,
   * how often and where, most cited first, and whether it was found for the student (ADR-0037)
   * rather than added by them. Free.
   */
  async citedSources(
    ownerId: string,
    documentId: string,
  ): Promise<Array<SourceView & { citations: number; chapters: string[]; found: boolean }>> {
    await this.ownedDocument(ownerId, documentId);
    const rows = await this.prisma.citation.findMany({
      where: { chapter: { documentId } },
      select: { sourceId: true, chapter: { select: { title: true, order: true } } },
    });
    const bySource = new Map<string, { count: number; chapters: Map<string, number> }>();
    for (const row of rows) {
      const entry = bySource.get(row.sourceId) ?? { count: 0, chapters: new Map() };
      entry.count += 1;
      entry.chapters.set(row.chapter.title, row.chapter.order);
      bySource.set(row.sourceId, entry);
    }
    if (bySource.size === 0) return [];
    const sources = await this.prisma.source.findMany({
      where: { documentId, id: { in: [...bySource.keys()] } },
      select: SOURCE_VIEW_SELECT,
    });
    return sources
      .map((source) => {
        const use = bySource.get(source.id) as { count: number; chapters: Map<string, number> };
        return {
          ...toView(source),
          citations: use.count,
          chapters: [...use.chapters.entries()].sort((a, b) => a[1] - b[1]).map(([title]) => title),
          found: source.autoAddedAt !== null,
        };
      })
      .sort((a, b) => b.citations - a.citations || (a.title ?? '').localeCompare(b.title ?? ''));
  }

  /**
   * R19 (ADR-0106): "Save all to library" — the cited papers that were found for the student
   * become theirs, as if they had added them: "Cite from my library" (R3) and the library search
   * setting then count them. Only cited ones, only this thesis.
   */
  async keepCitedFound(
    ownerId: string,
    documentId: string,
    sourceIds?: readonly string[],
  ): Promise<{ kept: number }> {
    await this.ownedDocument(ownerId, documentId);
    const cited = await this.prisma.citation.findMany({
      where: {
        chapter: { documentId },
        ...(sourceIds && sourceIds.length > 0 ? { sourceId: { in: [...sourceIds] } } : {}),
      },
      select: { sourceId: true },
      distinct: ['sourceId'],
    });
    const result = await this.prisma.source.updateMany({
      where: {
        documentId,
        id: { in: cited.map((c) => c.sourceId) },
        autoAddedAt: { not: null },
      },
      data: { autoAddedAt: null },
    });
    return { kept: result.count };
  }

  /** Every source's use in the thesis: citation nodes (as rows) and chapter pins. */
  private async usage(
    documentId: string,
  ): Promise<{ cites: Map<string, number>; pins: Map<string, number> }> {
    const [cites, pins] = await Promise.all([
      this.prisma.citation.groupBy({
        by: ['sourceId'],
        where: { chapter: { documentId } },
        _count: { _all: true },
      }),
      this.prisma.chapterSourcePin.groupBy({
        by: ['sourceId'],
        where: { chapter: { documentId } },
        _count: { _all: true },
      }),
    ]);
    return {
      cites: new Map(cites.map((c) => [c.sourceId, c._count._all])),
      pins: new Map(pins.map((p) => [p.sourceId, p._count._all])),
    };
  }

  /**
   * ADR-0076: the library's papers with a standing problem (retracted, preprint, uncited, weak
   * venue), the ones the thesis actually cites first. Free: no model, only what we hold.
   *
   * With `chapterId` (R25, ADR-0112), also the bibliography notes for the papers that chapter
   * cites: a publication-year chart and the venue spread. `notes` is null without one.
   */
  async sourceQuality(
    ownerId: string,
    documentId: string,
    chapterId?: string,
  ): Promise<{
    checked: number;
    sources: Array<{
      id: string;
      title: string | null;
      year: number | null;
      citedInThesis: number;
      issues: Array<{ code: QualityIssue; advice: string }>;
    }>;
    notes: BibliographyNotes | null;
  }> {
    await this.ownedDocument(ownerId, documentId);
    const notes = chapterId ? await this.chapterNotes(documentId, chapterId) : null;
    const [rows, usage] = await Promise.all([
      this.prisma.source.findMany({
        where: { documentId },
        select: {
          id: true,
          title: true,
          year: true,
          isRetracted: true,
          isPreprint: true,
          citationCount: true,
          venueCitedness: true,
        },
      }),
      this.usage(documentId),
    ]);
    const sources = rows
      .map((row) => ({
        id: row.id,
        title: row.title,
        year: row.year,
        citedInThesis: usage.cites.get(row.id) ?? 0,
        issues: qualityIssues(row).map((code) => ({ code, advice: QUALITY_ADVICE[code] })),
      }))
      .filter((row) => row.issues.length > 0)
      .sort(
        (a, b) =>
          Number(b.issues.some((i) => i.code === 'RETRACTED')) -
            Number(a.issues.some((i) => i.code === 'RETRACTED')) ||
          b.citedInThesis - a.citedInThesis ||
          b.issues.length - a.issues.length,
      );
    return { checked: rows.length, sources, notes };
  }

  /**
   * R25 (ADR-0112): the year and venue notes over the papers one chapter cites, each once. From
   * the citation rows kept on every save, so the panel saves the chapter before it asks.
   */
  private async chapterNotes(documentId: string, chapterId: string): Promise<BibliographyNotes> {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, documentId },
      select: { id: true },
    });
    if (!chapter) throw new NotFoundError('That chapter');
    const cited = await this.prisma.citation.findMany({
      where: { chapterId },
      select: { sourceId: true },
      distinct: ['sourceId'],
    });
    const sources = await this.prisma.source.findMany({
      where: { documentId, id: { in: cited.map((c) => c.sourceId) } },
      select: { year: true, venue: true, venueOpenalexId: true },
    });
    return bibliographyNotes(sources);
  }

  /** Possible duplicates in one library (the Jenni "Library Issues" view). Nothing is changed. */
  async listDuplicates(ownerId: string, documentId: string): Promise<DuplicateView[]> {
    await this.ownedDocument(ownerId, documentId);
    const [rows, usage] = await Promise.all([
      this.prisma.source.findMany({
        where: { documentId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { ...SOURCE_VIEW_SELECT, createdAt: true },
      }),
      this.usage(documentId),
    ]);

    const sides = new Map<string, DuplicateSide>();
    const hygiene: HygieneSource[] = [];
    for (const { createdAt, ...row } of rows) {
      const view = toView(row);
      const citeCount = usage.cites.get(row.id) ?? 0;
      const pinCount = usage.pins.get(row.id) ?? 0;
      sides.set(row.id, { ...view, citeCount, pinCount });
      hygiene.push({
        id: row.id,
        title: row.title,
        year: row.year,
        doi: row.doi,
        authors: row.authors,
        status: row.status,
        groundingLevel: row.groundingLevel,
        hasFile: view.hasFile,
        citeCount,
        pinCount,
        createdAt,
      });
    }

    return findDuplicates(hygiene).map((pair) => ({
      reason: pair.reason,
      keep: sides.get(pair.keepId) as DuplicateSide,
      drop: sides.get(pair.dropId) as DuplicateSide,
    }));
  }

  /**
   * Merges `dropId` into `keepId` and removes `dropId`, without losing anything the student did
   * with it:
   *
   *   - every citation node of it, in every chapter, is pointed at the kept source (its passage
   *     moves to the kept source's chunk with the same text, or is cleared), and its `Citation`
   *     rows follow;
   *   - every chapter pin moves to the kept source;
   *   - its PDF moves too when the kept record has none.
   *
   * Each chapter it touches is snapshotted first (`PRE_MERGE`, one click from undone in History),
   * and written only at the version that was read: if the student saves in between, nothing is
   * written and the merge answers 409, so an edit is never overwritten. The chapter's version goes
   * up, so an open editor or a live room reloads onto the new text instead of saving over it.
   */
  async mergeSources(ownerId: string, keepId: string, dropId: string): Promise<MergeResult> {
    if (keepId === dropId) throw new ValidationError('Choose two different sources to merge.');
    const [keep, drop] = await Promise.all(
      [keepId, dropId].map((id) =>
        this.prisma.source.findFirst({
          where: { id, document: { ownerId } },
          select: { id: true, documentId: true, fileKey: true },
        }),
      ),
    );
    if (!keep || !drop) throw new NotFoundError('That source');
    if (keep.documentId !== drop.documentId) {
      throw new ValidationError('Those two sources are in different theses.');
    }
    const documentId = keep.documentId;

    // A citation's passage is a chunk of the removed source; the kept one may hold the same text.
    const [dropChunks, keepChunks] = await Promise.all([
      this.prisma.sourceChunk.findMany({
        where: { sourceId: drop.id },
        select: { id: true, text: true },
      }),
      this.prisma.sourceChunk.findMany({
        where: { sourceId: keep.id },
        select: { id: true, text: true },
      }),
    ]);
    const keepByText = new Map(keepChunks.map((c) => [c.text, c.id]));
    const chunkMap = new Map<string, string>();
    for (const chunk of dropChunks) {
      const match = keepByText.get(chunk.text);
      if (match) chunkMap.set(chunk.id, match);
    }

    // Every chapter is read, not only those with `Citation` rows: the rows mirror the document
    // and the document is the truth (B.2).
    const chapters = await this.prisma.chapter.findMany({
      where: { documentId },
      select: { id: true, content: true, version: true },
    });
    const rewrites = chapters
      .map((chapter) => ({
        chapter,
        ...repointCitations(chapter.content, drop.id, keep.id, chunkMap),
      }))
      .filter((r) => r.changed > 0);

    for (const { chapter } of rewrites) {
      await this.snapshots.write({
        documentId,
        chapterId: chapter.id,
        content: chapter.content,
        reason: 'PRE_MERGE',
      });
    }

    const fileMoved = !keep.fileKey && Boolean(drop.fileKey);
    let pinsMoved = 0;

    await this.prisma.$transaction(
      async (tx) => {
        for (const { chapter, doc } of rewrites) {
          const written = await tx.chapter.updateMany({
            where: { id: chapter.id, version: chapter.version },
            data: { content: doc as Prisma.InputJsonValue, version: { increment: 1 } },
          });
          if (written.count === 0) {
            throw new ConflictError(
              'A chapter was saved while the merge was running. Nothing was changed — try again.',
            );
          }
        }

        const rows = await tx.citation.findMany({
          where: { sourceId: drop.id },
          select: { id: true, chunkId: true },
        });
        for (const row of rows) {
          await tx.citation.update({
            where: { id: row.id },
            data: {
              sourceId: keep.id,
              chunkId: row.chunkId ? (chunkMap.get(row.chunkId) ?? null) : null,
            },
          });
        }

        const pins = await tx.chapterSourcePin.findMany({
          where: { sourceId: drop.id },
          select: { chapterId: true, section: true },
        });
        if (pins.length > 0) {
          await tx.chapterSourcePin.createMany({
            data: pins.map((p) => ({
              chapterId: p.chapterId,
              sourceId: keep.id,
              section: p.section,
            })),
            skipDuplicates: true,
          });
          pinsMoved = pins.length;
        }

        // The kept record joins every collection the removed one was in (2026-10-04).
        const memberships = await tx.sourceCollectionItem.findMany({
          where: { sourceId: drop.id },
          select: { collectionId: true },
        });
        if (memberships.length > 0) {
          await tx.sourceCollectionItem.createMany({
            data: memberships.map((m) => ({ collectionId: m.collectionId, sourceId: keep.id })),
            skipDuplicates: true,
          });
        }

        if (fileMoved) {
          await tx.source.update({ where: { id: drop.id }, data: { fileKey: null } });
          await tx.source.update({ where: { id: keep.id }, data: { fileKey: drop.fileKey } });
        }

        // Pins and chunks of the removed record go with it (cascade); its citations moved above.
        await tx.source.delete({ where: { id: drop.id } });
        // A much-cited paper is one update per citation row; Prisma's 5 s default is too tight.
      },
      { timeout: 30_000 },
    );

    if (fileMoved && drop.fileKey) {
      await this.queue.enqueue(
        'index-source',
        { sourceId: keep.id, documentId, userId: ownerId, contentKey: drop.fileKey },
        { jobId: jobId('index-source', keep.id, jobKeyDigest(drop.fileKey)) },
      );
    } else if (drop.fileKey) {
      await this.storage.remove(drop.fileKey).catch(() => undefined);
    }

    this.logger.log(
      { documentId, keptId: keep.id, removedId: drop.id, chapters: rewrites.length },
      'sources merged',
    );

    return {
      keptId: keep.id,
      removedId: drop.id,
      citationsMoved: rewrites.reduce((n, r) => n + r.changed, 0),
      passagesCleared: rewrites.reduce((n, r) => n + r.passagesCleared, 0),
      pinsMoved,
      chaptersChanged: rewrites.length,
      fileMoved,
    };
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
