/**
 * Chapters — PRD §9.1 (`GET/PUT /chapters/:id`, snapshot, versions) and Appendix B.7.
 *
 * Every query is scoped by the document owner (PRD §12.1). The save is an optimistic-concurrency
 * update: it only applies when `version` still equals the client's `baseVersion`; otherwise the
 * caller gets a 409 and the client stops autosaving (B.7).
 */

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@tc/db';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors.js';
import { withFreshFigureLinks } from '../../common/figure-links.js';
import { PrismaService } from '../../common/prisma.service.js';
import { StorageService } from '../../common/storage.service.js';
import { StyleService } from '../memory/style.service.js';
import { citationsIn } from './citations.js';
import { type SnapshotReason, SnapshotsService } from './snapshots.service.js';
import { looksLikeDoc, stripUnsafeKeys, totalWords, wordCountsOf } from './word-counts.js';

export type ChapterView = {
  id: string;
  documentId: string;
  outlineNodeId: string;
  title: string;
  order: number;
  content: unknown;
  version: number;
  wordCount: number;
  wordCounts: unknown;
  scopeNote: string | null;
  snapshotAt: string | null;
  updatedAt: string;
};

/** A row in the History panel. */
export type VersionSummary = {
  id: string;
  reason: string;
  /** Null for versions written before the length was recorded (migration 0015). */
  wordCount: number | null;
  createdAt: string;
};

export type VersionView = {
  id: string;
  chapterId: string | null;
  reason: string;
  wordCount: number;
  createdAt: string;
  content: unknown;
};

/**
 * How far back the History panel lists. An AUTOSAVE is written at most every ten minutes of
 * editing, so a hundred covers several weeks of steady work on one chapter; anything older is
 * still in storage, just not in the list.
 */
export const VERSION_LIST_LIMIT = 100;

const select = {
  id: true,
  documentId: true,
  outlineNodeId: true,
  title: true,
  order: true,
  content: true,
  version: true,
  wordCount: true,
  wordCounts: true,
  scopeNote: true,
  snapshotAt: true,
  updatedAt: true,
} satisfies Prisma.ChapterSelect;

@Injectable()
export class ChaptersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: SnapshotsService,
    private readonly style: StyleService,
    private readonly storage: StorageService,
  ) {}

  async get(ownerId: string, chapterId: string): Promise<ChapterView> {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, document: { ownerId } },
      select,
    });
    if (!chapter) throw new NotFoundError('That chapter');
    // A figure's stored link lasts fifteen minutes; the one this read hands out is fresh.
    await withFreshFigureLinks(chapter.content, chapter.documentId, (key) =>
      this.storage.signedUrl(key),
    );
    return this.view(chapter);
  }

  /**
   * PHASES 3.1 and §10.4: the sources this chapter draws on. An empty set means "search the whole
   * library"; a non-empty one restricts retrieval to exactly those sources, which is how a student
   * keeps a literature-review chapter from quoting their methods papers.
   */
  async pins(ownerId: string, chapterId: string): Promise<{ sourceIds: string[] }> {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, document: { ownerId } },
      select: { pins: { select: { sourceId: true } } },
    });
    if (!chapter) throw new NotFoundError('That chapter');
    return { sourceIds: chapter.pins.map((pin) => pin.sourceId) };
  }

  /**
   * Replaces the pin set. Every id is checked to belong to the same document first, so a pin can
   * never point at a source from someone else's library — the pins are a retrieval filter, and a
   * filter that reached across documents would leak one student's sources into another's drafts.
   */
  async setPins(
    ownerId: string,
    chapterId: string,
    sourceIds: readonly string[],
  ): Promise<{ sourceIds: string[] }> {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, document: { ownerId } },
      select: { id: true, documentId: true },
    });
    if (!chapter) throw new NotFoundError('That chapter');

    const unique = [...new Set(sourceIds)];
    if (unique.length > 0) {
      const owned = await this.prisma.source.findMany({
        where: { id: { in: unique }, documentId: chapter.documentId },
        select: { id: true },
      });
      if (owned.length !== unique.length) {
        const found = new Set(owned.map((source) => source.id));
        throw new ValidationError('Those sources are not in this thesis’ library', [
          { path: ['sourceIds'], message: unique.filter((id) => !found.has(id)).join(', ') },
        ]);
      }
    }

    await this.prisma.$transaction([
      this.prisma.chapterSourcePin.deleteMany({ where: { chapterId: chapter.id } }),
      ...(unique.length > 0
        ? [
            this.prisma.chapterSourcePin.createMany({
              data: unique.map((sourceId) => ({ chapterId: chapter.id, sourceId })),
            }),
          ]
        : []),
    ]);

    return { sourceIds: unique };
  }

  private async syncCitations(chapterId: string, documentId: string, content: unknown) {
    const rows = citationsIn(content);
    const wanted = new Set(rows.map((row) => row.nodeKey));

    const sourceIds = [...new Set(rows.map((row) => row.sourceId))];
    const owned = new Set(
      sourceIds.length === 0
        ? []
        : (
            await this.prisma.source.findMany({
              where: { id: { in: sourceIds }, documentId },
              select: { id: true },
            })
          ).map((source) => source.id),
    );
    const valid = rows.filter((row) => owned.has(row.sourceId));

    await this.prisma.$transaction([
      this.prisma.citation.deleteMany({
        where: { chapterId, ...(wanted.size > 0 ? { nodeKey: { notIn: [...wanted] } } : {}) },
      }),
      ...valid.map((row) =>
        this.prisma.citation.upsert({
          where: { chapterId_nodeKey: { chapterId, nodeKey: row.nodeKey } },
          create: { chapterId, ...row },
          update: {
            sourceId: row.sourceId,
            chunkId: row.chunkId,
            role: row.role,
            locator: row.locator,
          },
        }),
      ),
    ]);
  }

  /**
   * B.7 save. Returns the new version, or throws 409 when `baseVersion` is stale.
   * Also refreshes the per-provenance word counts (B.4) and writes an AUTOSAVE snapshot when one
   * is due.
   */
  async save(
    ownerId: string,
    chapterId: string,
    content: unknown,
    baseVersion: number,
  ): Promise<{ version: number; wordCount: number; snapshotTaken: boolean }> {
    if (!looksLikeDoc(content)) {
      throw new ValidationError(
        'content must be a ProseMirror document ({ type: "doc", content: [] })',
      );
    }
    if (!Number.isInteger(baseVersion) || baseVersion < 1) {
      throw new ValidationError('baseVersion must be a positive integer');
    }
    // Before anything else touches it: see `stripUnsafeKeys`. Silently, because a `__proto__` key
    // in a document is never something a student typed on purpose.
    stripUnsafeKeys(content);

    const counts = wordCountsOf(content);
    const wordCount = totalWords(counts);

    const updated = await this.prisma.chapter.updateMany({
      where: { id: chapterId, version: baseVersion, document: { ownerId } },
      data: {
        content: content as Prisma.InputJsonValue,
        wordCount,
        wordCounts: counts,
        version: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      const current = await this.prisma.chapter.findFirst({
        where: { id: chapterId, document: { ownerId } },
        select: { version: true },
      });
      if (!current) throw new NotFoundError('That chapter');
      throw new ConflictError('This chapter was changed elsewhere — reload to continue.', {
        serverVersion: current.version,
        baseVersion,
      });
    }

    const after = await this.prisma.chapter.findFirstOrThrow({
      where: { id: chapterId },
      select: { version: true, documentId: true, snapshotAt: true },
    });

    // PHASES 3.5: `Citation` rows mirror the citation nodes, keyed by node key. Rows for nodes
    // that are gone are deleted; the rest are upserted. Only sources still in this document's
    // library are referenced — a node pointing elsewhere is a red-dashed orphan (B.5), not a row.
    await this.syncCitations(chapterId, after.documentId, content);

    let snapshotTaken = false;
    if (this.snapshots.isDue(after.snapshotAt)) {
      await this.snapshots.write({
        documentId: after.documentId,
        chapterId,
        content,
        reason: 'AUTOSAVE',
      });
      snapshotTaken = true;
    }

    // FR-4.7: the profile is inferred the first time the document passes 1,500 HUMAN words.
    // Not awaited: it is a Strong-tier call, and an autosave must return in milliseconds. The
    // service swallows its own failures and tries again on the next save.
    void this.style.maybeLearn(ownerId, after.documentId).catch(() => undefined);

    return { version: after.version, wordCount, snapshotTaken };
  }

  async snapshot(
    ownerId: string,
    chapterId: string,
    reason: SnapshotReason,
  ): Promise<{ id: string; createdAt: string; reason: SnapshotReason }> {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, document: { ownerId } },
      select: { id: true, documentId: true, content: true },
    });
    if (!chapter) throw new NotFoundError('That chapter');
    const row = await this.snapshots.write({
      documentId: chapter.documentId,
      chapterId: chapter.id,
      content: chapter.content,
      reason,
    });
    return { id: row.id, createdAt: row.createdAt.toISOString(), reason };
  }

  async versions(
    ownerId: string,
    documentId: string,
  ): Promise<Array<{ id: string; chapterId: string | null; reason: string; createdAt: string }>> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true },
    });
    if (!document) throw new NotFoundError('That document');
    const rows = await this.prisma.documentVersion.findMany({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, chapterId: true, reason: true, createdAt: true },
    });
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  /**
   * One chapter's history, newest first — what the History panel lists.
   *
   * Metadata only, so the list stays one query however long the history is; a version's text is
   * fetched when somebody opens it (`readVersion`), which is the only time anyone needs it.
   */
  async chapterVersions(ownerId: string, chapterId: string): Promise<VersionSummary[]> {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, document: { ownerId } },
      select: { id: true },
    });
    if (!chapter) throw new NotFoundError('That chapter');
    const rows = await this.prisma.documentVersion.findMany({
      where: { chapterId },
      orderBy: { createdAt: 'desc' },
      take: VERSION_LIST_LIMIT,
      select: { id: true, reason: true, wordCount: true, createdAt: true },
    });
    return rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      wordCount: r.wordCount,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** A version's text, for the preview. Owner-scoped through the document, like everything. */
  async readVersion(ownerId: string, versionId: string): Promise<VersionView> {
    const row = await this.ownedVersion(ownerId, versionId);
    const content = await this.snapshots.read(row.snapshotKey);
    return {
      id: row.id,
      chapterId: row.chapterId,
      reason: row.reason,
      wordCount: row.wordCount ?? totalWords(wordCountsOf(content)),
      createdAt: row.createdAt.toISOString(),
      content,
    };
  }

  /**
   * Puts a version back as the chapter's text.
   *
   * The current text is snapshotted first, as `PRE_RESTORE`, so a restore is itself one click from
   * undone — the same promise draft accept and scoped revision make. It is not optimistic-locked
   * against `baseVersion`: the student is asking for that old text back on purpose, and whatever
   * the chapter says now is exactly what the PRE_RESTORE snapshot preserves. The version still
   * increments, so any other open tab gets its 409 and reloads rather than saving over the restore.
   *
   * Provenance comes back with the text. A sentence that was ASSIST when it was written is ASSIST
   * again — the AI-usage log describes the thesis as it stands, and restoring an old paragraph
   * does not make it the student's own.
   */
  async restoreVersion(
    ownerId: string,
    versionId: string,
  ): Promise<{ chapterId: string; version: number; wordCount: number; undoVersionId: string }> {
    const row = await this.ownedVersion(ownerId, versionId);
    if (!row.chapterId) throw new ValidationError('That version is not of a chapter.');

    const chapter = await this.prisma.chapter.findFirst({
      where: { id: row.chapterId, document: { ownerId } },
      select: { id: true, documentId: true, content: true },
    });
    if (!chapter) throw new NotFoundError('That chapter');

    const restored = await this.snapshots.read(row.snapshotKey);
    if (!looksLikeDoc(restored)) {
      throw new ValidationError('That version could not be read back as a chapter.');
    }
    stripUnsafeKeys(restored);

    const undo = await this.snapshots.write({
      documentId: chapter.documentId,
      chapterId: chapter.id,
      content: chapter.content,
      reason: 'PRE_RESTORE',
    });

    const counts = wordCountsOf(restored);
    const wordCount = totalWords(counts);
    const updated = await this.prisma.chapter.update({
      where: { id: chapter.id },
      data: {
        content: restored as Prisma.InputJsonValue,
        wordCount,
        wordCounts: counts,
        version: { increment: 1 },
      },
      select: { version: true },
    });
    // The restored text may cite different sources from the text it replaced.
    await this.syncCitations(chapter.id, chapter.documentId, restored);

    return { chapterId: chapter.id, version: updated.version, wordCount, undoVersionId: undo.id };
  }

  private async ownedVersion(ownerId: string, versionId: string) {
    const row = await this.prisma.documentVersion.findFirst({
      where: { id: versionId, document: { ownerId } },
      select: {
        id: true,
        chapterId: true,
        reason: true,
        wordCount: true,
        createdAt: true,
        snapshotKey: true,
      },
    });
    // Someone else's version reads as absent rather than forbidden (§12.1).
    if (!row) throw new NotFoundError('That version');
    return row;
  }

  private view(c: {
    id: string;
    documentId: string;
    outlineNodeId: string;
    title: string;
    order: number;
    content: unknown;
    version: number;
    wordCount: number;
    wordCounts: unknown;
    scopeNote: string | null;
    snapshotAt: Date | null;
    updatedAt: Date;
  }): ChapterView {
    return {
      ...c,
      snapshotAt: c.snapshotAt?.toISOString() ?? null,
      updatedAt: c.updatedAt.toISOString(),
    };
  }
}
