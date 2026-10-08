/**
 * "Open as a document" — Jenni build plan R38, ADR-0123. The stored claims map (ADR-0086) becomes
 * a new chapter of the thesis, its sections pending AI drafts the student accepts or discards,
 * every claim cited from the papers the map read. No model call and no allowance: the analysis
 * was paid for when it was mapped.
 *
 * A chapter, not a separate document: a citation can only point at this thesis's library
 * (`Source.documentId`), and a chapter keeps the analysis's sentences movable into the literature
 * review with their citations intact. One chapter per map: opening the same map again opens the
 * chapter it made, while that chapter exists.
 */

import { Injectable, Logger } from '@nestjs/common';
import { CLAIMS_MAP } from '@tc/ai';
import { type OutlineNode, outlineSchema, readOutline, walkOutline } from '@tc/types';
import { newCitationKey, newRefId, thesisExtensions } from '@tc/ui';
import { getSchema } from '@tiptap/core';
import { setMetaKey } from '../../common/document-meta.js';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import type { SessionUser } from '../auth/current-user.decorator.js';
import { citationsIn } from '../chapters/citations.js';
import { totalWords, wordCountsOf } from '../chapters/word-counts.js';
import { runIsLive } from '../memory/outline.service.js';
import {
  CLAIMS_DOCUMENT_TITLE,
  claimsChapterDoc,
  claimsDocument,
  GAP_SECTIONS,
  type GapSection,
  type StoredClaimsMap,
} from './claims-document.js';

/** `Document.meta.claimsDocument`: the chapter a map was opened as. */
export type ClaimsDocumentRecord = {
  chapterId: string;
  computedAt: string;
  claims: number;
  leftOut: number;
};

export type OpenedClaimsDocument = {
  chapterId: string;
  title: string;
  /** False when this map had already been opened and its chapter was opened again. */
  created: boolean;
  claims: number;
  leftOut: number;
};

const SCOPE_NOTE =
  'What the papers in the library claim, how well each claim is supported, where they disagree, and the gaps this thesis could take up.';

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

type Meta = {
  claims?: StoredClaimsMap;
  claimsDocument?: ClaimsDocumentRecord;
  outlineRun?: { status?: string; startedAt?: string; from?: string };
};

@Injectable()
export class ClaimsDocumentService {
  private readonly logger = new Logger(ClaimsDocumentService.name);
  /** The editor's schema: the chapter is checked against it before it is saved, as an import is. */
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

  constructor(private readonly prisma: PrismaService) {}

  /** The chapter this map was opened as, while it exists; the Sources page names its button by it. */
  async current(
    documentId: string,
    documentMeta: unknown,
  ): Promise<{ chapterId: string; title: string } | null> {
    const meta = (documentMeta as Meta | null) ?? {};
    const record = meta.claimsDocument;
    if (!record || !meta.claims || record.computedAt !== meta.claims.computedAt) return null;
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: record.chapterId, documentId },
      select: { id: true, title: true },
    });
    return chapter ? { chapterId: chapter.id, title: chapter.title } : null;
  }

  async open(user: Pick<SessionUser, 'id'>, documentId: string): Promise<OpenedClaimsDocument> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId: user.id },
      select: { id: true },
    });
    if (!document) throw new NotFoundError('That document');
    // Every document is created with its memory row; one made some other way gets an empty one,
    // so the lock below always has a row to hold.
    await this.prisma.documentMemory.upsert({
      where: { documentId },
      create: { documentId, scope: {}, outline: [], glossary: {} },
      update: {},
    });

    const opened = await this.prisma.$transaction(
      async (tx) => {
        // The outline row is the lock: the Sections panel's note takes the same one (ADR-0097), and
        // two presses of the button wait for each other here rather than making two chapters.
        const locked = await tx.$queryRaw<Array<{ outline: unknown }>>`
          SELECT "outline" FROM "DocumentMemory" WHERE "documentId" = ${documentId}::uuid FOR UPDATE`;
        const row = await tx.document.findUniqueOrThrow({
          where: { id: documentId },
          select: { meta: true },
        });
        const meta = (row.meta as Meta | null) ?? {};
        const map = meta.claims;
        if (!map || !Array.isArray(map.claims) || map.claims.length === 0) {
          throw new ValidationError(
            'Map the claims in your library first; the analysis opens as a document from the map.',
          );
        }

        const record = meta.claimsDocument;
        if (record && record.computedAt === map.computedAt) {
          const existing = await tx.chapter.findFirst({
            where: { id: record.chapterId, documentId },
            select: { id: true, title: true },
          });
          if (existing) {
            return {
              chapterId: existing.id,
              title: existing.title,
              created: false,
              claims: record.claims,
              leftOut: record.leftOut,
            };
          }
        }

        // A plan being written would replace the outline this adds to (ADR-0072).
        if (runIsLive(meta.outlineRun, new Date())) {
          throw new ConflictError(
            'Your chapters are still being planned. Open the analysis as a document once the plan is ready.',
          );
        }

        // The papers the map named that are still in this library, and the passage each was read
        // from — only when the map recorded it and it still exists (a re-index replaces passages).
        // Ids come back from stored JSON; only uuid-shaped ones reach a uuid column's filter.
        const named = [
          ...new Set(map.claims.flatMap((c) => [...c.supporting, ...c.contrasting])),
        ].filter(isUuid);
        const sources = await tx.source.findMany({
          where: { documentId, id: { in: named } },
          select: { id: true },
        });
        const recorded = new Map(
          (map.papers ?? []).flatMap((p) =>
            p.chunkId && isUuid(p.chunkId) ? [[p.id, p.chunkId] as const] : [],
          ),
        );
        const chunks =
          recorded.size === 0
            ? []
            : await tx.sourceChunk.findMany({
                where: {
                  id: { in: [...recorded.values()] },
                  sourceId: { in: sources.map((s) => s.id) },
                },
                select: { id: true, sourceId: true },
              });
        const chunkOf = new Map(
          chunks.filter((c) => recorded.get(c.sourceId) === c.id).map((c) => [c.sourceId, c.id]),
        );
        const available = new Map(
          sources.map((s) => [s.id, { chunkId: chunkOf.get(s.id) ?? null }]),
        );

        // One id for the chapter and one per section's suggestion event, before anything is written.
        const ids = (
          await tx.$queryRaw<Array<{ id: string }>>`
            SELECT uuid_generate_v7()::text AS id FROM generate_series(1, ${GAP_SECTIONS.length + 1}::int)`
        ).map((r) => r.id);
        const chapterId = ids[0] as string;
        const actionIds = Object.fromEntries(
          GAP_SECTIONS.map((section, i) => [section, ids[i + 1] as string]),
        ) as Record<GapSection, string>;

        const built = claimsDocument({
          map,
          available,
          actionIds,
          newCitationKey,
          newRefId,
          paperChars: CLAIMS_MAP.paperChars,
        });
        if (built.claims === 0) {
          throw new ValidationError(
            'The papers these claims rested on are no longer in your library. Map the claims again to open them as a document.',
          );
        }

        const chapters = await tx.chapter.findMany({
          where: { documentId },
          orderBy: { order: 'asc' },
          select: { id: true, outlineNodeId: true, title: true, scopeNote: true, order: true },
        });
        const taken = new Set(chapters.map((c) => c.title.trim().toLowerCase()));
        let title = CLAIMS_DOCUMENT_TITLE;
        for (let n = 2; taken.has(title.toLowerCase()); n++) {
          title = `${CLAIMS_DOCUMENT_TITLE} (${n})`;
        }

        const json = claimsChapterDoc(title, built.blocks);
        let content: Record<string, unknown>;
        try {
          const node = this.schema.nodeFromJSON(json);
          node.check();
          content = node.toJSON() as Record<string, unknown>;
        } catch (error) {
          this.logger.error({ err: error, documentId }, 'claims document failed the schema');
          throw new Error('The claims document could not be built');
        }
        const counts = wordCountsOf(content);

        // At the end of the outline. A thesis with no outline yet adopts its chapters into one, in
        // their order, as a Word import does, so the analysis really does come after them.
        const outline = readOutline(locked[0]?.outline);
        const base: OutlineNode[] =
          outline.length > 0
            ? outline
            : chapters.map((c) => ({
                id: c.outlineNodeId,
                title: c.title,
                scopeNote: c.scopeNote ?? '',
                children: [],
              }));
        const usedIds = new Set(walkOutline(base).map((n) => n.id));
        let nodeId = 'gap-analysis';
        for (let n = 2; usedIds.has(nodeId); n++) nodeId = `gap-analysis-${n}`;
        const nodes = outlineSchema.parse([
          ...base,
          { id: nodeId, title, scopeNote: SCOPE_NOTE, children: [] },
        ]);
        const position = new Map(nodes.map((n, i) => [n.id, i + 1]));
        const outside = chapters.filter((c) => !position.has(c.outlineNodeId));
        for (const chapter of chapters) {
          const order =
            position.get(chapter.outlineNodeId) ?? nodes.length + outside.indexOf(chapter) + 1;
          if (order !== chapter.order) {
            await tx.chapter.update({ where: { id: chapter.id }, data: { order } });
          }
        }

        await tx.chapter.create({
          data: {
            id: chapterId,
            documentId,
            outlineNodeId: nodeId,
            title,
            scopeNote: SCOPE_NOTE,
            order: position.get(nodeId) as number,
            content: content as never,
            wordCounts: counts,
            wordCount: totalWords(counts),
          },
        });
        // Each section is a suggestion the student resolves, as a chapter build's are: Accept and
        // Discard record on these rows, and the AI-usage report counts them for this chapter.
        await tx.suggestionEvent.createMany({
          data: GAP_SECTIONS.map((section) => ({
            id: actionIds[section],
            userId: user.id,
            documentId,
            chapterId,
            action: 'CROSS_PAPER' as const,
            shownChars: built.shownChars[section],
            outcome: 'SHOWN',
            latencyMs: 0,
            guided: false,
          })),
        });
        const citations = citationsIn(content);
        if (citations.length > 0) {
          await tx.citation.createMany({
            data: citations.map((c) => ({ chapterId, ...c })),
          });
        }
        await tx.documentMemory.update({
          where: { documentId },
          data: { outline: nodes as never },
        });
        const next: ClaimsDocumentRecord = {
          chapterId,
          computedAt: map.computedAt,
          claims: built.claims,
          leftOut: built.leftOut,
        };
        await setMetaKey(tx, documentId, 'claimsDocument', next);

        this.logger.log(
          {
            documentId,
            chapterId,
            claims: built.claims,
            leftOut: built.leftOut,
            missingPapers: built.missingPapers,
            citations: citations.length,
          },
          'claims map opened as a document',
        );
        return { chapterId, title, created: true, claims: built.claims, leftOut: built.leftOut };
      },
      { timeout: 20_000 },
    );
    return opened;
  }
}
