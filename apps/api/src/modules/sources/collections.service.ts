/**
 * Collections (folders) in the library — 2026-10-04, from the Jenni study.
 *
 * A student with sixty papers groups them: "Methods", "Chapter 2", "Policy". A collection is a
 * name and a set of the thesis's own sources; a source may be in any number of them. Removing a
 * collection removes its memberships and nothing else — the papers stay in the library.
 *
 * Owner only, like the rest of the library (PRD §12.1): every query is scoped by the document's
 * owner, and anything the caller does not own is reported as absent (404), never as forbidden.
 *
 * Names are trimmed, 1–60 characters, and unique within a thesis whatever their case. The service
 * checks first so the 409 can name the clash; a unique index on `lower(name)` (migration 0036)
 * settles a race between two tabs, and that violation is answered the same way.
 */

import { Injectable } from '@nestjs/common';
import { Prisma } from '@tc/db';
import { COLLECTION_NAME_MAX } from '@tc/types';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';

/** Shared with the name box on the Library tab (`@tc/types`), so the two cannot disagree. */
export { COLLECTION_NAME_MAX };
/** More than any student keeps; a bound so a runaway script cannot fill the strip. */
export const COLLECTIONS_PER_DOCUMENT_MAX = 100;

export type CollectionView = {
  id: string;
  name: string;
  order: number;
  /** How many sources are in it. */
  count: number;
};

/** Trimmed, inner whitespace collapsed; throws a 400 the screen can show as it is. */
export function normaliseCollectionName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length === 0) throw new ValidationError('Give the collection a name.');
  if (name.length > COLLECTION_NAME_MAX) {
    throw new ValidationError(
      `A collection name can be at most ${COLLECTION_NAME_MAX} characters.`,
    );
  }
  return name;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function nameTaken(name: string): ConflictError {
  return new ConflictError(`There is already a collection called "${name}".`, {
    reason: 'COLLECTION_NAME_TAKEN',
  });
}

@Injectable()
export class CollectionsService {
  constructor(private readonly prisma: PrismaService) {}

  private async ownedDocument(ownerId: string, documentId: string): Promise<void> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true },
    });
    if (!document) throw new NotFoundError('That document');
  }

  private async ownedCollection(
    ownerId: string,
    collectionId: string,
  ): Promise<{ id: string; documentId: string; name: string }> {
    const collection = await this.prisma.sourceCollection.findFirst({
      where: { id: collectionId, document: { ownerId } },
      select: { id: true, documentId: true, name: true },
    });
    if (!collection) throw new NotFoundError('That collection');
    return collection;
  }

  private async assertNameFree(documentId: string, name: string, exceptId?: string) {
    const clash = await this.prisma.sourceCollection.findFirst({
      where: {
        documentId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { name: true },
    });
    if (clash) throw nameTaken(clash.name);
  }

  async list(ownerId: string, documentId: string): Promise<CollectionView[]> {
    await this.ownedDocument(ownerId, documentId);
    const rows = await this.prisma.sourceCollection.findMany({
      where: { documentId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, order: true, _count: { select: { items: true } } },
    });
    return rows.map(({ _count, ...row }) => ({ ...row, count: _count.items }));
  }

  /** A new collection goes to the end of the strip. */
  async create(ownerId: string, documentId: string, rawName: string): Promise<CollectionView> {
    await this.ownedDocument(ownerId, documentId);
    const name = normaliseCollectionName(rawName);
    await this.assertNameFree(documentId, name);
    const existing = await this.prisma.sourceCollection.aggregate({
      where: { documentId },
      _count: { _all: true },
      _max: { order: true },
    });
    if (existing._count._all >= COLLECTIONS_PER_DOCUMENT_MAX) {
      throw new ValidationError(
        `A thesis can have at most ${COLLECTIONS_PER_DOCUMENT_MAX} collections.`,
      );
    }
    try {
      const row = await this.prisma.sourceCollection.create({
        data: { documentId, name, order: (existing._max.order ?? -1) + 1 },
        select: { id: true, name: true, order: true },
      });
      return { ...row, count: 0 };
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken(name);
      throw error;
    }
  }

  async rename(ownerId: string, collectionId: string, rawName: string): Promise<CollectionView> {
    const collection = await this.ownedCollection(ownerId, collectionId);
    const name = normaliseCollectionName(rawName);
    await this.assertNameFree(collection.documentId, name, collection.id);
    try {
      const row = await this.prisma.sourceCollection.update({
        where: { id: collection.id },
        data: { name },
        select: { id: true, name: true, order: true, _count: { select: { items: true } } },
      });
      const { _count, ...rest } = row;
      return { ...rest, count: _count.items };
    } catch (error) {
      if (isUniqueViolation(error)) throw nameTaken(name);
      throw error;
    }
  }

  /** The collection and its memberships go; every paper stays in the library. */
  async remove(ownerId: string, collectionId: string): Promise<{ removed: true }> {
    const collection = await this.ownedCollection(ownerId, collectionId);
    await this.prisma.sourceCollection.delete({ where: { id: collection.id } });
    return { removed: true };
  }

  /**
   * The strip's order. `ids` must be exactly this thesis's collections, each once: a partial or
   * stale list (another tab added one) is refused rather than half-applied.
   */
  async reorder(ownerId: string, documentId: string, ids: string[]): Promise<CollectionView[]> {
    await this.ownedDocument(ownerId, documentId);
    const current = await this.prisma.sourceCollection.findMany({
      where: { documentId },
      select: { id: true },
    });
    const known = new Set(current.map((c) => c.id));
    const given = new Set(ids);
    if (
      given.size !== ids.length ||
      given.size !== known.size ||
      ids.some((id) => !known.has(id))
    ) {
      throw new ConflictError(
        'The collections changed since the list was loaded. Reload and try again.',
        {
          reason: 'COLLECTIONS_CHANGED',
        },
      );
    }
    await this.prisma.$transaction(
      ids.map((id, order) =>
        this.prisma.sourceCollection.update({ where: { id }, data: { order } }),
      ),
    );
    return this.list(ownerId, documentId);
  }

  /**
   * Puts these sources in the collection. Every id must be a source of the same thesis; one that
   * is not (another thesis, someone else's, gone) fails the whole request with a 404, so nothing
   * is added halfway. Adding a source already there is not an error.
   */
  async addSources(
    ownerId: string,
    collectionId: string,
    sourceIds: string[],
  ): Promise<{ added: number; count: number }> {
    const collection = await this.ownedCollection(ownerId, collectionId);
    const unique = [...new Set(sourceIds)];
    const found = await this.prisma.source.count({
      where: { id: { in: unique }, documentId: collection.documentId },
    });
    if (found !== unique.length) throw new NotFoundError('One of those sources');
    const result = await this.prisma.sourceCollectionItem.createMany({
      data: unique.map((sourceId) => ({ collectionId: collection.id, sourceId })),
      skipDuplicates: true,
    });
    const count = await this.prisma.sourceCollectionItem.count({
      where: { collectionId: collection.id },
    });
    return { added: result.count, count };
  }

  /** Takes these sources out of the collection; the sources themselves are untouched. */
  async removeSources(
    ownerId: string,
    collectionId: string,
    sourceIds: string[],
  ): Promise<{ removed: number; count: number }> {
    const collection = await this.ownedCollection(ownerId, collectionId);
    const result = await this.prisma.sourceCollectionItem.deleteMany({
      where: { collectionId: collection.id, sourceId: { in: [...new Set(sourceIds)] } },
    });
    const count = await this.prisma.sourceCollectionItem.count({
      where: { collectionId: collection.id },
    });
    return { removed: result.count, count };
  }
}
