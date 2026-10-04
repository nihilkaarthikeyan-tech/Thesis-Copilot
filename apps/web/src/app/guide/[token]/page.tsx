'use client';

/**
 * `/guide/:token` — PRD §5.7, Appendix D.2.1, PHASES v2 B2.1.
 *
 * The link a supervisor receives. It is an invitation, not a key: opening it asks them to sign in
 * with the address the student typed, and only then does the API bind the share and hand back the
 * thesis. Everything a guide can do lives on this page — the read-only chapter and a comment box.
 * There is no AI panel, no usage meter, and no way to reach the student's other work.
 */

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { GuideProgress } from './GuideProgress';

type GuideDocument = {
  documentId: string;
  title: string;
  studentEmail: string;
  chapters: Array<{ id: string; title: string; order: number }>;
  /** ADR-0028: this share may also open a chapter in the live editor. */
  canEdit: boolean;
  /** ADR-0057: false for a Reader — no comment box, no comments. */
  canComment: boolean;
};

type ChapterView = { id: string; title: string; content: unknown };

type Comment = {
  id: string;
  chapterId: string | null;
  authorEmail: string;
  body: string;
  quotedText: string | null;
  class: string | null;
  status: string;
  createdAt: string;
  currentText: string | null;
};

type Node = { type?: string; text?: string; content?: Node[] };

/** The chapter as plain paragraphs. A guide reads and comments; they never edit. */
function paragraphsOf(doc: unknown): string[] {
  const out: string[] = [];
  const textOf = (node: Node | undefined): string => {
    if (!node) return '';
    if (node.type === 'text') return node.text ?? '';
    return (node.content ?? []).map(textOf).join('');
  };
  for (const block of (doc as Node | undefined)?.content ?? []) {
    const text = textOf(block).trim();
    if (text) out.push(text);
  }
  return out;
}

export default function GuidePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [document, setDocument] = useState<GuideDocument | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [chapter, setChapter] = useState<ChapterView | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [selection, setSelection] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<GuideDocument>(`/guide/accept/${token}`, { method: 'POST', body: '{}' })
      .then((doc) => {
        setDocument(doc);
        setChapterId(doc.chapters[0]?.id ?? null);
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.problem.status === 401) {
          router.replace(`/sign-in?next=${encodeURIComponent(`/guide/${token}`)}`);
          return;
        }
        setError(
          e instanceof ApiError
            ? (e.problem.detail ?? e.problem.title)
            : 'That link could not be opened.',
        );
      });
  }, [token, router]);

  const loadChapter = useCallback(async () => {
    if (!chapterId || !document) return;
    try {
      const [view, list] = await Promise.all([
        // The guide route, not the student's: /chapters/:id filters on ownership and answered
        // 404 to every supervisor who ever opened a share.
        api<ChapterView>(`/guide/documents/${document.documentId}/chapters/${chapterId}`),
        // ADR-0057: a Reader is refused the comments, so they are not asked for.
        document.canComment
          ? api<Comment[]>(
              `/documents/${document.documentId}/feedback/comments?chapterId=${chapterId}`,
            )
          : Promise.resolve([] as Comment[]),
      ]);
      setChapter(view);
      setComments(list);
    } catch (e) {
      setError(e instanceof ApiError ? e.problem.title : 'Could not load that chapter.');
    }
  }, [chapterId, document]);

  useEffect(() => {
    void loadChapter();
  }, [loadChapter]);

  async function submit() {
    if (!document || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/documents/${document.documentId}/feedback/comments`, {
        method: 'POST',
        body: JSON.stringify({
          chapterId,
          body: body.trim(),
          quotedText: selection,
        }),
      });
      setBody('');
      setSelection(null);
      setNotice('Comment saved. The student sees it in their review queue.');
      await loadChapter();
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !document) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <p role="alert" className="text-sm text-warn">
          {error}
        </p>
        <p className="mt-4 text-sm text-muted">
          If you were sent this link, sign in with the address it was sent to.{' '}
          <Link href="/sign-in" className="underline">
            Sign in
          </Link>
        </p>
      </main>
    );
  }

  if (!document) return <p className="p-6 text-sm text-muted">Opening…</p>;

  const mine = comments.filter((c) => c.chapterId === chapterId);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-balance text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">
          {document.title}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {document.canEdit
            ? `${document.studentEmail} invited you to write this with them. Comment here, or open a chapter to edit it live.`
            : document.canComment
              ? `${document.studentEmail} asked for your comments. This is read-only — select a passage and write what you think; the student sees each comment in their review queue.`
              : `${document.studentEmail} shared this with you to read.`}
        </p>
        {document.canEdit && chapterId ? (
          <Link
            href={`/guide/${token}/write/${chapterId}`}
            data-testid="guide-edit-live"
            className="mt-2 inline-block rounded-md bg-accent px-3 py-1 text-xs font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
          >
            Edit this chapter live
          </Link>
        ) : null}
      </header>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-warn">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-4 text-sm" data-testid="guide-notice">
          {notice}
        </p>
      ) : null}

      {/* Replaces a plain row of chapter buttons. It picks chapters as that did, and also answers
          the question a supervisor opens the page with: what has moved since I last read this? */}
      <div className="mt-6">
        <GuideProgress
          documentId={document.documentId}
          currentChapterId={chapterId}
          onOpenChapter={setChapterId}
        />
      </div>

      <div
        className={
          document.canComment ? 'mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]' : 'mt-6 grid gap-6'
        }
      >
        <article
          className="rounded-md border border-line bg-surface p-5"
          data-testid="guide-chapter"
          onMouseUp={() => {
            if (!document.canComment) return;
            const text = window.getSelection()?.toString().trim() ?? '';
            setSelection(text.length > 3 ? text.slice(0, 2_000) : null);
          }}
        >
          {chapter ? (
            <>
              <h2 className="text-balance text-[20px] font-bold leading-snug tracking-[-0.01em] text-ink">
                {chapter.title}
              </h2>
              {paragraphsOf(chapter.content).map((text, i) => (
                // Paragraphs are positional and read-only; their index is their identity here.
                // biome-ignore lint/suspicious/noArrayIndexKey: read-only positional render
                <p key={`p-${i}`} className="mt-3 leading-relaxed">
                  {text}
                </p>
              ))}
            </>
          ) : (
            <p className="text-sm text-muted">Loading…</p>
          )}
        </article>

        {document.canComment ? (
          <aside>
            <section className="rounded-md border border-line bg-surface p-4">
              <h2 className="eyebrow">Add a comment</h2>
              {selection ? (
                <p className="mt-2 rounded border-l-2 border-accent bg-paper px-2 py-1 text-xs text-muted">
                  “{selection.slice(0, 200)}
                  {selection.length > 200 ? '…' : ''}”
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted">
                  Select text in the chapter to attach your comment to it, or leave it unattached
                  for a comment about the chapter as a whole.
                </p>
              )}
              <textarea
                rows={4}
                value={body}
                maxLength={4000}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What should the student change, and why?"
                className="mt-2 w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
              />
              <button
                type="button"
                disabled={busy || body.trim().length === 0}
                onClick={() => void submit()}
                data-testid="add-comment"
                className="mt-2 w-full rounded-md px-3 py-2 text-sm disabled:opacity-50 sm:w-auto bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
              >
                {busy ? 'Saving…' : 'Add comment'}
              </button>
            </section>

            <section className="mt-4">
              <h2 className="eyebrow">
                Comments on this chapter{mine.length ? ` (${mine.length})` : ''}
              </h2>
              {mine.length === 0 ? (
                <p className="mt-2 text-xs text-muted">None yet.</p>
              ) : (
                <ul className="mt-2 space-y-2" data-testid="guide-comments">
                  {mine.map((comment) => (
                    <li
                      key={comment.id}
                      className="rounded-md border border-line bg-surface p-2 text-xs"
                    >
                      {comment.quotedText ? (
                        <p className="border-l-2 border-line pl-2 text-muted">
                          “{comment.quotedText.slice(0, 120)}
                          {comment.quotedText.length > 120 ? '…' : ''}”
                        </p>
                      ) : null}
                      <p className="mt-1">{comment.body}</p>
                      <p className="mt-1 text-muted">
                        {comment.authorEmail} · {new Date(comment.createdAt).toLocaleDateString()} ·{' '}
                        {comment.status === 'OPEN'
                          ? 'awaiting the student'
                          : comment.status.toLowerCase()}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        ) : null}
      </div>
    </main>
  );
}
