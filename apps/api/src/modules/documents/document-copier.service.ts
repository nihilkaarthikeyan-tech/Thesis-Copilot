/**
 * "Make a copy" of a thesis (ADR-0057).
 *
 * A new document owned by the same student, with its own copies of everything that is the
 * thesis: the chapters, the outline and memory, the settings (citation style, language,
 * template), the library — every source with its metadata, its chunks and their embeddings — the
 * seed papers, the pins and the citations. Never copied: shares, the read link, comments, usage,
 * exports, version history, coherence flags, viva questions, chapter builds, search runs and
 * suggestion telemetry. Those belong to the original's history or its people, not to its text.
 *
 * **Nothing is shared afterwards.** Every row gets a fresh id and every file a fresh key; the ids
 * inside the chapter JSON and the memory are rewritten to the copy's own (`copy-ids.ts`). So an
 * edit, a deletion or an erasure of one thesis cannot reach the other — including through
 * `DocumentEraser`, which removes a document's files by the keys its rows hold.
 *
 * **No model call, so no allowance.** Chunks are copied with their vectors in SQL rather than
 * re-embedded: the embedding is a function of the text and the model, and both are unchanged.
 *
 * Files first, then rows: the copies are made under the new document's prefixes before the
 * transaction, and removed again if the transaction fails, so a failed copy leaves nothing behind.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@tc/db';
import { NotFoundError } from '../../common/errors.js';
import { figurePrefix } from '../../common/figure-links.js';
import { PrismaService } from '../../common/prisma.service.js';
import { StorageService } from '../../common/storage.service.js';
import { copyTitle, remapIds, remapKey } from './copy-ids.js';

/** A copy of a large library is many rows; the default five-second transaction is not enough. */
const COPY_TRANSACTION_TIMEOUT_MS = 120_000;

type Json = Prisma.JsonValue | null;

/** Prisma wants `DbNull` rather than `null` for an empty nullable JSON column on create. */
function json(value: Json): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

export type CopyResult = { id: string; title: string; firstChapterId: string | null };

@Injectable()
export class DocumentCopier {
  private readonly logger = new Logger(DocumentCopier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Fresh UUID v7s from the database, which is what makes every id here (PRD §0.2). */
  private async newIds(count: number): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT uuid_generate_v7()::text AS id FROM generate_series(1, ${count}::int)`;
    return rows.map((row) => row.id);
  }

  async copy(ownerId: string, documentId: string): Promise<CopyResult> {
    const original = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      include: {
        memory: true,
        chapters: {
          orderBy: { order: 'asc' },
          include: { pins: true, citations: true },
        },
        sources: { orderBy: { createdAt: 'asc' } },
        seedPapers: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!original) throw new NotFoundError('That document');

    const ids = await this.newIds(
      1 + original.chapters.length + original.sources.length + original.seedPapers.length,
    );
    const take = () => ids.shift() as string;
    const map = new Map<string, string>();
    const copyId = take();
    map.set(original.id, copyId);
    for (const row of [...original.chapters, ...original.sources, ...original.seedPapers]) {
      map.set(row.id, take());
    }
    const idOf = (old: string) => map.get(old) as string;

    // ---- files, under the copy's own keys -----------------------------------------------------
    const copied: string[] = [];
    const fileKeys = new Map<string, string | null>();
    const copyFile = async (key: string): Promise<string | null> => {
      const target = remapKey(key, map);
      if (target === key) return null; // a key that names no id of ours is not ours to copy
      try {
        await this.storage.copy(key, target);
        copied.push(target);
        return target;
      } catch (error) {
        this.logger.warn({ err: error, key }, 'a file could not be copied with its thesis');
        return null;
      }
    };
    for (const row of [...original.sources, ...original.seedPapers]) {
      if (row.fileKey) fileKeys.set(row.id, await copyFile(row.fileKey));
    }
    let figures: string[] = [];
    try {
      figures = await this.storage.list(figurePrefix(original.id));
    } catch (error) {
      this.logger.warn({ err: error, documentId }, 'figures could not be listed to copy');
    }
    for (const key of figures) await copyFile(key);

    // ---- rows, in one transaction -------------------------------------------------------------
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.document.create({
            data: {
              id: copyId,
              ownerId,
              title: copyTitle(original.title),
              entryPath: original.entryPath,
              template: original.template,
              field: original.field,
              language: original.language,
              citationStyle: original.citationStyle,
              submissionDeadline: original.submissionDeadline,
              institutionTemplateId: original.institutionTemplateId,
              meta: json(remapIds(original.meta, map)),
              // A copy starts as a draft, whatever the original had reached (ADR-0043).
            },
          });

          if (original.memory) {
            const memory = original.memory;
            await tx.documentMemory.create({
              data: {
                documentId: copyId,
                scope: remapIds(memory.scope, map) as Prisma.InputJsonValue,
                outline: remapIds(memory.outline, map) as Prisma.InputJsonValue,
                glossary: remapIds(memory.glossary, map) as Prisma.InputJsonValue,
                styleProfile: json(remapIds(memory.styleProfile, map)),
                gapMap: json(remapIds(memory.gapMap, map)),
              },
            });
          } else {
            await tx.documentMemory.create({
              data: { documentId: copyId, scope: {}, outline: [], glossary: {} },
            });
          }

          if (original.sources.length > 0) {
            await tx.source.createMany({
              data: original.sources.map(({ id, documentId: _d, createdAt: _c, ...source }) => ({
                ...source,
                id: idOf(id),
                documentId: copyId,
                fileKey: source.fileKey ? (fileKeys.get(id) ?? null) : null,
                authors: json(source.authors),
                cslJson: json(source.cslJson),
              })),
            });
            // The chunks and their vectors, row for row, without a model call. The old→new chunk
            // ids come back so citations can point at the copy's own chunks.
            const chunkPairs = await tx.$queryRaw<Array<{ oldId: string; newId: string }>>`
              WITH m AS MATERIALIZED (
                SELECT c.id AS old_id, uuid_generate_v7() AS new_id, s.new_source
                FROM "SourceChunk" c
                JOIN unnest(
                  ${original.sources.map((s) => s.id)}::uuid[],
                  ${original.sources.map((s) => idOf(s.id))}::uuid[]
                ) AS s(old_source, new_source) ON c."sourceId" = s.old_source
              ), ins AS (
                INSERT INTO "SourceChunk"
                  ("id", "sourceId", "ordinal", "page", "charStart", "charEnd", "section", "text",
                   "tokenCount", "embedding")
                SELECT m.new_id, m.new_source, c."ordinal", c."page", c."charStart", c."charEnd",
                       c."section", c."text", c."tokenCount", c."embedding"
                FROM "SourceChunk" c JOIN m ON m.old_id = c.id
                RETURNING 1
              )
              SELECT m.old_id::text AS "oldId", m.new_id::text AS "newId" FROM m`;
            for (const pair of chunkPairs) map.set(pair.oldId, pair.newId);
          }

          if (original.seedPapers.length > 0) {
            await tx.seedPaper.createMany({
              data: original.seedPapers.map((seed) => ({
                id: idOf(seed.id),
                documentId: copyId,
                fileKey: fileKeys.get(seed.id) ?? '',
                filename: seed.filename,
                extraction: json(remapIds(seed.extraction, map)),
                status: seed.status,
                error: seed.error,
              })),
            });
          }

          if (original.chapters.length > 0) {
            await tx.chapter.createMany({
              data: original.chapters.map((chapter) => ({
                id: idOf(chapter.id),
                documentId: copyId,
                outlineNodeId: chapter.outlineNodeId,
                title: chapter.title,
                order: chapter.order,
                content: remapIds(chapter.content, map) as Prisma.InputJsonValue,
                wordCount: chapter.wordCount,
                wordCounts: json(chapter.wordCounts),
                scopeNote: chapter.scopeNote,
              })),
            });
            const pins = original.chapters.flatMap((chapter) =>
              chapter.pins.map((pin) => ({
                chapterId: idOf(pin.chapterId),
                sourceId: idOf(pin.sourceId),
              })),
            );
            if (pins.length > 0) await tx.chapterSourcePin.createMany({ data: pins });
            const citations = original.chapters.flatMap((chapter) =>
              chapter.citations.map((citation) => ({
                chapterId: idOf(citation.chapterId),
                sourceId: idOf(citation.sourceId),
                chunkId: citation.chunkId ? (map.get(citation.chunkId) ?? null) : null,
                nodeKey: citation.nodeKey,
                role: citation.role,
                locator: citation.locator,
              })),
            );
            if (citations.length > 0) await tx.citation.createMany({ data: citations });
            // The chapter's own indexed text, for retrieval over what the student wrote.
            await tx.$executeRaw`
              INSERT INTO "ChapterChunk" ("id", "chapterId", "ordinal", "from", "to", "text", "embedding")
              SELECT uuid_generate_v7(), m.new_chapter, c."ordinal", c."from", c."to", c."text", c."embedding"
              FROM "ChapterChunk" c
              JOIN unnest(
                ${original.chapters.map((c) => c.id)}::uuid[],
                ${original.chapters.map((c) => idOf(c.id))}::uuid[]
              ) AS m(old_chapter, new_chapter) ON c."chapterId" = m.old_chapter`;
          }

          await tx.auditEvent.create({
            data: {
              kind: 'DOCUMENT_COPIED',
              userId: ownerId,
              documentId: copyId,
              detail: { from: original.id, files: copied.length },
            },
          });
        },
        { timeout: COPY_TRANSACTION_TIMEOUT_MS, maxWait: 10_000 },
      );
    } catch (error) {
      // Nothing was written; take back the files made for it.
      for (const key of copied) await this.storage.remove(key).catch(() => undefined);
      throw error;
    }

    this.logger.log(
      { documentId, copyId, chapters: original.chapters.length, sources: original.sources.length },
      'thesis copied',
    );
    const first = original.chapters[0];
    return {
      id: copyId,
      title: copyTitle(original.title),
      firstChapterId: first ? idOf(first.id) : null,
    };
  }
}
