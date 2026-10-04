'use client';

/**
 * Your supervisor's comments, on the words they are about (2026-09-21).
 *
 * The review queue at `/review` is where a student works *through* a round of feedback: one
 * comment at a time, j/k, accept or reject, and a response-to-committee table at the end. This is
 * the other half of the same job — the comments visible while you are rewriting the paragraph,
 * with the passage highlighted in the text beside them.
 *
 * ## What it does not do
 *
 * It is not a second review queue. There is no keyboard queue, no rejection-reason flow, no share
 * management; the panel links to `/review` for those, because a rejection has to carry a reason
 * (D.2.4) and that belongs on the screen that produces the committee table.
 *
 * ## The one rule this screen exists to keep
 *
 * Accepting a revision is the only place AI text enters a chapter without the student typing, so
 * it happens on the server (`ReviewService.accept`), which snapshots first and writes `COMMAND`
 * provenance. The panel shows the diff and asks; it never edits the document itself.
 *
 * That puts the saved chapter and the one on screen either side of the operation, so both server
 * actions here **save first**. The server re-finds the passage in what it has stored, and what it
 * has stored is two seconds behind the student on a good day; accepting against a stale chapter
 * either misses the passage or applies the revision to a sentence that has since moved. Saving
 * first also means the reload afterwards costs nothing, because there is nothing unsaved to lose.
 */

import { findPassage, type ReviewAnchor } from '@tc/ui';
import type { Editor } from '@tiptap/core';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { changedRatio, diffKeys, diffWords, isUnchanged, REWRITE } from '@/lib/diff';

export type ReviewComment = {
  id: string;
  chapterId: string | null;
  chapterTitle: string | null;
  authorEmail: string;
  body: string;
  quotedText: string | null;
  class: string | null;
  status: string;
  suggestedRevision: string | null;
  createdAt: string;
  anchor: { from: number; to: number } | null;
  currentText: string | null;
};

const CLASS_LABEL: Record<string, string> = {
  SUBSTANTIVE: 'Substantive',
  CLARIFICATION: 'Clarification',
  MECHANICAL: 'Mechanical',
};

/** Who wrote it, short enough for a 18rem column. */
function shortAuthor(email: string): string {
  return email.split('@')[0] ?? email;
}

export function ReviewPanel({
  documentId,
  chapterId,
  editor,
  activeId,
  onActiveChange,
  save,
  onChapterChanged,
}: {
  documentId: string;
  chapterId: string;
  editor: Editor | null;
  /**
   * Which comment is being read, lifted out of this component because a click on the highlighted
   * passage in the editor selects one too — and two copies of "which one" is one too many.
   */
  activeId: string | null;
  onActiveChange: (commentId: string | null) => void;
  /** Flushes the autosave. Called before anything that reads or rewrites the saved chapter. */
  save: () => Promise<void>;
  /** The server rewrote the chapter; the editor has to reload it or the next save is a 409. */
  onChapterChanged: () => void;
}) {
  const [comments, setComments] = useState<ReviewComment[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Only what this panel draws: the open comments on this chapter (2026-09-28).
      setComments(
        await api<ReviewComment[]>(
          `/documents/${documentId}/feedback/comments?status=OPEN&chapterId=${chapterId}`,
        ),
      );
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.problem.title : 'Could not load the comments.');
    }
  }, [documentId, chapterId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** This chapter's open comments, in the order the queue would show them. */
  const open = useMemo(
    () =>
      (comments ?? [])
        .filter((c) => c.status === 'OPEN' && c.chapterId === chapterId)
        .sort((a, b) => (a.anchor?.from ?? 0) - (b.anchor?.from ?? 0)),
    [comments, chapterId],
  );

  // Draw them. The anchors are recomputed from the live document by the extension, so this only
  // has to run when the list or the selection changes — not on every keystroke.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const anchors: ReviewAnchor[] = open
      .filter((c): c is ReviewComment & { quotedText: string } => Boolean(c.quotedText))
      .map((c) => ({
        id: c.id,
        text: c.quotedText,
        hasSuggestion: Boolean(c.suggestedRevision),
        ...(c.anchor ? { near: c.anchor.from } : {}),
      }));
    editor.commands.setReviewAnchors(anchors, activeId);
  }, [editor, open, activeId]);

  // And take them away when the panel goes, so a highlight does not outlive the tab that drew it.
  useEffect(() => {
    return () => {
      if (editor && !editor.isDestroyed) editor.commands.setReviewAnchors([], null);
    };
  }, [editor]);

  const act = useCallback(
    async (comment: ReviewComment, action: 'accept' | 'suggest' | 'edited') => {
      setBusy(comment.id);
      setError(null);
      try {
        // The server works from the stored chapter; make sure that is the one on screen.
        await save();
        if (action === 'accept') {
          await api(`/documents/${documentId}/feedback/comments/${comment.id}/accept`, {
            method: 'POST',
            body: JSON.stringify({}),
          });
          // The chapter on the server is now a version ahead of the one in the editor.
          onChapterChanged();
        } else if (action === 'suggest') {
          await api(`/documents/${documentId}/feedback/comments/${comment.id}/suggest`, {
            method: 'POST',
            body: JSON.stringify({}),
          });
        } else {
          await api(`/documents/${documentId}/feedback/comments/${comment.id}/resolve`, {
            method: 'POST',
            body: JSON.stringify({ outcome: 'EDITED', note: 'Revised in the editor' }),
          });
        }
        await load();
      } catch (e) {
        setError(
          e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'That did not work.',
        );
      } finally {
        setBusy(null);
      }
    },
    [documentId, load, onChapterChanged, save],
  );

  if (comments === null) return <p className="text-xs text-muted">Loading comments…</p>;

  if (open.length === 0) {
    return (
      <div data-testid="review-panel">
        <p className="text-xs text-muted">
          No open comments on this chapter.{' '}
          <Link href={`/app/d/${documentId}/review`} className="underline">
            The review queue
          </Link>{' '}
          has the rest of the thesis.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="review-panel" className="grid gap-2">
      <p className="eyebrow">
        {open.length} open {open.length === 1 ? 'comment' : 'comments'} here
      </p>

      {error ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft p-2 text-xs">
          {error}
        </p>
      ) : null}

      {open.map((comment) => {
        const found =
          editor && comment.quotedText
            ? findPassage(editor.state.doc, comment.quotedText, comment.anchor?.from)
            : null;
        const active = activeId === comment.id;
        const diff = comment.suggestedRevision
          ? diffWords(comment.currentText ?? '', comment.suggestedRevision)
          : null;

        return (
          <article
            key={comment.id}
            data-testid="review-comment"
            data-comment-id={comment.id}
            className={`rounded-md border p-2 transition-colors ${
              active ? 'border-accent bg-accent-soft' : 'border-line bg-surface'
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-[11px] text-muted">
              <span>{shortAuthor(comment.authorEmail)}</span>
              <span>{CLASS_LABEL[comment.class ?? ''] ?? 'unclassified'}</span>
            </div>

            <p className="mt-1 text-[13px] text-ink">{comment.body}</p>

            {comment.quotedText ? (
              <button
                type="button"
                data-testid="review-goto"
                disabled={!found}
                onClick={() => {
                  onActiveChange(comment.id);
                  editor?.commands.goToReviewAnchor(comment.id);
                }}
                className="mt-1.5 block w-full text-left text-[11px] text-muted disabled:cursor-default"
              >
                {found ? (
                  <span className="border-l-2 border-line pl-2 hover:border-accent">
                    “{comment.quotedText.slice(0, 90)}
                    {comment.quotedText.length > 90 ? '…' : ''}”
                  </span>
                ) : (
                  // The same honesty as the flags panel: never scroll somewhere wrong.
                  <span className="border-l-2 border-warn/50 pl-2">
                    That passage has been rewritten — the comment no longer points anywhere.
                  </span>
                )}
              </button>
            ) : (
              <p className="mt-1.5 text-[11px] text-muted">About the chapter as a whole.</p>
            )}

            {diff && !isUnchanged(diff) ? (
              <div
                data-testid="review-diff"
                className="mt-2 rounded-md border border-line bg-paper p-2 text-[12px] leading-relaxed"
              >
                {changedRatio(diff) > REWRITE ? (
                  // A rewrite. Interleaving two different sentences word by word in an 18rem
                  // column produces something that is neither sentence; show both.
                  <>
                    <p className="text-muted line-through">{comment.currentText}</p>
                    <p className="mt-1 text-ink">{comment.suggestedRevision}</p>
                  </>
                ) : (
                  diffKeys(diff).map(({ op, key }) => (
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
                  ))
                )}
              </div>
            ) : null}

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              {comment.suggestedRevision ? (
                <button
                  type="button"
                  data-testid="review-accept"
                  disabled={busy === comment.id}
                  onClick={() => void act(comment, 'accept')}
                  className="font-semibold text-accent underline disabled:text-muted"
                >
                  {busy === comment.id ? 'Applying…' : 'Accept'}
                </button>
              ) : comment.class === 'SUBSTANTIVE' ? (
                // Same rule as the review queue (2026-10-04): a comment asking for a different
                // argument is the student's to write, so no model revision is offered for it.
                <span className="text-muted" data-testid="review-write-yourself">
                  This one asks you to change an argument — write it yourself.
                </span>
              ) : comment.quotedText ? (
                <button
                  type="button"
                  data-testid="review-suggest"
                  disabled={busy === comment.id}
                  onClick={() => void act(comment, 'suggest')}
                  className="underline disabled:text-muted"
                  // The one action here that spends a cap unit, so it says so.
                  title="Uses one command from your monthly allowance"
                >
                  {busy === comment.id ? 'Thinking…' : 'Suggest a revision'}
                </button>
              ) : null}

              <button
                type="button"
                data-testid="review-edited"
                disabled={busy === comment.id}
                onClick={() => void act(comment, 'edited')}
                className="text-muted underline disabled:text-muted"
              >
                I have handled this
              </button>

              {/* Rejecting asks for a reason, and the reason belongs on the screen that builds the
                  response-to-committee table. */}
              <Link
                href={`/app/d/${documentId}/review`}
                className="ml-auto text-muted underline hover:text-accent"
              >
                Queue
              </Link>
            </div>
          </article>
        );
      })}
    </div>
  );
}
