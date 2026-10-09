/**
 * R18 (ADR-0129): a paper is filed where it is added.
 *
 * The library screen's "Add into" names the collection a new paper goes into (ADR-0105). The
 * same choice is kept on the thesis (`Document.meta.addInto`) so every screen that adds a paper —
 * Discover, the editor's Papers tab, chat's Add, a pasted reference on the Citations tab — shows
 * it and sends it. An add route takes an optional `collectionId` (null or absent: the library
 * only); this service checks it belongs to the thesis *before* anything is added, so a bad id
 * never half-adds, and files the rows the add produced once it has.
 *
 * Owner only, like the rest of the library: a collection of another thesis, or of someone else,
 * is reported as absent (404).
 */

import { Global, Injectable, Module } from '@nestjs/common';
import { setMetaKey } from './document-meta.js';
import { NotFoundError } from './errors.js';
import { PrismaService } from './prisma.service.js';

export type FilingTarget = { id: string; name: string };

/** The `meta` key the choice is kept under. */
export const ADD_INTO_META_KEY = 'addInto';

/** The stored choice out of `Document.meta`, or null when there is none (or it is malformed). */
export function addIntoOf(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const value = (meta as Record<string, unknown>)[ADD_INTO_META_KEY];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

@Injectable()
export class LibraryFilingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The collection an add files into: null for "the library only"; a 404 for an id that is not a
   * collection of this owner's thesis. Call before the add.
   */
  async target(
    ownerId: string,
    documentId: string,
    collectionId: string | null | undefined,
  ): Promise<FilingTarget | null> {
    if (!collectionId) return null;
    const collection = await this.prisma.sourceCollection.findFirst({
      where: { id: collectionId, documentId, document: { ownerId } },
      select: { id: true, name: true },
    });
    if (!collection) throw new NotFoundError('That collection');
    return collection;
  }

  /**
   * Puts the rows an add produced (new, or already in the library) into the target. A paper
   * already there is not an error; nulls (an empty reference) are skipped. Only rows of the same
   * thesis are filed, whatever the caller passes.
   */
  async file(
    documentId: string,
    target: FilingTarget | null,
    sourceIds: ReadonlyArray<string | null | undefined>,
  ): Promise<FilingTarget | null> {
    if (!target) return null;
    const ids = [...new Set(sourceIds.filter((id): id is string => typeof id === 'string'))];
    if (ids.length === 0) return target;
    const own = await this.prisma.source.findMany({
      where: { id: { in: ids }, documentId },
      select: { id: true },
    });
    if (own.length > 0) {
      await this.prisma.sourceCollectionItem.createMany({
        data: own.map((s) => ({ collectionId: target.id, sourceId: s.id })),
        skipDuplicates: true,
      });
    }
    return target;
  }

  /** The thesis's "Add into", dropped quietly when that collection has since been deleted. */
  async stored(ownerId: string, documentId: string): Promise<{ collectionId: string | null }> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { meta: true },
    });
    if (!document) throw new NotFoundError('That document');
    const id = addIntoOf(document.meta);
    if (!id) return { collectionId: null };
    const still = await this.prisma.sourceCollection.findFirst({
      where: { id, documentId },
      select: { id: true },
    });
    return { collectionId: still ? id : null };
  }

  /** Keeps the choice on the thesis, so every screen (and device) starts from it. */
  async store(
    ownerId: string,
    documentId: string,
    collectionId: string | null,
  ): Promise<{ collectionId: string | null }> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      select: { id: true },
    });
    if (!document) throw new NotFoundError('That document');
    const target = await this.target(ownerId, documentId, collectionId);
    await setMetaKey(this.prisma, documentId, ADD_INTO_META_KEY, target?.id ?? null);
    return { collectionId: target?.id ?? null };
  }
}

@Global()
@Module({ providers: [LibraryFilingService], exports: [LibraryFilingService] })
export class LibraryFilingModule {}
