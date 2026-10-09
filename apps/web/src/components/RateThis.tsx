'use client';

/**
 * "How was this?" — Jenni build plan R36 (ADR-0115).
 *
 * A thumbs up or down on something the product generated for the student (a chapter build, a viva
 * question set), with an optional one-line note, stored with the run and read by the superadmin
 * in the feedback inbox. The same thumbs, and the same press-again-to-take-it-back, as a chat
 * answer and the suggestion bar have. Free: no model call.
 */

import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';

export type RunRating = { value: 1 | -1; note: string | null } | null;

/** The kinds the API knows (`/documents/:id/ratings/:kind/:runId`). */
export type RatedKind = 'chapter-build' | 'viva';

/** The longest note the API keeps; one line, so it stays a remark rather than a report. */
export const RATING_NOTE_MAX = 200;

export function RateThis({
  documentId,
  kind,
  runId,
  initial,
  question = 'How was this?',
  className,
}: {
  documentId: string;
  kind: RatedKind;
  runId: string;
  initial: RunRating;
  question?: string;
  className?: string;
}) {
  const id = useId();
  const [rating, setRating] = useState<RunRating>(initial);
  const [note, setNote] = useState(initial?.note ?? '');
  /** The note box: offered once a thumb is pressed, and again by "Edit" or "Add a note". */
  const [writing, setWriting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(value: 1 | -1 | 0, line: string | null): Promise<RunRating | undefined> {
    setBusy(true);
    setStatus(null);
    try {
      const saved = await api<{ rating: 1 | -1 | null; note: string | null }>(
        `/documents/${documentId}/ratings/${kind}/${runId}`,
        { method: 'PUT', body: JSON.stringify({ rating: value, ...(line ? { note: line } : {}) }) },
      );
      return saved.rating === null ? null : { value: saved.rating, note: saved.note };
    } catch (e) {
      setStatus(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'Could not save that. Try again.',
      );
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function press(value: 1 | -1) {
    // Pressed again, it is taken back — note and all — as the chat and suggestion thumbs do.
    const next = rating?.value === value ? 0 : value;
    // A note belongs to the rating it was written for: "what went wrong" must not stay attached
    // to a Useful (QA 2026-10-08). Switching thumbs clears it, and the status says so.
    const dropped = next !== 0 && Boolean(rating?.note);
    const saved = await send(next, null);
    if (saved === undefined) return;
    setRating(saved);
    setNote(saved?.note ?? '');
    setWriting(saved !== null && !saved.note);
    setStatus(
      saved === null
        ? 'Taken back.'
        : dropped
          ? 'Saved. Your note was for the other rating, so it was cleared.'
          : 'Thanks — saved.',
    );
  }

  async function saveNote(event: FormEvent) {
    event.preventDefault();
    if (!rating) return;
    const saved = await send(rating.value, note.trim() || null);
    if (saved === undefined) return;
    setRating(saved);
    setWriting(false);
    setStatus('Thanks — saved.');
  }

  const thumb = (value: 1 | -1, label: string) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={rating?.value === value}
      disabled={busy}
      onClick={() => void press(value)}
      data-testid={value === 1 ? 'rate-up' : 'rate-down'}
      className={`rounded border p-1.5 disabled:opacity-50 ${
        rating?.value === value
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-transparent text-muted hover:bg-sunk'
      }`}
    >
      {value === 1 ? <ThumbsUp size={15} aria-hidden /> : <ThumbsDown size={15} aria-hidden />}
    </button>
  );

  return (
    <div
      className={`rounded-md border border-line bg-surface px-3 py-2.5 text-sm ${className ?? ''}`}
      data-testid="rate-this"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-ink">{question}</span>
        <span className="flex items-center gap-0.5">
          {thumb(1, 'Useful')}
          {thumb(-1, 'Not useful')}
        </span>
        <span role="status" className="min-w-0 text-xs text-muted" data-testid="rate-status">
          {status ?? ''}
        </span>
      </div>

      {rating && writing ? (
        <form
          onSubmit={(event) => void saveNote(event)}
          className="mt-2 flex flex-wrap items-center gap-2"
        >
          <label htmlFor={`${id}-note`} className="sr-only">
            One line about it (optional)
          </label>
          <Input
            id={`${id}-note`}
            value={note}
            onChange={(e) => setNote(e.target.value.replace(/[\r\n]+/g, ' '))}
            maxLength={RATING_NOTE_MAX}
            placeholder={
              rating.value === 1 ? 'What worked? (optional)' : 'What went wrong? (optional)'
            }
            className="min-w-0 flex-1 basis-56"
            data-testid="rate-note"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={busy}>
            Send
          </Button>
        </form>
      ) : rating?.note ? (
        <p className="mt-1 text-xs text-muted [overflow-wrap:anywhere]">
          “{rating.note}”{' '}
          <button type="button" onClick={() => setWriting(true)} className="underline">
            Edit
          </button>
        </p>
      ) : rating ? (
        // Rated without a note, or the note was cleared: one can still be added, after a reload too.
        <p className="mt-1 text-xs">
          <button
            type="button"
            onClick={() => setWriting(true)}
            className="text-muted underline"
            data-testid="rate-add-note"
          >
            Add a note
          </button>
        </p>
      ) : null}

      <p className="mt-1 text-xs text-faint">
        Read by the Thesis Copilot team to make this better: your rating, your note and the thesis
        title, never its text.
      </p>
    </div>
  );
}
