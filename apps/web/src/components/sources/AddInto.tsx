'use client';

/**
 * R18 (ADR-0105, ADR-0129): "Add into" — the collection a paper goes into as it is added, kept
 * on the thesis so the library, Discover, the editor's Papers tab and chat all start from the
 * same choice. `useAddInto` loads and stores it; `AddIntoPicker` is the control (a collection,
 * "The library only", or "New collection…" named inline).
 */

import { useCallback, useEffect, useState } from 'react';
import { Input } from '@/components/ui/primitives';
import { liveChoice } from '@/lib/add-into';
import { ApiError, api } from '@/lib/api';
import type { Collection } from '@/lib/collections';

export type AddInto = {
  /** The chosen collection, or null for the library only. */
  collectionId: string | null;
  /** Its name, for "Filed in …"; null for the library only. */
  name: string | null;
  collections: Collection[];
  choose: (collectionId: string | null) => Promise<void>;
  /** Makes a collection and chooses it; throws the API's message when the name is refused. */
  create: (name: string) => Promise<void>;
  reload: () => Promise<void>;
};

/**
 * `shared`: a screen that already lists the collections (the library's strip) passes its own list
 * and its reload, so the picker and the strip never disagree and nothing is fetched twice.
 */
export function useAddInto(
  documentId: string,
  shared?: { collections: Collection[]; reload: () => Promise<unknown> },
): AddInto {
  const [stored, setStored] = useState<string | null>(null);
  const [own, setOwn] = useState<Collection[]>([]);
  const collections = shared ? shared.collections : own;
  const hasShared = shared !== undefined;
  const sharedReload = shared?.reload;

  const reload = useCallback(async () => {
    try {
      const [list, choice] = await Promise.all([
        hasShared
          ? Promise.resolve(null)
          : api<Collection[]>(`/documents/${documentId}/collections`),
        api<{ collectionId: string | null }>(`/documents/${documentId}/add-into`),
      ]);
      if (list) setOwn(list);
      setStored(choice.collectionId);
    } catch {
      // Without them the picker offers the library only, and every add still works.
    }
  }, [documentId, hasShared]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const choose = useCallback(
    async (collectionId: string | null) => {
      setStored(collectionId);
      try {
        await api(`/documents/${documentId}/add-into`, {
          method: 'PUT',
          body: JSON.stringify({ collectionId }),
        });
      } catch {
        // Kept for this screen; the next screen starts from what was stored before.
      }
    },
    [documentId],
  );

  const create = useCallback(
    async (name: string) => {
      const created = await api<Collection>(`/documents/${documentId}/collections`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      if (sharedReload) await sharedReload();
      else setOwn((list) => [...list, created]);
      await choose(created.id);
    },
    [documentId, choose, sharedReload],
  );

  const collectionId = liveChoice(stored, collections);
  return {
    collectionId,
    name: collections.find((c) => c.id === collectionId)?.name ?? null,
    collections,
    choose,
    create,
    reload,
  };
}

/**
 * The control. `compact` is the editor's side panel (288 px): the select takes the room that is
 * left on its line rather than its own width, so a long collection name never pushes it out.
 */
export function AddIntoPicker({
  addInto,
  compact = false,
  label = 'Add into',
  testId = 'add-into',
}: {
  addInto: AddInto;
  compact?: boolean;
  label?: string;
  testId?: string;
}) {
  const [naming, setNaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const height = compact ? 'h-7 text-xs' : 'h-9';

  async function make(name: string) {
    setError(null);
    try {
      await addInto.create(name);
      setNaming(null);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'The collection was not made.',
      );
    }
  }

  return (
    <span
      className={`flex min-w-0 flex-wrap items-center gap-1 ${compact ? 'text-xs' : 'text-sm'}`}
      data-testid={testId}
    >
      <label htmlFor={`${testId}-control`} className="shrink-0 text-muted">
        {label}
      </label>
      {naming === null ? (
        <select
          id={`${testId}-control`}
          value={addInto.collectionId ?? ''}
          onChange={(e) => {
            if (e.target.value === '__new') setNaming('');
            else void addInto.choose(e.target.value || null);
          }}
          className={`${height} min-w-0 rounded-md border border-line-strong bg-surface px-2 text-ink ${
            // w-0 + flex-1: no width of its own, so the longest name cannot widen the panel.
            compact ? 'w-0 flex-1 truncate' : 'max-w-64'
          }`}
          data-testid={`${testId}-select`}
        >
          <option value="">The library only</option>
          {addInto.collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="__new">New collection…</option>
        </select>
      ) : (
        <form
          className="flex min-w-0 flex-1 items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (naming.trim()) void make(naming.trim());
          }}
        >
          <Input
            id={`${testId}-control`}
            autoFocus
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            placeholder="Name"
            className={`${height} min-w-0 ${compact ? 'w-0 flex-1' : 'w-40'}`}
            data-testid={`${testId}-new`}
          />
          <button type="submit" className="shrink-0 font-semibold text-accent underline">
            Make
          </button>
          <button
            type="button"
            className="shrink-0 text-muted underline"
            onClick={() => {
              setNaming(null);
              setError(null);
            }}
          >
            Cancel
          </button>
        </form>
      )}
      {error ? (
        <span role="alert" className="basis-full text-warn">
          {error}
        </span>
      ) : null}
    </span>
  );
}
