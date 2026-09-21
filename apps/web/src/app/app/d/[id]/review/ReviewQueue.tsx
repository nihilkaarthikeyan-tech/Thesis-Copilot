'use client';

/**
 * The review queue — PRD §5.7, Appendix D.2.4, PHASES v2 B2.5.
 *
 *   "Ordered by chapter order, then class (SUBSTANTIVE first), then position … Keyboard: j/k next
 *    /previous, a accept, e edit, r reject."
 *
 * A supervisor's comments arrive as a list of things to answer, and the answer is a decision the
 * student makes: accept the suggested wording, write their own, or say why not. Every outcome ends
 * up in the response-to-committee table, including the refusals with their reasons — which is why
 * a rejection asks for ten characters rather than letting the queue be cleared with a click.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { diffKeys, diffWords } from '@/lib/diff';

type Comment = {
  id: string;
  chapterId: string | null;
  chapterTitle: string | null;
  authorEmail: string;
  body: string;
  quotedText: string | null;
  class: string | null;
  status: string;
  suggestedRevision: string | null;
  resolutionNote: string | null;
  createdAt: string;
  anchor: { from: number; to: number } | null;
  currentText: string | null;
};

type Share = {
  id: string;
  guideEmail: string;
  createdAt: string;
  acceptedAt: string | null;
  comments: number;
  url: string;
};

const CLASS_LABEL: Record<string, string> = {
  SUBSTANTIVE: 'Substantive',
  CLARIFICATION: 'Clarification',
  MECHANICAL: 'Mechanical',
};

export function ReviewQueue({ documentId }: { documentId: string }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [guideEmail, setGuideEmail] = useState('');
  const [paste, setPaste] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [list, shareList] = await Promise.all([
        api<Comment[]>(`/documents/${documentId}/feedback/comments`),
        api<Share[]>(`/documents/${documentId}/feedback/shares`),
      ]);
      setComments(list);
      setShares(shareList);
    } catch (e) {
      setError(e instanceof ApiError ? e.problem.title : 'Could not load the comments.');
    }
  }, [documentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (comments ?? []).filter((c) => c.status === 'OPEN');
  const current = open[Math.min(index, Math.max(0, open.length - 1))];

  const act = useCallback(
    async (comment: Comment, action: 'accept' | 'edited' | 'suggest', note?: string) => {
      setBusy(true);
      setError(null);
      try {
        if (action === 'suggest') {
          await api(`/documents/${documentId}/feedback/comments/${comment.id}/suggest`, {
            method: 'POST',
            body: '{}',
          });
          setNotice('A revision is ready to read. Nothing has changed in your chapter yet.');
        } else if (action === 'accept') {
          await api(`/documents/${documentId}/feedback/comments/${comment.id}/accept`, {
            method: 'POST',
            body: '{}',
          });
          setNotice('Applied to the chapter. The previous text is in the version history.');
        } else {
          await api(`/documents/${documentId}/feedback/comments/${comment.id}/resolve`, {
            method: 'POST',
            body: JSON.stringify({ outcome: 'EDITED', note: note ?? 'Revised manually' }),
          });
          setNotice('Marked as revised in your own words.');
        }
        await load();
      } catch (e) {
        setError(
          e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'That did not work.',
        );
      } finally {
        setBusy(false);
      }
    },
    [documentId, load],
  );

  async function reject(comment: Comment) {
    if (reason.trim().length < 10) {
      setError('Say why in at least ten characters — it is printed in your response table.');
      return;
    }
    setBusy(true);
    try {
      await api(`/documents/${documentId}/feedback/comments/${comment.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ outcome: 'REJECTED', note: reason.trim() }),
      });
      setRejecting(null);
      setReason('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  // D.2.4's keyboard map. Ignored while a textarea or input has focus, so typing a rejection
  // reason does not accept the comment behind it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (!current) return;
      if (event.key === 'j') setIndex((i) => Math.min(i + 1, open.length - 1));
      else if (event.key === 'k') setIndex((i) => Math.max(i - 1, 0));
      else if (event.key === 'a' && current.suggestedRevision) void act(current, 'accept');
      else if (event.key === 'e') void act(current, 'edited');
      else if (event.key === 'r') setRejecting(current.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, open.length, act]);

  async function share() {
    if (!guideEmail.trim()) return;
    setBusy(true);
    try {
      await api(`/documents/${documentId}/feedback/shares`, {
        method: 'POST',
        body: JSON.stringify({ guideEmail: guideEmail.trim() }),
      });
      setGuideEmail('');
      setNotice('Sent. They sign in with that address to see the thesis read-only.');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not share.');
    } finally {
      setBusy(false);
    }
  }

  async function importPasted() {
    if (!paste.trim()) return;
    setBusy(true);
    try {
      const result = await api<{ created: number }>(
        `/documents/${documentId}/feedback/comments/paste`,
        { method: 'POST', body: JSON.stringify({ text: paste }) },
      );
      setPaste('');
      setNotice(
        `${result.created} comments added. Assign each to a chapter as you work through them.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not import.');
    } finally {
      setBusy(false);
    }
  }

  /** FR-7.3: a guide who marked up the exported `.docx` in Word rather than using the web view. */
  async function importDocx(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await api<{
        imported: number;
        duplicates: number;
        unanchored: number;
        trackedChanges: number;
      }>(`/documents/${documentId}/feedback/comments/import-docx`, {
        method: 'POST',
        body: form,
      });
      setNotice(
        [
          `${result.imported} comment${result.imported === 1 ? '' : 's'} imported`,
          result.duplicates > 0 ? `${result.duplicates} already here` : '',
          result.unanchored > 0
            ? `${result.unanchored} could not be matched to a paragraph and are listed at chapter level`
            : '',
          result.trackedChanges > 0
            ? `${result.trackedChanges} tracked change${result.trackedChanges === 1 ? '' : 's'} left alone — accept or reject those in Word`
            : '',
        ]
          .filter(Boolean)
          .join(' · '),
      );
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not import.');
    } finally {
      setBusy(false);
    }
  }

  async function completeRound() {
    setBusy(true);
    try {
      const result = await api<{ counts: Record<string, number>; emailed: string[] }>(
        `/documents/${documentId}/feedback/round-complete`,
        { method: 'POST', body: '{}' },
      );
      setNotice(
        result.emailed.length > 0
          ? `Summary sent to ${result.emailed.join(', ')}. A coherence check is running on what changed.`
          : 'Round marked complete. A coherence check is running on what changed.',
      );
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not finish.');
    } finally {
      setBusy(false);
    }
  }

  async function exportTable() {
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>(`/documents/${documentId}/feedback/export`, {
        method: 'POST',
        body: JSON.stringify({ format: 'docx' }),
      });
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not export.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <nav className="text-xs text-muted">
        <Link href="/app" className="hover:underline">
          Theses
        </Link>{' '}
        / Review
      </nav>
      <h1 className="mt-2 text-balance font-serif text-[27px] font-semibold leading-tight text-ink">
        Feedback
      </h1>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-warn">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" data-testid="review-notice" className="mt-4 text-sm">
          {notice}
        </p>
      ) : null}

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <h2 className="eyebrow">Ask your guide for comments</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            type="email"
            value={guideEmail}
            onChange={(e) => setGuideEmail(e.target.value)}
            placeholder="their.email@university.edu"
            aria-label="Guide’s email"
            className="h-9 flex-1 rounded-md border border-line px-2 text-sm"
          />
          <button
            type="button"
            disabled={busy || !guideEmail.trim()}
            onClick={() => void share()}
            className="rounded-md px-3 py-1 text-sm disabled:opacity-50 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
          >
            Send the link
          </button>
        </div>
        {shares.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs" data-testid="shares">
            {shares.map((s) => (
              <li key={s.id} className="flex items-baseline justify-between gap-3">
                <span>
                  {s.guideEmail}
                  <span className="ml-2 text-muted">
                    {s.acceptedAt ? `${s.comments} comments` : 'not opened yet'}
                  </span>
                </span>
                <button
                  type="button"
                  className="underline"
                  onClick={() =>
                    void api(`/documents/${documentId}/feedback/shares/${s.id}`, {
                      method: 'DELETE',
                    })
                      .then(load)
                      .catch(() => setError('Could not revoke that share.'))
                  }
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted">
            Or paste feedback you were sent by email
          </summary>
          <textarea
            rows={4}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="Paste the whole email or list. Each point becomes its own comment."
            className="mt-2 w-full rounded-md border border-line-strong bg-surface px-2 py-1 font-semibold text-ink transition-colors hover:bg-sunk"
          />
          <button
            type="button"
            disabled={busy || !paste.trim()}
            onClick={() => void importPasted()}
            className="mt-1 rounded-md border border-line-strong bg-surface px-3 py-1 font-semibold text-ink transition-colors hover:bg-sunk"
          >
            Split into comments
          </button>
        </details>

        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted">
            Or upload the .docx your guide marked up in Word
          </summary>
          <p className="mt-2 text-muted">
            Every comment in the file comes across with the sentence it was attached to. Tracked
            changes are edits rather than remarks, so they are counted and left alone — accept or
            reject those in Word.
          </p>
          <input
            type="file"
            accept=".docx"
            disabled={busy}
            aria-label="Marked-up Word file"
            data-testid="import-docx"
            className="mt-2 block w-full text-xs"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void importDocx(file);
            }}
          />
        </details>
      </section>

      <section className="mt-6" ref={listRef}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-balance font-serif text-[17px] font-semibold leading-snug text-ink">
            {open.length} to answer
            {comments && comments.length > open.length
              ? ` · ${comments.length - open.length} done`
              : ''}
          </h2>
          <div className="flex gap-3 text-xs">
            <button type="button" className="underline" onClick={() => void completeRound()}>
              Mark round complete
            </button>
            <button type="button" className="underline" onClick={() => void exportTable()}>
              Export the response table
            </button>
          </div>
        </div>
        <p className="mt-1 text-xs text-muted">
          j / k to move · a to accept a suggested revision · e if you rewrote it yourself · r to say
          why you did not change it
        </p>

        {comments === null ? (
          <p className="mt-4 text-sm text-muted">Loading…</p>
        ) : open.length === 0 ? (
          <p className="mt-6 rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">
            Nothing waiting. When your guide comments, each point appears here.
          </p>
        ) : (
          <ul className="mt-4 space-y-3" data-testid="review-queue">
            {open.map((comment, i) => (
              <li
                key={comment.id}
                data-testid="review-item"
                className={`rounded-lg border bg-surface p-4 ${i === index ? 'border-accent' : 'border-line'}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted">
                  <span>
                    {comment.chapterTitle ?? 'The thesis as a whole'} ·{' '}
                    {CLASS_LABEL[comment.class ?? ''] ?? 'unclassified'}
                  </span>
                  <span>
                    {comment.authorEmail} · {new Date(comment.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="mt-2">{comment.body}</p>

                {comment.currentText ? (
                  <p className="mt-2 border-l-2 border-line pl-2 text-sm text-muted">
                    {comment.currentText}
                  </p>
                ) : null}

                {comment.suggestedRevision ? (
                  <div className="mt-3 rounded-md border border-line bg-paper p-2 text-sm">
                    <p className="text-xs text-muted">Suggested revision</p>
                    <p className="mt-1">
                      {diffKeys(
                        diffWords(comment.currentText ?? '', comment.suggestedRevision),
                      ).map(({ op, key }) => (
                        <span
                          key={`${comment.id}-${key}`}
                          className={
                            op.op === 'add'
                              ? 'bg-accent/15'
                              : op.op === 'del'
                                ? 'text-muted line-through'
                                : ''
                          }
                        >
                          {op.text}
                        </span>
                      ))}
                    </p>
                  </div>
                ) : null}

                {rejecting === comment.id ? (
                  <div className="mt-3">
                    <label className="text-xs text-muted" htmlFor={`reason-${comment.id}`}>
                      Why are you not changing this? It is printed in your response table.
                    </label>
                    <textarea
                      id={`reason-${comment.id}`}
                      rows={2}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      className="mt-1 w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
                    />
                    <div className="mt-1 flex gap-2 text-xs">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void reject(comment)}
                        className="rounded-md px-3 py-1 disabled:opacity-50 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
                      >
                        Save the reason
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRejecting(null);
                          setReason('');
                        }}
                        className="underline"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-3 text-xs">
                    {comment.suggestedRevision ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void act(comment, 'accept')}
                        className="rounded-md px-3 py-1 disabled:opacity-50 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
                      >
                        Accept
                      </button>
                    ) : comment.quotedText && comment.class !== 'SUBSTANTIVE' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void act(comment, 'suggest')}
                        className="rounded-md border border-line-strong bg-surface px-3 py-1 font-semibold text-ink transition-colors hover:bg-sunk"
                      >
                        Suggest a revision
                      </button>
                    ) : (
                      <span className="text-muted">
                        {comment.class === 'SUBSTANTIVE'
                          ? 'This one asks you to change an argument — write it yourself.'
                          : 'Not attached to a passage.'}
                      </span>
                    )}
                    {comment.chapterId ? (
                      <Link
                        href={`/app/d/${documentId}/write/${comment.chapterId}`}
                        className="underline"
                      >
                        Open the chapter
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => void act(comment, 'edited')}
                    >
                      I revised it myself
                    </button>
                    <button
                      type="button"
                      className="underline"
                      onClick={() => setRejecting(comment.id)}
                    >
                      Not changing it
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
