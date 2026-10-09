/**
 * Add a paper by its identifier (Jenni build plan R16, ADR-0103): a DOI, an arXiv id, a PubMed
 * id or an ISBN, looked up for a preview ("Metadata found"), then imported.
 *
 * A paper with a DOI goes in the way every pasted reference does — `resolveReferences` with the
 * DOI, so the worker resolves it, finds its abstract and an open copy, and indexes it. A book by
 * ISBN, or a PubMed record without a DOI, has nothing for that pipeline to resolve by, so it is
 * created from the record just read (and its abstract, if any, indexed). The import reads the
 * record again rather than trusting what the page sends. Free: lookups call no model.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Env } from '@tc/config';
import { addSourcesOnce, type Prisma } from '@tc/db';
import {
  arxivDoi,
  CrossrefClient,
  type CslAuthor,
  detectPaperId,
  OpenLibraryClient,
  type PaperId,
  personName,
} from '@tc/retrieval';
import { jobId } from '@tc/types';
import { ENV } from '../../common/env.token.js';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { QueueService } from '../../common/queue.service.js';
import { ScholarlyIndexes } from '../../common/scholarly-indexes.service.js';
import { SourcesService } from './sources.service.js';

/** A lookup's time limit: the student is watching the box. */
const LOOKUP_TIMEOUT_MS = 15_000;

export type PaperPreview = {
  kind: PaperId['kind'];
  id: string;
  title: string;
  authors: CslAuthor[];
  year: number | null;
  /** The journal, "arXiv", or a book's publisher. */
  venue: string | null;
  doi: string | null;
  abstract: string | null;
  type: 'article-journal' | 'article' | 'book';
  /**
   * ADR-0125: Crossref's `is-referenced-by-count`, from the record the DOI lookup already reads;
   * null when the lookup was not by DOI or Crossref sent none — never defaulted to 0.
   */
  citedBy: number | null;
  /**
   * ADR-0125: where the record itself says it is free to read — every arXiv e-print, and a PubMed
   * record with a PubMed Central copy. Null means "not stated", not "closed".
   */
  openAccessVia: 'arXiv' | 'PubMed Central' | null;
};

/** Crossref's citation count, when it is a count. */
export function crossrefCitedBy(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

const names = (list: readonly string[]): CslAuthor[] =>
  list
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => personName(n));

/**
 * PubMed writes a name as "Surname Initials" ("Bitencourt-Ferreira G", "de Azevedo WF"); a group
 * as its name. Read that way, not as a display name, or the initials became the surname.
 */
export function pubmedName(name: string): CslAuthor {
  const match = /^(.+?)\s+([A-Z]{1,4})$/.exec(name.trim());
  return match
    ? { family: match[1] as string, given: match[2] as string }
    : { literal: name.trim() };
}

/** "Kumar & Rao (2021). Title. Journal." — the library's raw line for an imported paper. */
function rawLine(p: PaperPreview): string {
  const family = (a: CslAuthor) => a.family ?? a.literal ?? '';
  const who =
    p.authors.length === 0
      ? ''
      : p.authors.length === 1
        ? family(p.authors[0] as CslAuthor)
        : p.authors.length === 2
          ? `${family(p.authors[0] as CslAuthor)} & ${family(p.authors[1] as CslAuthor)}`
          : `${family(p.authors[0] as CslAuthor)} et al.`;
  return [who ? `${who} (${p.year ?? 'n.d.'}).` : '', `${p.title}.`, p.venue ? `${p.venue}.` : '']
    .filter(Boolean)
    .join(' ');
}

@Injectable()
export class PaperIdService {
  private readonly crossref: CrossrefClient;
  private readonly books: OpenLibraryClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: SourcesService,
    private readonly indexes: ScholarlyIndexes,
    private readonly queue: QueueService,
    @Inject(ENV) env: Env,
  ) {
    this.crossref = new CrossrefClient({ mailto: env.CROSSREF_MAILTO, attempts: 2 });
    this.books = new OpenLibraryClient({ mailto: env.CROSSREF_MAILTO, attempts: 2 });
  }

  /** What an identifier names, or a plain refusal when it names nothing. */
  async lookup(input: string): Promise<PaperPreview> {
    const found = detectPaperId(input);
    if (!found) {
      throw new ValidationError(
        'That is not a DOI, an arXiv id, a PubMed id or an ISBN. Examples: 10.1016/j.enpol.2021.112345 · arXiv:2410.08098 · PMID 31452104 · 978-0-262-03384-8',
      );
    }
    const signal = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
    const preview = await this.read(found, signal).catch(() => null);
    if (!preview) {
      throw new NotFoundError(
        found.kind === 'doi'
          ? 'No paper with that DOI'
          : found.kind === 'arxiv'
            ? 'No arXiv paper with that id'
            : found.kind === 'pmid'
              ? 'No PubMed record with that id'
              : 'No book with that ISBN in Open Library',
      );
    }
    return preview;
  }

  private async read(found: PaperId, signal: AbortSignal): Promise<PaperPreview | null> {
    switch (found.kind) {
      case 'doi': {
        const item = await this.crossref.byDoi(found.id, signal);
        const title = item?.title?.[0]?.trim();
        if (!item || !title) return null;
        return {
          kind: 'doi',
          id: found.id,
          title,
          authors: (item.author ?? [])
            .map((a) =>
              a.family || a.given
                ? { family: a.family ?? '', given: a.given ?? '' }
                : { literal: a.name ?? '' },
            )
            .filter((a) => (a.family ?? a.literal ?? '').trim().length > 0),
          year: item.issued?.['date-parts']?.[0]?.[0] ?? null,
          venue: item['container-title']?.[0] ?? null,
          doi: item.DOI ?? found.id,
          abstract: null,
          type: item.type === 'book' || item.type === 'monograph' ? 'book' : 'article-journal',
          citedBy: crossrefCitedBy(item['is-referenced-by-count']),
          openAccessVia: null,
        };
      }
      case 'arxiv': {
        const entry = await this.indexes.arxiv.byId(found.id, signal);
        if (!entry || entry.withdrawn) return null;
        return {
          kind: 'arxiv',
          id: found.id,
          title: entry.title,
          authors: names(entry.authors),
          year: entry.year,
          venue: 'arXiv',
          doi: entry.doi ?? arxivDoi(entry.id),
          abstract: entry.abstract,
          type: 'article',
          citedBy: null,
          openAccessVia: 'arXiv',
        };
      }
      case 'pmid': {
        const record = await this.indexes.pubmed.byPmid(found.id, signal);
        if (!record) return null;
        return {
          kind: 'pmid',
          id: found.id,
          title: record.title,
          authors: record.authors.filter((n) => n.trim()).map(pubmedName),
          year: record.year,
          venue: record.journal,
          doi: record.doi,
          abstract: record.abstract,
          type: 'article-journal',
          citedBy: null,
          openAccessVia: record.pmcid ? 'PubMed Central' : null,
        };
      }
      case 'isbn': {
        const book = await this.books.byIsbn(found.id, signal);
        if (!book) return null;
        return {
          kind: 'isbn',
          id: found.id,
          title: book.title,
          authors: book.authors,
          year: book.year,
          venue: book.publisher,
          doi: null,
          abstract: null,
          type: 'book',
          citedBy: null,
          openAccessVia: null,
        };
      }
    }
  }

  /** The library row the identifier is now: imported, or the one already there. */
  async import(
    ownerId: string,
    documentId: string,
    input: string,
  ): Promise<{ sourceId: string; alreadyPresent: boolean; preview: PaperPreview }> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true },
    });
    if (!document) throw new NotFoundError('That document');
    const preview = await this.lookup(input);

    if (preview.doi) {
      const existing = await this.prisma.source.findFirst({
        where: { documentId, doi: { equals: preview.doi, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existing) return { sourceId: existing.id, alreadyPresent: true, preview };
      const queued = await this.sources.resolveReferences(ownerId, documentId, [
        { raw: rawLine(preview), doi: preview.doi },
      ]);
      const sourceId = queued.sourceIds[0];
      if (!sourceId) throw new ValidationError('The paper could not be added.');
      return { sourceId, alreadyPresent: queued.alreadyPresent > 0, preview };
    }

    // No DOI to resolve by: a book, or a PubMed record without one.
    const raw = rawLine(preview);
    const existing = await this.prisma.source.findFirst({
      where: { documentId, rawReference: raw },
      select: { id: true },
    });
    if (existing) return { sourceId: existing.id, alreadyPresent: true, preview };
    const csl: Record<string, unknown> = {
      type: preview.type,
      title: preview.title,
      ...(preview.authors.length > 0 ? { author: preview.authors } : {}),
      ...(preview.year ? { issued: { 'date-parts': [[preview.year]] } } : {}),
      ...(preview.type === 'book'
        ? preview.venue
          ? { publisher: preview.venue }
          : {}
        : preview.venue
          ? { 'container-title': preview.venue }
          : {}),
      ...(preview.kind === 'isbn' ? { ISBN: preview.id } : {}),
      ...(preview.kind === 'pmid' ? { PMID: preview.id } : {}),
      ...(preview.abstract ? { abstract: preview.abstract } : {}),
    };
    // ADR-0139: the check above is repeated under the thesis's lock, so two presses at once add
    // the record once.
    const [row] = await addSourcesOnce(
      this.prisma,
      documentId,
      [{ rawReference: raw, title: preview.title }],
      (tx) =>
        tx.source.create({
          data: {
            documentId,
            status: 'RESOLVED',
            rawReference: raw,
            title: preview.title,
            authors: preview.authors as unknown as Prisma.InputJsonValue,
            year: preview.year,
            venue: preview.venue,
            type: preview.type,
            cslJson: csl as Prisma.InputJsonValue,
            groundingLevel: 'NONE',
          },
          select: { id: true },
        }),
    );
    if (!row) throw new ValidationError('The paper could not be added.');
    if (!row.created) return { sourceId: row.id, alreadyPresent: true, preview };
    const created = { id: row.id };
    // An abstract (PubMed) is made citable as any paper's is.
    if (preview.abstract) {
      await this.queue.enqueue(
        'index-source',
        { sourceId: created.id, documentId, userId: ownerId },
        { jobId: jobId('index-source', created.id) },
      );
    }
    return { sourceId: created.id, alreadyPresent: false, preview };
  }
}
