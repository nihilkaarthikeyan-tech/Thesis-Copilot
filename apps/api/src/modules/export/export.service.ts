/**
 * Export — PRD §9.4, FR-8.1, FR-8.6, PHASES 4.7 and 4.8.
 *
 * Both exports read the document itself rather than any summary of it: the chapter's ProseMirror
 * JSON for the `.docx`, and the per-provenance word counts the editor writes on save (B.4) for the
 * usage log. §12 promises a student can "disclose exactly what the AI did", and that promise is
 * only worth anything if the numbers come from the same place the words do.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
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
import {
  type CitationMode,
  type ExportLayout,
  FONT_STYLE_DOCX,
  numberingMap,
  type ResolvedLayout,
  readFontStyle,
} from '@tc/types';
import { ENV } from '../../common/env.token.js';
import { NotFoundError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { StorageService } from '../../common/storage.service.js';
import { CitationsService } from '../chapters/citations.service.js';
import { citationModeFor } from './citation-mode.js';
import { loadFigures } from './figure-bytes.js';
import { ThesisExportService } from './thesis-export.service.js';

export type ExportFormat = 'docx' | 'pdf';

export type ExportResult = { url: string; key: string; filename: string; bytes: number };

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly citations: CitationsService,
    private readonly thesis: ThesisExportService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** FR-8.1. `pdf` converts the same `.docx` through Gotenberg, which is LibreOffice headless. */
  async chapter(
    ownerId: string,
    chapterId: string,
    format: ExportFormat,
    citations?: CitationMode,
    layoutChoice?: ExportLayout,
  ): Promise<ExportResult & { layout?: ResolvedLayout }> {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, document: { ownerId } },
      select: {
        id: true,
        title: true,
        content: true,
        documentId: true,
        order: true,
        citations: {
          select: {
            sourceId: true,
            nodeKey: true,
          },
        },
      },
    });
    if (!chapter) throw new NotFoundError('That chapter');

    // FR-5.2/FR-8.1: the same renderer the editor uses, on the whole document — so the labels in
    // the exported chapter are the labels on screen, and a numeric style's numbers match the
    // bibliography's order. Only the sources this chapter cites are printed.
    const rendered = await this.citations.render(ownerId, chapter.documentId, {
      excludePendingDrafts: true,
    });
    const citedHere = new Set(chapter.citations.map((c) => c.nodeKey));
    const sourcesHere = new Set(chapter.citations.map((c) => c.sourceId));
    const renderedMap = Object.fromEntries(
      Object.entries(rendered.labels).filter(([key]) => citedHere.has(key)),
    );
    const entries = rendered.bibliography.filter((entry) => sourcesHere.has(entry.sourceId));
    const bibliography = entries.map((entry) => entry.text);
    // ADR-0055: linked citations or Word fields in the .docx download; the PDF is always plain.
    const mode = citationModeFor(format, citations);
    // R33 (ADR-0120): the chapter is the student's working copy, in their own font style.
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { settings: true },
    });
    const font =
      FONT_STYLE_DOCX[
        readFontStyle((owner?.settings as { fontStyle?: unknown } | null)?.fontStyle)
      ];

    // R27 (ADR-0121): the export dialog's layout, over this thesis's template.
    const layout = layoutChoice
      ? await this.thesis.chapterLayout(ownerId, chapter.documentId, layoutChoice, chapter.content)
      : null;
    const comments = layout?.comments
      ? await this.thesis.openComments(chapter.documentId, chapter.id)
      : [];

    const docx = await chapterToDocx(chapter.content, {
      title: chapter.title,
      ...(font ? { font } : {}),
      ...(layout
        ? {
            page: {
              size: layout.paper,
              marginsMm: layout.marginsMm,
              font: layout.font,
              sizePt: layout.sizePt,
              lineSpacing: layout.lineSpacing,
              paragraphSpacingPt: layout.paragraphSpacingPt,
              justify: layout.justify,
              columns: layout.columns,
              pageNumbers: layout.pageNumbers,
            },
          }
        : {}),
      ...(comments.length > 0 ? { comments: { chapterId: chapter.id, list: comments } } : {}),
      renderedMap,
      // R40 (ADR-0117): citations side by side print once, as the one citation citeproc made.
      citationClusters: rendered.clusters,
      bibliography,
      // Without this every figure the student inserted exports as the placeholder '[image]'.
      images: await loadFigures(this.storage, chapter.content, chapter.documentId, this.logger),
      // Cross-reference numbers, from the same walk the editor uses.
      refTargets: numberingMap(chapter.content),
      numberHeadings: true,
      chapterNumber: chapter.order,
      noteStyle: rendered.noteStyle,
      citationLinks: {
        mode,
        entrySources: entries.map((entry) => entry.sourceId),
        sources:
          mode === 'word'
            ? await this.prisma.source.findMany({
                where: {
                  documentId: chapter.documentId,
                  id: { in: entries.map((entry) => entry.sourceId) },
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
              })
            : [],
      },
    });

    const safeTitle = slug(chapter.title);
    const withLayout = layout ? { layout } : {};
    if (format === 'docx') {
      return {
        ...(await this.store(chapter.documentId, `${safeTitle}.docx`, docx)),
        ...withLayout,
      };
    }

    const pdf = await this.toPdf(docx, `${safeTitle}.docx`);
    return { ...(await this.store(chapter.documentId, `${safeTitle}.pdf`, pdf)), ...withLayout };
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
    // R28 (ADR-0119): a contents block is a TOC field; LibreOffice fills in its page numbers
    // during the conversion, as for the thesis (`ThesisExportService.toPdf`).
    form.append('updateIndexes', 'true');

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
