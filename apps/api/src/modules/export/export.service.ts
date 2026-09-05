/**
 * Export — PRD §9.4, FR-8.1, FR-8.6, PHASES 4.7 and 4.8.
 *
 * Both exports read the document itself rather than any summary of it: the chapter's ProseMirror
 * JSON for the `.docx`, and the per-provenance word counts the editor writes on save (B.4) for the
 * usage log. §12 promises a student can "disclose exactly what the AI did", and that promise is
 * only worth anything if the numbers come from the same place the words do.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Env } from '@tc/config';
import {
  type ChapterUsage,
  chapterToDocx,
  PROVENANCE_KINDS,
  type ProvenanceKind,
  type UsageReport,
  usageToCsv,
  usageToDocx,
  type WordCounts,
} from '@tc/export';
import { ENV } from '../../common/env.token.js';
import { NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { StorageService } from '../../common/storage.service.js';

export type ExportFormat = 'docx' | 'pdf';

export type ExportResult = { url: string; key: string; filename: string; bytes: number };

@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** FR-8.1. `pdf` converts the same `.docx` through Gotenberg, which is LibreOffice headless. */
  async chapter(ownerId: string, chapterId: string, format: ExportFormat): Promise<ExportResult> {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, document: { ownerId } },
      select: {
        id: true,
        title: true,
        content: true,
        documentId: true,
        citations: {
          select: {
            nodeKey: true,
            source: { select: { title: true, year: true, authors: true, venue: true } },
          },
        },
      },
    });
    if (!chapter) throw new NotFoundError('That chapter');

    // Until citeproc lands (Phase 2), the label and the bibliography line are built from the
    // stored CSL fields. They say what is actually known and invent nothing.
    const renderedMap: Record<string, string> = {};
    const bibliography: string[] = [];
    for (const citation of chapter.citations) {
      const source = citation.source;
      const name = firstAuthor(source.authors);
      renderedMap[citation.nodeKey] =
        `(${[name, source.year].filter(Boolean).join(', ') || 'Source'})`;
      const line = [
        name ? `${name}${source.year ? ` (${source.year})` : ''}.` : null,
        source.title ? `${source.title}.` : null,
        source.venue ? `${source.venue}.` : null,
      ]
        .filter(Boolean)
        .join(' ');
      if (line && !bibliography.includes(line)) bibliography.push(line);
    }
    bibliography.sort((a, b) => a.localeCompare(b, 'en'));

    const docx = await chapterToDocx(chapter.content, {
      title: chapter.title,
      renderedMap,
      bibliography,
    });

    const safeTitle = slug(chapter.title);
    if (format === 'docx') {
      return this.store(chapter.documentId, `${safeTitle}.docx`, docx);
    }

    const pdf = await this.toPdf(docx, `${safeTitle}.docx`);
    return this.store(chapter.documentId, `${safeTitle}.pdf`, pdf);
  }

  /** FR-8.6. */
  async aiUsage(
    ownerId: string,
    documentId: string,
    format: 'docx' | 'csv',
  ): Promise<ExportResult> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: {
        id: true,
        title: true,
        chapters: {
          orderBy: { order: 'asc' },
          select: { id: true, title: true, wordCounts: true },
        },
      },
    });
    if (!document) throw new NotFoundError('That document');

    const events = await this.prisma.suggestionEvent.groupBy({
      by: ['chapterId'],
      where: { documentId, userId: ownerId },
      _count: { _all: true },
    });
    const actionsByChapter = new Map(events.map((row) => [row.chapterId, row._count._all]));

    const range = await this.prisma.suggestionEvent.aggregate({
      where: { documentId, userId: ownerId },
      _min: { createdAt: true },
      _max: { createdAt: true },
    });

    const chapters: ChapterUsage[] = document.chapters.map((chapter) => ({
      title: chapter.title,
      wordCounts: readWordCounts(chapter.wordCounts),
      actions: actionsByChapter.get(chapter.id) ?? 0,
    }));

    const report: UsageReport = {
      documentTitle: document.title,
      chapters,
      from: range._min.createdAt ?? null,
      to: range._max.createdAt ?? null,
    };

    const safeTitle = slug(document.title);
    if (format === 'csv') {
      return this.store(
        documentId,
        `${safeTitle}-ai-usage.csv`,
        Buffer.from(usageToCsv(report), 'utf8'),
      );
    }
    return this.store(documentId, `${safeTitle}-ai-usage.docx`, await usageToDocx(report));
  }

  /** PRD §7.2: `docx` → Gotenberg for PDF. */
  private async toPdf(docx: Buffer, filename: string): Promise<Buffer> {
    const form = new FormData();
    form.append('files', new Blob([new Uint8Array(docx)]), filename);

    const response = await fetch(`${this.env.GOTENBERG_URL}/forms/libreoffice/convert`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) {
      throw new Error(`Gotenberg refused the conversion (HTTP ${response.status})`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private async store(documentId: string, filename: string, body: Buffer): Promise<ExportResult> {
    // Timestamped, so a second export never overwrites the file the student is still downloading.
    const key = `exports/${documentId}/${Date.now()}-${filename}`;
    await this.storage.put(key, body, { 'content-type': contentType(filename) });
    return { url: await this.storage.signedUrl(key), key, filename, bytes: body.length };
  }
}

function contentType(filename: string): string {
  if (filename.endsWith('.pdf')) return 'application/pdf';
  if (filename.endsWith('.csv')) return 'text/csv; charset=utf-8';
  return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'chapter'
  );
}

function firstAuthor(authors: unknown): string | null {
  if (!Array.isArray(authors) || authors.length === 0) return null;
  const first = authors[0] as { family?: string; literal?: string };
  return first?.family?.trim() || first?.literal?.trim() || null;
}

/** `Chapter.wordCounts` is JSON written on save (B.4); anything unexpected reads as zero. */
function readWordCounts(value: unknown): WordCounts {
  if (!value || typeof value !== 'object') return {};
  const source = value as Record<string, unknown>;
  const out: WordCounts = {};
  for (const kind of PROVENANCE_KINDS) {
    const count = source[kind];
    if (typeof count === 'number' && Number.isFinite(count)) out[kind as ProvenanceKind] = count;
  }
  return out;
}
