'use client';

/**
 * Saved prompts in chat — ADR-0019. "/" brings back a question the student asks often.
 *
 * Choosing one puts its text in the box, where it can still be changed before it is sent: a saved
 * prompt is a way of typing, not a way of sending, so everything chat does to a typed question —
 * grounding, the refusals, the cap — it does to this one. The prompts are the student's, not the
 * thesis's, so the same list follows them from one thesis to the next.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { SavedPrompt } from '@/lib/prompts';
import { cn } from '@/lib/utils';

/** By name, the way the student looks for one; applied here too so every change keeps it. */
function byTitle(list: SavedPrompt[]): SavedPrompt[] {
  return [...list].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
  );
}

export function useSavedPrompts() {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api<SavedPrompt[]>('/prompts')
      .then((list) => setPrompts(byTitle(list)))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const save = useCallback(async (title: string, body: string) => {
    const created = await api<SavedPrompt>('/prompts', {
      method: 'POST',
      body: JSON.stringify({ title, body }),
    });
    setPrompts((list) => byTitle([...list, created]));
    return created;
  }, []);

  const update = useCallback(async (id: string, patch: { title?: string; body?: string }) => {
    const updated = await api<SavedPrompt>(`/prompts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    setPrompts((list) => byTitle(list.map((p) => (p.id === id ? updated : p))));
    return updated;
  }, []);

  const remove = useCallback(async (id: string) => {
    await api(`/prompts/${id}`, { method: 'DELETE' });
    setPrompts((list) => list.filter((p) => p.id !== id));
  }, []);

  return { prompts, loaded, save, update, remove };
}

/** The first line of a prompt's text, for the picker. */
function preview(body: string): string {
  const line = body.split('\n')[0] ?? '';
  return line.length > 90 ? `${line.slice(0, 90)}…` : line;
}

export function PromptPicker({
  options,
  query,
  active,
  onPick,
  onEdit,
  onDelete,
}: {
  options: readonly SavedPrompt[];
  query: string;
  active: number;
  onPick: (prompt: SavedPrompt) => void;
  onEdit: (prompt: SavedPrompt) => void;
  onDelete: (prompt: SavedPrompt) => Promise<void>;
}) {
  // Deleting takes two clicks: the first arms the button, the second deletes. No `confirm()`,
  // which would take the focus out of the box the student is typing in.
  const [armed, setArmed] = useState<string | null>(null);

  return (
    <div
      data-testid="chat-prompt-picker"
      className="absolute bottom-full left-0 z-20 mb-1 max-h-72 w-full overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-lg"
    >
      {options.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-muted">
          {query
            ? `No saved prompt matches “${query}”.`
            : 'No saved prompts yet. Type a question you ask often, then choose “Save as prompt” below the box.'}
        </p>
      ) : (
        <ul className="grid list-none gap-0.5 p-0">
          {options.map((prompt, index) => (
            <li
              key={prompt.id}
              data-testid="chat-prompt-option"
              aria-current={index === active ? 'true' : undefined}
              className={cn(
                'flex items-start gap-1 rounded px-1 py-0.5',
                index === active ? 'bg-sunk' : 'hover:bg-sunk',
              )}
            >
              <button
                type="button"
                data-testid="chat-prompt-use"
                // Keeps the focus in the box, so the student can edit the text straight away.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(prompt)}
                className="min-w-0 flex-1 px-1 py-0.5 text-left"
              >
                <span className="block truncate text-[13px] font-medium text-ink">
                  {prompt.title}
                </span>
                <span className="block truncate text-[11px] text-muted">
                  {preview(prompt.body)}
                </span>
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onEdit(prompt)}
                aria-label={`Edit ${prompt.title}`}
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted hover:text-ink"
              >
                Edit
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (armed !== prompt.id) {
                    setArmed(prompt.id);
                    return;
                  }
                  setArmed(null);
                  void onDelete(prompt);
                }}
                aria-label={
                  armed === prompt.id
                    ? `Confirm deleting ${prompt.title}`
                    : `Delete ${prompt.title}`
                }
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-[11px]',
                  armed === prompt.id
                    ? 'bg-warn/10 font-semibold text-warn'
                    : 'text-muted hover:text-ink',
                )}
              >
                {armed === prompt.id ? 'Delete?' : 'Delete'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The name a prompt is saved under, asked for inline under the box. In edit mode it updates the
 * prompt being edited with whatever is in the box now.
 */
export function SavePromptForm({
  initialTitle,
  editing,
  onSubmit,
  onCancel,
}: {
  initialTitle: string;
  editing: boolean;
  onSubmit: (title: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : e instanceof Error && e.message
            ? e.message
            : 'The prompt was not saved. Try again.',
      );
      setBusy(false);
    }
  }

  return (
    <div data-testid="save-prompt-form" className="mt-1.5 grid gap-1">
      <div className="flex items-center gap-1.5">
        <label className="shrink-0 text-[11px] text-muted" htmlFor="save-prompt-title">
          {editing ? 'Update prompt' : 'Save as'}
        </label>
        <input
          id="save-prompt-title"
          // biome-ignore lint/a11y/noAutofocus: opened by the student's own click, to type a name
          autoFocus
          value={title}
          maxLength={80}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            } else if (e.key === 'Escape') {
              onCancel();
            }
          }}
          className="h-7 min-w-0 flex-1 rounded-md border border-line px-2 text-xs"
        />
        <button
          type="button"
          disabled={busy || title.trim().length === 0}
          onClick={() => void submit()}
          className="rounded-md bg-accent px-2 py-1 text-[11px] font-semibold text-accent-ink disabled:opacity-50"
        >
          {editing ? 'Update' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-1.5 py-1 text-[11px] text-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-[11px] text-warn">
          {error}
        </p>
      ) : null}
    </div>
  );
}
