'use client';

/**
 * "Highlights and notes" — the side list of what the student has marked in this paper (ADR-0130).
 *
 * Beside the paper on a wide screen; a sheet over its lower part on a phone. Each entry jumps to
 * its passage, changes colour, takes or changes a note, and is deleted with one press. "Put in
 * chat" fills the chat box (the student still sends it) and "Put in my chapter" asks where in the
 * chapter the note goes: nothing leaves this list for a model or the thesis without that press.
 */

import { READER_NOTE_MAX, type ReaderHighlight } from '@tc/types';
import { useEffect, useRef, useState } from 'react';
import { whereLabel } from '@/lib/reader-highlights';
import { type HighlightColour, SWATCHES } from './SelectionMenu';

const DOT: Record<string, string> = Object.fromEntries(
  SWATCHES.map((s) => [s.colour, s.className]),
);

export function HighlightsPanel({
  highlights,
  activeId,
  editingId,
  unplaced,
  onEdit,
  onGo,
  onColour,
  onNote,
  onDelete,
  onChat,
  onChapter,
  onClose,
}: {
  highlights: readonly ReaderHighlight[];
  activeId: string | null;
  /** The entry whose note box is open. */
  editingId: string | null;
  /** Ids of highlights not found in what is on screen now (another view, or a re-read paper). */
  unplaced: ReadonlySet<string>;
  onEdit: (id: string | null) => void;
  onGo: (h: ReaderHighlight) => void;
  onColour: (h: ReaderHighlight, colour: HighlightColour) => void;
  onNote: (h: ReaderHighlight, note: string) => Promise<boolean>;
  onDelete: (h: ReaderHighlight) => void;
  onChat: (h: ReaderHighlight) => void;
  onChapter: (h: ReaderHighlight) => void;
  onClose: () => void;
}) {
  return (
    <aside
      aria-label="Highlights and notes"
      data-testid="reader-highlights"
      className="fixed inset-x-0 bottom-0 z-40 flex max-h-[65dvh] flex-col rounded-t-xl border-t border-line bg-surface shadow-2xl lg:static lg:z-auto lg:max-h-none lg:w-80 lg:shrink-0 lg:rounded-none lg:border-t-0 lg:border-l lg:shadow-none"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-2">
        <h2 className="text-[13px] font-bold text-ink">
          Highlights and notes{' '}
          <span className="tnum font-normal text-muted">({highlights.length})</span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          data-testid="reader-highlights-close"
          className="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-sunk hover:text-ink"
        >
          Close
        </button>
      </div>
      {highlights.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-muted" data-testid="reader-highlights-empty">
          Select a passage in the paper, then choose a colour or Note. Your highlights are kept
          here, for you alone.
        </p>
      ) : (
        <ol className="min-h-0 flex-1 divide-y divide-line overflow-y-auto overscroll-contain">
          {highlights.map((h) => (
            <Entry
              key={h.id}
              h={h}
              active={h.id === activeId}
              editing={h.id === editingId}
              unplaced={unplaced.has(h.id)}
              onEdit={onEdit}
              onGo={onGo}
              onColour={onColour}
              onNote={onNote}
              onDelete={onDelete}
              onChat={onChat}
              onChapter={onChapter}
            />
          ))}
        </ol>
      )}
    </aside>
  );
}

function Entry({
  h,
  active,
  editing,
  unplaced,
  onEdit,
  onGo,
  onColour,
  onNote,
  onDelete,
  onChat,
  onChapter,
}: {
  h: ReaderHighlight;
  active: boolean;
  editing: boolean;
  unplaced: boolean;
  onEdit: (id: string | null) => void;
  onGo: (h: ReaderHighlight) => void;
  onColour: (h: ReaderHighlight, colour: HighlightColour) => void;
  onNote: (h: ReaderHighlight, note: string) => Promise<boolean>;
  onDelete: (h: ReaderHighlight) => void;
  onChat: (h: ReaderHighlight) => void;
  onChapter: (h: ReaderHighlight) => void;
}) {
  const [draft, setDraft] = useState(h.note ?? '');
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const item = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!editing) return;
    setDraft(h.note ?? '');
    requestAnimationFrame(() => {
      box.current?.focus();
      item.current?.scrollIntoView({ block: 'nearest' });
    });
  }, [editing, h.note]);

  useEffect(() => {
    if (active) item.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const link =
    'rounded px-1.5 py-0.5 text-[12px] font-semibold text-accent hover:bg-accent-soft disabled:opacity-50';

  return (
    <li
      ref={item}
      data-testid="reader-highlight-item"
      data-highlight-id={h.id}
      className={`px-4 py-3 ${active ? 'bg-accent-soft' : ''}`}
    >
      <button
        type="button"
        onClick={() => onGo(h)}
        className="flex w-full min-w-0 items-start gap-2 text-left"
        title="Go to this passage"
      >
        <span
          aria-hidden="true"
          className={`mt-1 size-3 shrink-0 rounded-full ring-1 ring-black/15 ${DOT[h.colour] ?? ''}`}
        />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-4 break-words font-serif text-[14px] leading-snug text-ink">
            {h.quote}
          </span>
          <span className="mt-0.5 block text-[11px] text-muted">
            {whereLabel(h)}
            {unplaced ? ' · not found in this view' : ''}
          </span>
        </span>
      </button>

      {editing ? (
        <form
          className="mt-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            const ok = await onNote(h, draft);
            setSaving(false);
            if (ok) onEdit(null);
          }}
        >
          <label className="sr-only" htmlFor={`note-${h.id}`}>
            Your note
          </label>
          <textarea
            id={`note-${h.id}`}
            ref={box}
            data-testid="reader-note-box"
            value={draft}
            maxLength={READER_NOTE_MAX}
            rows={3}
            placeholder="Your note on this passage"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onEdit(null);
              }
            }}
            className="block w-full resize-y rounded-md border border-line-strong bg-paper px-2 py-1.5 text-[13px] text-ink"
          />
          <div className="mt-1 flex items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              data-testid="reader-note-save"
              className="rounded-md bg-accent px-3 py-1 text-[12px] font-bold text-accent-ink hover:bg-accent-hover disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save note'}
            </button>
            <button
              type="button"
              onClick={() => onEdit(null)}
              className="rounded-md px-2 py-1 text-[12px] text-muted hover:bg-sunk hover:text-ink"
            >
              Cancel
            </button>
            <span className="tnum ml-auto text-[11px] text-faint">
              {draft.length}/{READER_NOTE_MAX}
            </span>
          </div>
        </form>
      ) : h.note ? (
        <p
          data-testid="reader-note-text"
          className="mt-2 whitespace-pre-line break-words rounded-md bg-sunk px-2 py-1.5 text-[13px] text-ink"
        >
          {h.note}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1">
        <fieldset className="m-0 mr-1 flex items-center border-0 p-0">
          <legend className="sr-only">Colour</legend>
          {SWATCHES.map((s) => (
            <button
              key={s.colour}
              type="button"
              aria-label={`Make it ${s.label.toLowerCase()}`}
              aria-pressed={h.colour === s.colour}
              onClick={() => (h.colour === s.colour ? undefined : onColour(h, s.colour))}
              className="grid size-6 place-items-center rounded hover:bg-sunk"
            >
              <span
                className={`size-3 rounded-full ${s.className} ${
                  h.colour === s.colour ? 'ring-2 ring-ink/60' : 'ring-1 ring-black/15'
                }`}
              />
            </button>
          ))}
        </fieldset>
        {!editing ? (
          <button
            type="button"
            className={link}
            data-testid="reader-note-edit"
            onClick={() => onEdit(h.id)}
          >
            {h.note ? 'Edit note' : 'Add note'}
          </button>
        ) : null}
        <button
          type="button"
          className={link}
          data-testid="reader-highlight-chat"
          onClick={() => onChat(h)}
        >
          Put in chat
        </button>
        {h.note ? (
          <button
            type="button"
            className={link}
            data-testid="reader-highlight-chapter"
            onClick={() => onChapter(h)}
          >
            Put note in chapter
          </button>
        ) : null}
        <button
          type="button"
          data-testid="reader-highlight-delete"
          onClick={() => onDelete(h)}
          className="rounded px-1.5 py-0.5 text-[12px] font-semibold text-danger hover:bg-danger-soft"
        >
          Delete
        </button>
      </div>
    </li>
  );
}
