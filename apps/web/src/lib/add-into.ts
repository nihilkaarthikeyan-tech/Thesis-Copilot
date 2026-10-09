/**
 * R18 (ADR-0129): a paper is filed where it is added — the screen's side.
 *
 * The thesis keeps one "Add into" (`GET/PUT /documents/:id/add-into`). Every screen that adds a
 * paper — the library, Discover, the editor's Papers tab, chat's Add, a pasted reference — reads
 * it and sends it as `collectionId` with the add, so the server files the new rows in the same
 * request. Pure, so what is sent is tested.
 */

import type { Collection } from './collections';

/** What an add route answers about the filing: the collection, or null for the library only. */
export type FiledIn = { id: string; name: string } | null | undefined;

/**
 * The add's body with the chosen collection on it. "The library only" sends `collectionId: null`
 * — explicit, so a stored choice on the server can never file a paper the student meant to leave
 * unfiled.
 */
export function withCollection<T extends object>(
  body: T,
  collectionId: string | null,
): T & { collectionId: string | null } {
  return { ...body, collectionId: collectionId || null };
}

/** The sentence a notice ends with once the server says where the papers went. */
export function filedNotice(filedIn: FiledIn): string {
  return filedIn ? ` Filed in ${filedIn.name}.` : '';
}

/**
 * The stored choice, kept only while that collection still exists (another tab may have deleted
 * it): a stale id would make every add a 404.
 */
export function liveChoice(
  collectionId: string | null,
  collections: readonly Pick<Collection, 'id'>[],
): string | null {
  return collectionId && collections.some((c) => c.id === collectionId) ? collectionId : null;
}
