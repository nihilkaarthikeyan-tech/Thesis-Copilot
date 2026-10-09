/**
 * "Import from Word" — a student's half-written thesis in a `.docx` becomes chapters (2026-10-04,
 * from the Jenni study: there a student uploads the file they already have and keeps writing).
 *
 * `POST /documents/:id/import-docx`. The file is converted (mammoth → HTML → the editor's JSON,
 * `docx-chapters.ts`), split at Heading 1, checked against the editor's own schema, and either
 * previewed or saved. No model is called, so it costs no allowance.
 *
 * ## Two modes, and the one rule
 *
 *   - `append` (the default): the chapters go after the existing ones. Nothing already written is
 *     touched.
 *   - `replace`: the file becomes the thesis. Only for a thesis whose every chapter is empty —
 *     refused otherwise. Text is never overwritten by an import. Each existing chapter is
 *     snapshotted (`PRE_IMPORT`) before it is reused or removed, so even an empty chapter's
 *     history keeps a version from before.
 *
 * ## The outline and the chapters stay one thing
 *
 * FR-3.4: `DocumentMemory.outline` and the `Chapter` rows are synced by `outlineNodeId`. Every
 * imported chapter gets its own outline node (its Heading 2s as the node's sections), written in
 * the same transaction as the rows, and chapter `order` follows the outline the way
 * `OutlineService.syncChapters` orders it: outline position first, chapters outside the outline
 * after. A thesis with no outline yet (a new one, before the proposal) has its existing chapters
 * adopted into the outline first, so appending does not leave "Chapter 1" stranded at the end.
 *
 * ## Provenance
 *
 * Imported text is the student's own. It carries no provenance mark, which `wordCountsOf` and the
 * editor both read as HUMAN — the same as text they type.
 */

import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PLANS, type Plan } from '@tc/config';
import type { Prisma } from '@tc/db';
import { docxToHtml } from '@tc/retrieval';
import { type OutlineNode, outlineSchema, readOutline, walkOutline } from '@tc/types';
import { thesisExtensions } from '@tc/ui';
import { getSchema } from '@tiptap/core';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import type { SessionUser } from '../auth/current-user.decorator.js';
import { checkUpload } from '../sources/upload-rules.js';
import {
  bodyWords,
  chapterDoc,
  chapterWords,
  type DocxChapters,
  htmlToChapters,
  type ImportedChapter,
  type ReferencesSection,
} from './docx-chapters.js';
import { SnapshotsService } from './snapshots.service.js';
import { stripUnsafeKeys, totalWords, wordCountsOf } from './word-counts.js';

export const IMPORT_MODES = ['append', 'replace'] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

/**
 * More Heading 1s than any thesis has chapters means Heading 1 was used for something else (every
 * paragraph, often). Refused with the count, rather than making a hundred chapters.
 */
export const MAX_IMPORTED_CHAPTERS = 40;

/** `D0 CF 11 E0`: an OLE compound file — a password-protected .docx, or an old .doc. */
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];

export type ImportSummary = {
  chapters: Array<{ title: string; words: number; sections: number; preamble: boolean }>;
  words: number;
  /** Pictures left out — the student inserts each as a figure. */
  images: number;
  footnotes: number;
  tables: number;
  /** Citations typed as text, left as text for the student to link; reference lists excluded. */
  citationLike: number;
  /** References sections found, so the dialog can say why nothing was linked (R34, ADR-0113). */
  references: ReferencesSection[];
  /** False when the file had no Heading 1 and came in as one chapter. */
  splitAtHeadings: boolean;
};

export type ImportPreview = ImportSummary & {
  existing: { chapters: number; withText: number };
  /** `replace` is offered only when no existing chapter has text. */
  canReplace: boolean;
};

export type ImportResult = ImportSummary & {
  mode: ImportMode;
  created: Array<{ id: string; title: string; words: number }>;
  /** Existing empty chapters that were reused or removed (replace mode). */
  replaced: number;
};

const planOf = (plan: string): Plan =>
  (PLANS as readonly string[]).includes(plan) ? (plan as Plan) : 'FREE_TRIAL';

@Injectable()
export class WordImportService {
  private readonly logger = new Logger(WordImportService.name);
  /** The editor's schema; every imported document is checked against it before it is saved. */
  private readonly schema = getSchema(
    thesisExtensions({
      ghostText: {
        chapterId: 'server',
        request: () => {
          throw new Error('Ghost text does not run on the server');
        },
      },
      resizableTables: false,
    }),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: SnapshotsService,
  ) {}

  async preview(
    user: SessionUser,
    documentId: string,
    filename: string,
    bytes: Uint8Array,
  ): Promise<ImportPreview> {
    await this.owned(user.id, documentId);
    const read = await this.read(user, filename, bytes);
    const existing = await this.existingChapters(documentId);
    const withText = existing.filter((c) => bodyWords(c.content) > 0).length;
    return {
      ...summary(read),
      existing: { chapters: existing.length, withText },
      canReplace: withText === 0,
    };
  }

  async import(
    user: SessionUser,
    documentId: string,
    filename: string,
    bytes: Uint8Array,
    mode: ImportMode,
  ): Promise<ImportResult> {
    await this.owned(user.id, documentId);
    const read = await this.read(user, filename, bytes);
    const existing = await this.existingChapters(documentId);

    if (mode === 'replace') {
      const withText = existing.filter((c) => bodyWords(c.content) > 0);
      if (withText.length > 0) {
        throw new ConflictError(
          `Replacing is only for an empty thesis, and ${withText.length} chapter${withText.length === 1 ? ' has' : 's have'} text (${withText.map((c) => `“${c.title}”`).join(', ')}). Add the imported chapters after them instead.`,
          { withText: withText.length },
        );
      }
    }

    const memory = await this.prisma.documentMemory.findUnique({
      where: { documentId },
      select: { outline: true },
    });
    const outline = readOutline(memory?.outline);
    const taken = new Set([
      ...walkOutline(outline).map((n) => n.id),
      ...existing.map((c) => c.outlineNodeId),
    ]);
    const freshId = () => {
      let id: string;
      do id = `imp-${randomUUID().slice(0, 8)}`;
      while (taken.has(id));
      taken.add(id);
      return id;
    };

    const created: ImportResult['created'] = [];
    let replaced = 0;

    if (mode === 'replace') {
      // Each existing chapter is kept as a version before it is reused or removed.
      for (const chapter of existing) {
        await this.snapshots.write({
          documentId,
          chapterId: chapter.id,
          content: chapter.content,
          reason: 'PRE_IMPORT',
        });
      }
      // The first chapters keep their rows and their outline ids, so nothing bound to them —
      // pins, versions, the History panel — loses its chapter.
      const plan = read.chapters.map((chapter, index) => ({
        chapter,
        reuse: existing[index],
        nodeId: existing[index]?.outlineNodeId ?? freshId(),
      }));
      const nodes = plan.map(({ chapter, nodeId }) => outlineNode(nodeId, chapter));
      const leftovers = existing.slice(plan.length);

      const rows = await this.prisma.$transaction(async (tx) => {
        const out: Array<{ id: string; title: string; words: number }> = [];
        // Checked again inside the transaction: a chapter typed into since the check above (in
        // another tab) must not be overwritten.
        const now = await tx.chapter.findMany({ where: { documentId }, select: { content: true } });
        if (now.length !== existing.length || now.some((c) => bodyWords(c.content) > 0)) {
          throw new ConflictError(
            'The thesis changed while the file was being imported. Reload and import it again.',
          );
        }
        // Leftover empty chapters go first, so their outline ids are free before anything is
        // written (the ids are unique per document).
        if (leftovers.length > 0) {
          await tx.chapter.deleteMany({ where: { id: { in: leftovers.map((c) => c.id) } } });
        }
        for (const [index, { chapter, reuse, nodeId }] of plan.entries()) {
          const data = this.chapterData(chapter);
          const row = reuse
            ? await tx.chapter.update({
                where: { id: reuse.id },
                data: { ...data, order: index + 1, version: { increment: 1 } },
                select: { id: true },
              })
            : await tx.chapter.create({
                data: { documentId, outlineNodeId: nodeId, ...data, order: index + 1 },
                select: { id: true },
              });
          out.push({ id: row.id, title: chapter.title, words: chapterWords(chapter) });
        }
        await tx.documentMemory.update({
          where: { documentId },
          data: { outline: validOutline(nodes) as never },
        });
        return out;
      });
      created.push(...rows);
      replaced = existing.length;
    } else {
      // A thesis with no outline yet adopts its chapters into one, in their order, so the
      // imported chapters really do come after them.
      const base: OutlineNode[] =
        outline.length > 0
          ? outline
          : existing.map((c) => ({
              id: c.outlineNodeId,
              title: c.title,
              scopeNote: c.scopeNote ?? '',
              children: [],
            }));
      const added = read.chapters.map((chapter) => ({ chapter, nodeId: freshId() }));
      const nodes = validOutline([
        ...base,
        ...added.map(({ chapter, nodeId }) => outlineNode(nodeId, chapter)),
      ]);
      const position = new Map(nodes.map((n, i) => [n.id, i + 1]));
      // `OutlineService.syncChapters`' order: outline position, then chapters outside it.
      const outside = existing.filter((c) => !position.has(c.outlineNodeId));

      const rows = await this.prisma.$transaction(async (tx) => {
        const out: Array<{ id: string; title: string; words: number }> = [];
        for (const chapter of existing) {
          const order =
            position.get(chapter.outlineNodeId) ?? nodes.length + outside.indexOf(chapter) + 1;
          if (order !== chapter.order) {
            await tx.chapter.update({ where: { id: chapter.id }, data: { order } });
          }
        }
        for (const { chapter, nodeId } of added) {
          const row = await tx.chapter.create({
            data: {
              documentId,
              outlineNodeId: nodeId,
              ...this.chapterData(chapter),
              order: position.get(nodeId) as number,
            },
            select: { id: true },
          });
          out.push({ id: row.id, title: chapter.title, words: chapterWords(chapter) });
        }
        await tx.documentMemory.update({
          where: { documentId },
          data: { outline: nodes as never },
        });
        return out;
      });
      created.push(...rows);
    }

    const result: ImportResult = { ...summary(read), mode, created, replaced };
    this.logger.log(
      {
        documentId,
        mode,
        chapters: created.length,
        words: result.words,
        images: result.images,
        references: result.references.length,
        replaced,
      },
      'imported a Word document',
    );
    return result;
  }

  private async owned(ownerId: string, documentId: string): Promise<void> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true },
    });
    // Someone else's thesis reads as absent, not forbidden (§12.1).
    if (!document) throw new NotFoundError('That document');
  }

  private existingChapters(documentId: string) {
    return this.prisma.chapter.findMany({
      where: { documentId },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        outlineNodeId: true,
        title: true,
        scopeNote: true,
        order: true,
        content: true,
      },
    });
  }

  /** The row fields for one imported chapter: its document, its counts, all HUMAN. */
  private chapterData(chapter: ImportedChapter) {
    const content = chapterDoc(chapter);
    const counts = wordCountsOf(content);
    return {
      title: chapter.title,
      scopeNote: '',
      content: content as Prisma.InputJsonValue,
      wordCount: totalWords(counts),
      wordCounts: counts,
    };
  }

  /** The file, checked and converted. Every refusal is worded for the student. */
  private async read(
    user: SessionUser,
    filename: string,
    bytes: Uint8Array,
  ): Promise<DocxChapters & { images: number }> {
    if (bytes.length >= 4 && OLE_MAGIC.every((b, i) => bytes[i] === b)) {
      throw new ValidationError(
        'That file is password-protected, or saved in the old .doc format. In Word, remove the password (File → Info → Protect Document) or use File → Save As → Word Document (.docx), then import it again.',
      );
    }
    if (!filename.toLowerCase().endsWith('.docx')) {
      throw new ValidationError(
        'Import takes a Word document saved as .docx. In Word, use File → Save As → Word Document (.docx).',
      );
    }
    // The same size and content checks as every other upload (PRD §11.3, §12.1).
    const check = checkUpload({ filename, bytes, plan: planOf(user.plan) });
    if (!check.ok) throw new ValidationError(check.detail);
    if (check.kind !== 'docx') {
      throw new ValidationError('That file is not a Word document.');
    }

    let converted: Awaited<ReturnType<typeof docxToHtml>>;
    try {
      converted = await docxToHtml(bytes);
    } catch (error) {
      this.logger.warn({ err: error }, 'Word import could not open the file');
      throw new ValidationError(
        'That file could not be opened as a Word document. Open it in Word, save it again as .docx, and try once more.',
      );
    }

    const fallback = filename.replace(/\.docx$/i, '').trim() || 'Imported chapter';
    const chapters = htmlToChapters(converted.html, fallback);
    if (chapters.chapters.length === 0 || chapters.chapters.every((c) => c.words === 0)) {
      throw new ValidationError('That Word document has no text in it to import.');
    }
    if (chapters.chapters.length > MAX_IMPORTED_CHAPTERS) {
      throw new ValidationError(
        `That file has ${chapters.chapters.length} Heading 1 paragraphs — more than a thesis has chapters (${MAX_IMPORTED_CHAPTERS}). Use Heading 1 only for chapter titles and Heading 2 for sections, then import it again.`,
      );
    }

    // The editor must be able to open every chapter. A document the schema refuses would load as
    // an error screen, so it is refused here instead, before anything is written.
    for (const chapter of chapters.chapters) {
      const doc = chapterDoc(chapter);
      stripUnsafeKeys(doc);
      try {
        this.schema.nodeFromJSON(doc).check();
      } catch (error) {
        this.logger.warn(
          { err: error, title: chapter.title },
          'Word import produced an invalid chapter',
        );
        throw new ValidationError(
          `The chapter “${chapter.title}” could not be converted. Copy its text into the editor by hand, or remove unusual content (text boxes, equations drawn as objects) and import again.`,
        );
      }
    }
    return { ...chapters, images: converted.images };
  }
}

function summary(read: DocxChapters & { images: number }): ImportSummary {
  return {
    chapters: read.chapters.map((c) => ({
      title: c.title,
      words: chapterWords(c),
      sections: c.sections.length,
      preamble: c.preamble,
    })),
    words: read.chapters.reduce((n, c) => n + chapterWords(c), 0),
    images: read.images,
    footnotes: read.footnotes,
    tables: read.tables,
    citationLike: read.citationLike,
    references: read.references,
    splitAtHeadings: read.splitAtHeadings,
  };
}

/** One imported chapter as an outline node: its Heading 2s are the node's sections. */
function outlineNode(id: string, chapter: ImportedChapter): OutlineNode {
  return {
    id,
    title: chapter.title,
    scopeNote: '',
    children: chapter.sections.map((title, i) => ({
      id: `${id}-s${i + 1}`,
      title,
      scopeNote: '',
      children: [],
    })),
  };
}

/** The outline as `OutlineService.save` would accept it — the same schema, the same id rule. */
function validOutline(nodes: OutlineNode[]): OutlineNode[] {
  const parsed = outlineSchema.parse(nodes);
  const ids = walkOutline(parsed).map((n) => n.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Word import built an outline with a repeated id');
  }
  return parsed;
}
