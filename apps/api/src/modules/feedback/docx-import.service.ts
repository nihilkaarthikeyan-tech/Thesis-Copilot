/**
 * `.docx` comment import — PRD FR-7.3, PHASES v2 B4.2.
 *
 *   "Parse `word/comments.xml` + anchors → `Comment` rows via re-anchoring."
 *
 * The path a guide who will not use the web app actually takes: the student exports the thesis,
 * the guide marks it up in Word, the student uploads the file back. Every comment lands in the
 * same review queue as a web comment, with the same classification and the same state machine.
 *
 * ## Which chapter a comment belongs to
 *
 * The `.docx` is one file; the thesis is many chapters. A comment's quoted text is searched for in
 * every chapter with D.2.2's three attempts, and the best match wins. A comment whose quote is
 * nowhere — the guide commented on the title page, or the student edited that paragraph away since
 * exporting — is kept at document level and shown as unanchored. It is not dropped: a remark a
 * guide took the trouble to write is not ours to discard because we could not place it.
 *
 * ## Importing the same file twice
 *
 * Guides send revised files. Re-importing must not double every comment, so a comment is matched
 * on Word's own `w:id` plus the author and body, recorded in `anchorKey` as `docx:<author>:<id>`.
 * A comment already imported is counted as a duplicate and left exactly as it is — including any
 * work the student has since done on it.
 */

import { Injectable, Logger } from '@nestjs/common';
import { COMMENT, findAnchor } from '@tc/ai';
import { type ChapterSentence, readDocxComments, sentencesOf } from '@tc/retrieval';
import { ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import type { SessionUser } from '../auth/current-user.decorator.js';
import { CommentsService } from './comments.service.js';

/** Word files are small; a thesis with comments is a few megabytes at most. */
const MAX_BYTES = 25 * 1024 * 1024;

export type DocxImportResult = {
  imported: number;
  duplicates: number;
  /** Comments whose quoted text was not found in any chapter — kept, shown unanchored. */
  unanchored: number;
  /** Insertions and deletions in the file. Reported so the student knows they were left alone. */
  trackedChanges: number;
  comments: Array<{
    id: string;
    author: string;
    body: string;
    chapterTitle: string | null;
    anchored: boolean;
  }>;
};

/** `docx:<author>:<w:id>` — stable across re-imports of the same guide's file. */
function importKey(author: string, wordId: string): string {
  return `docx:${author.toLowerCase().replace(/\s+/g, '-')}:${wordId}`;
}

@Injectable()
export class DocxImportService {
  private readonly logger = new Logger(DocxImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly comments: CommentsService,
  ) {}

  async import(
    user: SessionUser,
    documentId: string,
    filename: string,
    bytes: Buffer,
  ): Promise<DocxImportResult> {
    if (!filename.toLowerCase().endsWith('.docx')) {
      throw new ValidationError(
        'That is not a Word file. Ask your guide for the .docx — a .doc or a PDF cannot carry comments we can read.',
      );
    }
    if (bytes.length > MAX_BYTES) {
      throw new ValidationError(`That file is larger than ${MAX_BYTES / 1024 / 1024} MB.`);
    }

    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId: user.id },
      select: { id: true },
    });
    if (!document) throw new ValidationError('That document is not yours.');

    let parsed: Awaited<ReturnType<typeof readDocxComments>>;
    try {
      parsed = await readDocxComments(bytes);
    } catch (error) {
      this.logger.warn({ err: error, documentId }, 'docx comment import failed to parse');
      throw new ValidationError(
        'That file could not be opened as a Word document. Re-save it from Word as .docx and try again.',
      );
    }

    if (parsed.comments.length === 0) {
      throw new ValidationError(
        parsed.trackedChanges > 0
          ? `That file has ${parsed.trackedChanges} tracked change${parsed.trackedChanges === 1 ? '' : 's'} but no comments. Tracked changes are edits rather than remarks, so they are not imported — accept or reject them in Word.`
          : 'That file has no comments in it.',
      );
    }

    const chapters = await this.prisma.chapter.findMany({
      where: { documentId },
      orderBy: { order: 'asc' },
      select: { id: true, title: true, content: true },
    });
    const sentences = new Map<string, ChapterSentence[]>(
      chapters.map((chapter) => [chapter.id, sentencesOf(chapter.id, chapter.content)]),
    );
    const titles = new Map(chapters.map((chapter) => [chapter.id, chapter.title]));

    const existing = await this.prisma.comment.findMany({
      where: { documentId, anchorKey: { startsWith: 'docx:' } },
      select: { anchorKey: true },
    });
    const seen = new Set(existing.map((row) => row.anchorKey));

    const result: DocxImportResult = {
      imported: 0,
      duplicates: 0,
      unanchored: 0,
      trackedChanges: parsed.trackedChanges,
      comments: [],
    };

    for (const comment of parsed.comments) {
      const key = importKey(comment.author, comment.wordId);
      if (seen.has(key)) {
        result.duplicates++;
        continue;
      }
      seen.add(key);

      const placed = comment.quotedText ? this.bestChapter(comment.quotedText, sentences) : null;
      const chapterTitle = placed ? (titles.get(placed.chapterId) ?? null) : null;
      if (comment.quotedText && !placed) result.unanchored++;

      const row = await this.prisma.comment.create({
        data: {
          documentId,
          chapterId: placed?.chapterId ?? null,
          // The guide's own name from the file, not the uploading student's address: the review
          // queue and the response-to-committee table both print who said it.
          authorEmail: comment.author,
          body: comment.body,
          quotedText: comment.quotedText,
          anchorKey: key,
          ...(comment.date ? { createdAt: new Date(comment.date) } : {}),
        },
        select: { id: true },
      });
      result.imported++;
      result.comments.push({
        id: row.id,
        author: comment.author,
        body: comment.body,
        chapterTitle,
        anchored: Boolean(placed),
      });

      // A.13, exactly as a web comment: substantive comments must never get a one-click apply,
      // and that decision is the classifier's (D.2.3). Failures are logged, not fatal — an
      // unclassified comment still belongs in the queue.
      void this.comments
        .classify(user, documentId, row.id)
        .catch((error: unknown) =>
          this.logger.warn({ err: error, commentId: row.id }, 'classification failed'),
        );
    }

    this.logger.log(
      { documentId, ...result, comments: undefined },
      'imported comments from a .docx',
    );
    return result;
  }

  /**
   * D.2.2's three attempts, run against every chapter; the highest-scoring match wins. Searching
   * all of them rather than guessing from order matters because a guide's file is the exported
   * thesis, which has front matter and appendices the chapters do not.
   */
  private bestChapter(
    quotedText: string,
    sentences: ReadonlyMap<string, ChapterSentence[]>,
  ): { chapterId: string; score: number } | null {
    let best: { chapterId: string; score: number } | null = null;
    for (const [chapterId, list] of sentences) {
      if (list.length === 0) continue;
      const match = findAnchor(quotedText, list, COMMENT.reanchorSimilarity);
      if (match && (!best || match.score > best.score)) best = { chapterId, score: match.score };
    }
    return best;
  }
}
