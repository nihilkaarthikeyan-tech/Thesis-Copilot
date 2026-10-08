'use client';

/**
 * The thread under a supervisor's comment (Jenni build plan R22, ADR-0109): the student and the
 * guide answer each other, each may change or take back their own reply, and either can give a
 * thumbs-up. Jenni's comments take replies and reactions; ours could only be resolved.
 *
 * One component for the three places a comment is read — the review panel beside the chapter,
 * the review queue and the guide's page — so a reply written in one reads the same in the others.
 * Every action answers with the comment as it now stands, which the parent swaps into its list.
 *
 * Free: no model, no allowance. Resolving stays where it was (accept, "I have handled this", or a
 * reason in the queue); a thread is the conversation before that, not a new way to close one.
 */

import { ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';

export type ThreadReply = {
  id: string;
  authorEmail: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  thumbs: number;
  thumbedByMe: boolean;
  mine: boolean;
};

export type Threaded = {
  id: string;
  thumbs: number;
  thumbedByMe: boolean;
  replies: ThreadReply[];
};

const REPLY_MAX = 4_000;

/** "asha.k" from "asha.k@university.ac.in" — a narrow column has no room for the address. */
function who(email: string): string {
  return email.split('@')[0] ?? email;
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function CommentThread<T extends Threaded>({
  documentId,
  comment,
  onChange,
  compact = false,
}: {
  documentId: string;
  comment: T;
  /** The comment as the server now has it, thread and thumbs included. */
  onChange: (next: T) => void;
  /** The 18rem review panel: smaller type. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(comment.replies.length > 0);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/documents/${documentId}/feedback/comments/${comment.id}`;
  const text = compact ? 'text-[11px]' : 'text-xs';

  async function send(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const next = await api<T>(`${base}${path}`, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      onChange({ ...comment, ...next });
      return true;
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'That did not work.',
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function reply() {
    const body = draft.trim();
    if (!body) return;
    if (await send('/replies', 'POST', { body })) setDraft('');
  }

  async function saveEdit() {
    if (!editing?.text.trim()) return;
    if (await send(`/replies/${editing.id}`, 'PATCH', { body: editing.text.trim() })) {
      setEditing(null);
    }
  }

  const count = comment.replies.length;

  return (
    <div data-testid="comment-thread" className={`mt-2 ${text}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          data-testid="comment-thumb"
          aria-pressed={comment.thumbedByMe}
          disabled={busy}
          onClick={() => void send('/thumb', 'POST')}
          title={comment.thumbedByMe ? 'Take back your thumbs-up' : 'Thumbs-up'}
          className={`inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-sunk ${
            comment.thumbedByMe ? 'text-accent' : 'text-muted'
          }`}
        >
          <ThumbsUp size={compact ? 12 : 13} aria-hidden />
          {comment.thumbs > 0 ? <span>{comment.thumbs}</span> : null}
          <span className="sr-only">Thumbs-up</span>
        </button>
        <button
          type="button"
          data-testid="comment-reply-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="text-muted underline hover:text-ink"
        >
          {count === 0 ? 'Reply' : `${count} ${count === 1 ? 'reply' : 'replies'}`}
        </button>
      </div>

      {open ? (
        <div className="mt-1.5 grid gap-1.5 border-l-2 border-line pl-2">
          {comment.replies.map((r) => (
            <div key={r.id} data-testid="comment-reply" data-reply-id={r.id}>
              <p className="text-muted">
                <span className="font-semibold text-ink">
                  {r.mine ? 'You' : who(r.authorEmail)}
                </span>{' '}
                · {when(r.createdAt)}
                {r.editedAt ? ' · edited' : ''}
              </p>
              {editing?.id === r.id ? (
                <div className="mt-1">
                  <label className="sr-only" htmlFor={`edit-reply-${r.id}`}>
                    Change your reply
                  </label>
                  <textarea
                    id={`edit-reply-${r.id}`}
                    data-testid="comment-reply-edit-box"
                    rows={2}
                    maxLength={REPLY_MAX}
                    value={editing.text}
                    onChange={(e) => setEditing({ id: r.id, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void saveEdit();
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    className="w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-ink"
                  />
                  <div className="mt-1 flex gap-3">
                    <button
                      type="button"
                      data-testid="comment-reply-save"
                      disabled={busy || !editing.text.trim()}
                      onClick={() => void saveEdit()}
                      className="font-semibold text-accent underline disabled:text-muted"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="text-muted underline"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-0.5 whitespace-pre-wrap text-ink">{r.body}</p>
              )}
              <div className="mt-0.5 flex items-center gap-3 text-muted">
                <button
                  type="button"
                  data-testid="comment-reply-thumb"
                  aria-pressed={r.thumbedByMe}
                  disabled={busy}
                  onClick={() => void send(`/replies/${r.id}/thumb`, 'POST')}
                  className={`inline-flex items-center gap-1 hover:text-ink ${
                    r.thumbedByMe ? 'text-accent' : ''
                  }`}
                >
                  <ThumbsUp size={11} aria-hidden />
                  {r.thumbs > 0 ? <span>{r.thumbs}</span> : null}
                  <span className="sr-only">Thumbs-up</span>
                </button>
                {r.mine && editing?.id !== r.id ? (
                  <>
                    <button
                      type="button"
                      data-testid="comment-reply-edit"
                      onClick={() => setEditing({ id: r.id, text: r.body })}
                      className="underline hover:text-ink"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      data-testid="comment-reply-delete"
                      disabled={busy}
                      onClick={() => void send(`/replies/${r.id}`, 'DELETE')}
                      className="underline hover:text-ink"
                    >
                      Delete
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}

          <div>
            <label className="sr-only" htmlFor={`reply-${comment.id}`}>
              Reply to this comment
            </label>
            <textarea
              id={`reply-${comment.id}`}
              data-testid="comment-reply-box"
              rows={2}
              maxLength={REPLY_MAX}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void reply();
              }}
              placeholder="Reply…"
              className="w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-ink placeholder:text-muted"
            />
            <button
              type="button"
              data-testid="comment-reply-send"
              disabled={busy || !draft.trim()}
              onClick={() => void reply()}
              className="mt-1 rounded-md bg-accent px-2.5 py-1 font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Reply'}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-1 text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
