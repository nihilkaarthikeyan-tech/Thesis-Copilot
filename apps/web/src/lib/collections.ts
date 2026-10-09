/**
 * Collections (folders) in the library, the screen's side (2026-10-04). The API is
 * `apps/api/src/modules/sources/collections.controller.ts`; the screen is
 * `app/d/[id]/sources/SourcesScreen.tsx`.
 *
 * Pure, so the rules the screen shows are the rules the server enforces and both are tested.
 */

import { COLLECTION_NAME_MAX } from '@tc/types';

export type Collection = { id: string; name: string; order: number; count: number };

/** What the strip has chosen: every paper, the papers in no collection, or one collection. */
export type CollectionFilter = { kind: 'all' } | { kind: 'unfiled' } | { kind: 'one'; id: string };

/** The API's limit (`@tc/types`): the name box stops typing here, so it never sends a longer one. */
export { COLLECTION_NAME_MAX };

type Filed = { id: string; collectionIds?: readonly string[] | undefined };

/** The rows a collection filter keeps. A collection that no longer exists keeps nothing. */
export function inCollection<T extends Filed>(rows: readonly T[], filter: CollectionFilter): T[] {
  if (filter.kind === 'all') return [...rows];
  if (filter.kind === 'unfiled') return rows.filter((r) => (r.collectionIds ?? []).length === 0);
  return rows.filter((r) => (r.collectionIds ?? []).includes(filter.id));
}

/** Papers per collection, counted from the library itself so the strip agrees with the list. */
export function collectionCounts(rows: readonly Filed[]): {
  byId: Map<string, number>;
  unfiled: number;
} {
  const byId = new Map<string, number>();
  let unfiled = 0;
  for (const row of rows) {
    const ids = row.collectionIds ?? [];
    if (ids.length === 0) unfiled += 1;
    for (const id of ids) byId.set(id, (byId.get(id) ?? 0) + 1);
  }
  return { byId, unfiled };
}

/**
 * The same rule as the server: trimmed, inner spaces collapsed, 1–60 characters, and no other
 * collection of this thesis with the same name in any case. Returns the clean name or a sentence
 * saying what is wrong.
 */
export function checkCollectionName(
  raw: string,
  existing: readonly Pick<Collection, 'id' | 'name'>[],
  exceptId?: string,
): { ok: true; name: string } | { ok: false; error: string } {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length === 0) return { ok: false, error: 'Give the collection a name.' };
  if (name.length > COLLECTION_NAME_MAX) {
    return {
      ok: false,
      error: `A collection name can be at most ${COLLECTION_NAME_MAX} characters.`,
    };
  }
  const clash = existing.find(
    (c) => c.id !== exceptId && c.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
  if (clash) return { ok: false, error: `There is already a collection called "${clash.name}".` };
  return { ok: true, name };
}

/** The header checkbox: nothing, some or every visible row selected. */
export function selectionState(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
): 'none' | 'some' | 'all' {
  const chosen = visibleIds.filter((id) => selected.has(id)).length;
  if (chosen === 0) return 'none';
  return chosen === visibleIds.length ? 'all' : 'some';
}

/** Ticks every visible row, or clears them all when they were all ticked already. */
export function toggleAll(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
): Set<string> {
  return selectionState(selected, visibleIds) === 'all' ? new Set() : new Set(visibleIds);
}

/** Keeps only the selected rows still on screen, so an action never reaches a hidden paper. */
export function pruneSelection(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
): Set<string> {
  const visible = new Set(visibleIds);
  const next = new Set([...selected].filter((id) => visible.has(id)));
  return next.size === selected.size ? (selected as Set<string>) : next;
}

/** "Add to collection" result, said plainly. */
export function addedSummary(added: number, asked: number, name: string): string {
  const already = asked - added;
  const head =
    added === 0
      ? `Already in ${name}.`
      : `Added ${added} ${added === 1 ? 'paper' : 'papers'} to ${name}.`;
  return added > 0 && already > 0 ? `${head} ${already} already there.` : head;
}
