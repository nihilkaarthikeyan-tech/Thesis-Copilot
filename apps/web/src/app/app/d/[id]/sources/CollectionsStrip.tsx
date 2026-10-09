'use client';

/**
 * The collections strip on the Library tab (2026-10-04, from the Jenni study): "All", each
 * collection with how many papers are in it, "Not in a collection", and "+ New collection".
 * Choosing one filters the list; the chosen collection can be renamed or deleted in place.
 * Deleting a collection never deletes a paper, and the confirmation says so.
 *
 * The counts come from the library rows themselves (`collectionCounts`), so the strip and the
 * list can never disagree after an add or a remove.
 */

import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import {
  COLLECTION_NAME_MAX,
  type Collection,
  type CollectionFilter,
  checkCollectionName,
} from '@/lib/collections';

const chip = (active: boolean) =>
  `rounded-md px-3 py-1 ${
    active
      ? 'bg-accent text-accent-ink font-semibold'
      : 'border border-line text-muted hover:border-line-strong hover:text-ink'
  }`;

export function CollectionsStrip({
  documentId,
  collections,
  counts,
  total,
  filter,
  onFilter,
  onChanged,
  onError,
}: {
  documentId: string;
  collections: Collection[];
  counts: { byId: Map<string, number>; unfiled: number };
  total: number;
  filter: CollectionFilter;
  onFilter: (next: CollectionFilter) => void;
  /** Something changed on the server; the screen reloads collections and the library. */
  onChanged: (notice?: string) => Promise<void> | void;
  onError: (message: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const active =
    filter.kind === 'one' ? (collections.find((c) => c.id === filter.id) ?? null) : null;

  function reset() {
    setCreating(false);
    setRenaming(false);
    setName('');
    setProblem(null);
  }

  async function submit() {
    const checked = checkCollectionName(name, collections, renaming ? active?.id : undefined);
    if (!checked.ok) {
      setProblem(checked.error);
      return;
    }
    setBusy(true);
    try {
      if (renaming && active) {
        await api(`/collections/${active.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: checked.name }),
        });
        reset();
        await onChanged(`Renamed to ${checked.name}.`);
      } else {
        const created = await api<Collection>(`/documents/${documentId}/collections`, {
          method: 'POST',
          body: JSON.stringify({ name: checked.name }),
        });
        reset();
        await onChanged();
        onFilter({ kind: 'one', id: created.id });
      }
    } catch (e) {
      setProblem(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'That did not save.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(collection: Collection) {
    const n = counts.byId.get(collection.id) ?? 0;
    const ok = window.confirm(
      `Delete the collection "${collection.name}"? ${
        n === 0
          ? 'It is empty.'
          : `The ${n === 1 ? 'paper' : `${n} papers`} in it stay in your library.`
      }`,
    );
    if (!ok) return;
    try {
      await api(`/collections/${collection.id}`, { method: 'DELETE' });
      onFilter({ kind: 'all' });
      await onChanged(`Deleted the collection ${collection.name}. Its papers are still here.`);
    } catch (e) {
      onError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not delete it.',
      );
    }
  }

  return (
    <div className="mt-6" data-testid="collections-strip">
      <p className="eyebrow mb-2">Collections</p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          aria-pressed={filter.kind === 'all'}
          className={chip(filter.kind === 'all')}
          onClick={() => onFilter({ kind: 'all' })}
        >
          All papers {total}
        </button>
        {collections.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={filter.kind === 'one' && filter.id === c.id}
            data-testid="collection-chip"
            className={chip(filter.kind === 'one' && filter.id === c.id)}
            onClick={() => onFilter({ kind: 'one', id: c.id })}
          >
            {c.name} {counts.byId.get(c.id) ?? 0}
          </button>
        ))}
        {collections.length > 0 ? (
          <button
            type="button"
            aria-pressed={filter.kind === 'unfiled'}
            className={chip(filter.kind === 'unfiled')}
            onClick={() => onFilter({ kind: 'unfiled' })}
          >
            Not in a collection {counts.unfiled}
          </button>
        ) : null}
        {creating || renaming ? null : (
          <button
            type="button"
            data-testid="new-collection"
            className="rounded-md px-2 py-1 font-semibold text-accent hover:underline"
            onClick={() => {
              setCreating(true);
              setName('');
              setProblem(null);
            }}
          >
            + New collection
          </button>
        )}
      </div>

      {creating || renaming ? (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            // biome-ignore lint/a11y/noAutofocus: the student just pressed "New collection" or "Rename".
            autoFocus
            aria-label={renaming ? 'New name for the collection' : 'Name of the new collection'}
            data-testid="collection-name"
            placeholder="Methods, Chapter 2, Policy…"
            maxLength={COLLECTION_NAME_MAX}
            className="w-64 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setProblem(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') reset();
            }}
          />
          <button
            type="submit"
            disabled={busy}
            data-testid="collection-save"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50"
          >
            {renaming ? 'Rename' : 'Create'}
          </button>
          <button type="button" className="text-sm text-muted underline" onClick={reset}>
            Cancel
          </button>
          {problem ? (
            <p role="alert" className="basis-full text-xs text-warn">
              {problem}
            </p>
          ) : null}
        </form>
      ) : null}

      {active && !renaming && !creating ? (
        <p className="mt-2 flex gap-3 text-xs text-muted">
          <button
            type="button"
            className="underline hover:text-ink"
            data-testid="collection-rename"
            onClick={() => {
              setRenaming(true);
              setName(active.name);
              setProblem(null);
            }}
          >
            Rename “{active.name}”
          </button>
          <button
            type="button"
            className="underline hover:text-warn"
            data-testid="collection-delete"
            onClick={() => void remove(active)}
          >
            Delete collection
          </button>
        </p>
      ) : null}
    </div>
  );
}
