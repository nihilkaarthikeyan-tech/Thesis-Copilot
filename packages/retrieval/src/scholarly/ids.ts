/**
 * Add a paper by its identifier (Jenni build plan R16, ADR-0103): what kind of identifier a
 * student pasted, and the one lookup this needs that no other client does — a book by its ISBN
 * (Open Library). DOIs go to Crossref, arXiv ids to arXiv and PubMed ids to PubMed, through the
 * clients that already exist.
 */

import { type ScholarlyClientOptions, ScholarlyHttp } from './http.js';
import { personName } from './names.js';
import type { CslAuthor } from './resolve.js';

export type PaperId =
  | { kind: 'doi'; id: string }
  | { kind: 'arxiv'; id: string }
  | { kind: 'pmid'; id: string }
  | { kind: 'isbn'; id: string };

/** An ISBN-10 or ISBN-13 whose check digit is right, without hyphens or spaces. */
export function validIsbn(raw: string): string | null {
  const isbn = raw.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const sum = isbn
      .split('')
      .reduce((acc, ch, i) => acc + (ch === 'X' ? 10 : Number(ch)) * (10 - i), 0);
    return sum % 11 === 0 ? isbn : null;
  }
  if (/^97[89]\d{10}$/.test(isbn)) {
    const sum = isbn.split('').reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 1 : 3), 0);
    return sum % 10 === 0 ? isbn : null;
  }
  return null;
}

/**
 * The identifier a student pasted, or null. Accepts the forms people copy: `10.1000/x`,
 * `doi:10.1000/x`, `https://doi.org/10.1000/x`, `arXiv:2410.08098v2`, an arxiv.org link,
 * `PMID: 12345678`, a pubmed link, and an ISBN with or without hyphens.
 */
export function detectPaperId(input: string): PaperId | null {
  const text = input.trim();
  if (!text) return null;
  const doi = /(?:doi\.org\/|doi:\s*)?(10\.\d{4,9}\/[^\s"<>]+)/i.exec(text)?.[1];
  if (doi) {
    // A DOI arXiv registers is an arXiv paper.
    const arxivFromDoi = /^10\.48550\/arxiv\.(.+)$/i.exec(doi)?.[1];
    if (arxivFromDoi) return { kind: 'arxiv', id: arxivFromDoi };
    return { kind: 'doi', id: doi.replace(/[.,;)]+$/, '') };
  }
  const arxiv =
    /arxiv\.org\/(?:abs|pdf)\/([^\s?#]+?)(?:v\d+)?(?:\.pdf)?(?:[?#].*)?$/i.exec(text)?.[1] ??
    /^(?:arxiv:\s*)?(\d{4}\.\d{4,5})(?:v\d+)?$/i.exec(text)?.[1] ??
    /^(?:arxiv:\s*)?([a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?$/i.exec(text)?.[1];
  if (arxiv) return { kind: 'arxiv', id: arxiv };
  const pmid =
    /pubmed\.ncbi\.nlm\.nih\.gov\/(\d{1,9})/i.exec(text)?.[1] ??
    /^(?:pmid:?\s*)?(\d{1,9})$/i.exec(text)?.[1];
  // A bare number of 10 or 13 digits is more likely an ISBN; PubMed ids are at most 9 digits.
  if (pmid) return { kind: 'pmid', id: pmid };
  const isbn = validIsbn(text.replace(/^isbn(?:-1[03])?:?\s*/i, ''));
  if (isbn) return { kind: 'isbn', id: isbn };
  return null;
}

export type BookRecord = {
  title: string;
  authors: CslAuthor[];
  publisher: string | null;
  year: number | null;
  isbn: string;
};

type OpenLibraryBook = {
  title?: string;
  subtitle?: string;
  authors?: Array<{ name?: string }>;
  publishers?: Array<{ name?: string }>;
  publish_date?: string;
};

/**
 * Open Library's books API (`/api/books?bibkeys=ISBN:…&jscmd=data`), fields checked against a real
 * answer on 2026-10-07: `title`, `subtitle`, `authors[].name`, `publishers[].name`, `publish_date`
 * (free text, "2009" or "July 31, 2009").
 */
export class OpenLibraryClient {
  private readonly http: ScholarlyHttp;

  constructor(options: ScholarlyClientOptions) {
    this.http = new ScholarlyHttp('openlibrary', options);
  }

  async byIsbn(isbn: string, signal?: AbortSignal): Promise<BookRecord | null> {
    const key = `ISBN:${isbn}`;
    const found = await this.http.getJson<Record<string, OpenLibraryBook>>(
      `https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(key)}&format=json&jscmd=data`,
      signal,
    );
    const book = found?.[key];
    if (!book?.title) return null;
    const title = book.subtitle ? `${book.title}: ${book.subtitle}` : book.title;
    const year = Number(/\b(1[5-9]\d{2}|20\d{2})\b/.exec(book.publish_date ?? '')?.[1]);
    return {
      title,
      authors: (book.authors ?? [])
        .map((a) => a.name?.trim())
        .filter((name): name is string => Boolean(name))
        .map((name) => personName(name)),
      publisher: book.publishers?.[0]?.name?.trim() || null,
      year: Number.isFinite(year) ? year : null,
      isbn,
    };
  }
}
