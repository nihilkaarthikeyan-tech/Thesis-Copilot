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

type GuideDocument = {
  documentId: string;
  title: string;
  studentEmail: string;
  chapters: Array<{ id: string; title: string; order: number }>;
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
        api<ChapterView>(`/chapters/${chapterId}`),
        api<Comment[]>(`/documents/${document.documentId}/feedback/comments`),
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
        <h1 className="font-serif text-2xl">{document.title}</h1>
        <p className="mt-1 text-sm text-muted">
          {document.studentEmail} asked for your comments. This is read-only — select a passage and
          write what you think; the student sees each comment in their review queue.
        </p>
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

      <div className="mt-6 flex flex-wrap gap-2 text-sm">
        {document.chapters.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setChapterId(c.id)}
            className={`rounded-md px-3 py-1 ${c.id === chapterId ? 'bg-ink text-white' : 'border border-line'}`}
          >
            {c.order}. {c.title}
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <article
          className="rounded-lg border border-line bg-white p-5"
          data-testid="guide-chapter"
          onMouseUp={() => {
            const text = window.getSelection()?.toString().trim() ?? '';
            setSelection(text.length > 3 ? text.slice(0, 2_000) : null);
          }}
        >
          {chapter ? (
            <>
              <h2 className="font-serif text-xl">{chapter.title}</h2>
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

        <aside>
          <section className="rounded-lg border border-line bg-white p-4">
            <h2 className="text-sm font-medium">Add a comment</h2>
            {selection ? (
              <p className="mt-2 rounded border-l-2 border-accent bg-paper px-2 py-1 text-xs text-muted">
                “{selection.slice(0, 200)}
                {selection.length > 200 ? '…' : ''}”
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted">
                Select text in the chapter to attach your comment to it, or leave it unattached for
                a comment about the chapter as a whole.
              </p>
            )}
            <textarea
              rows={4}
              value={body}
              maxLength={4000}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What should the student change, and why?"
              className="mt-2 w-full rounded-md border border-line px-2 py-1 text-sm"
            />
            <button
              type="button"
              disabled={busy || body.trim().length === 0}
              onClick={() => void submit()}
              data-testid="add-comment"
              className="mt-2 w-full rounded-md bg-ink px-3 py-2 text-sm text-white disabled:opacity-50 sm:w-auto"
            >
              {busy ? 'Saving…' : 'Add comment'}
            </button>
          </section>

          <section className="mt-4">
            <h2 className="text-sm font-medium">
              Comments on this chapter{mine.length ? ` (${mine.length})` : ''}
            </h2>
            {mine.length === 0 ? (
              <p className="mt-2 text-xs text-muted">None yet.</p>
            ) : (
              <ul className="mt-2 space-y-2" data-testid="guide-comments">
                {mine.map((comment) => (
                  <li
                    key={comment.id}
                    className="rounded-md border border-line bg-white p-2 text-xs"
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
      </div>
    </main>
  );
}
