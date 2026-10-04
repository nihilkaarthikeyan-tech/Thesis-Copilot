'use client';

/**
 * `/read/:token` — "anyone with the link can read" (ADR-0057).
 *
 * No sign-in: the link is the permission, and it is only ever a permission to read. The page gets
 * the thesis title, the chapter list and each chapter as headings and paragraphs — the server
 * flattens the text before it leaves, so nothing else from the stored chapter reaches a browser.
 * No comments, no AI, no student e-mail, no sources. When the owner turns the link off, this page
 * says the link does not work, whatever it showed a moment ago.
 */

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';

type LinkDocument = {
  title: string;
  chapters: Array<{ id: string; title: string; order: number }>;
};

type Block = { kind: 'heading'; level: number; text: string } | { kind: 'paragraph'; text: string };

type LinkChapter = { id: string; title: string; blocks: Block[] };

function problemText(e: unknown): string {
  if (e instanceof ApiError && e.problem.status === 404) {
    return 'This link does not work. It may have been turned off by the person who shared it.';
  }
  return e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not open this.';
}

export default function ReadLinkPage() {
  const { token } = useParams<{ token: string }>();
  const [document, setDocument] = useState<LinkDocument | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [chapter, setChapter] = useState<LinkChapter | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<LinkDocument>(`/read/${encodeURIComponent(token)}`)
      .then((doc) => {
        setDocument(doc);
        setChapterId(doc.chapters[0]?.id ?? null);
      })
      .catch((e: unknown) => setError(problemText(e)));
  }, [token]);

  useEffect(() => {
    if (!chapterId) return;
    setChapter(null);
    api<LinkChapter>(`/read/${encodeURIComponent(token)}/chapters/${chapterId}`)
      .then(setChapter)
      .catch((e: unknown) => setError(problemText(e)));
  }, [token, chapterId]);

  if (error && !document) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <p role="alert" className="text-sm text-warn" data-testid="read-error">
          {error}
        </p>
      </main>
    );
  }

  if (!document) return <p className="p-6 text-sm text-muted">Opening…</p>;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <header>
        <p className="eyebrow">Shared to read</p>
        <h1
          className="mt-1 text-balance text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink"
          data-testid="read-title"
        >
          {document.title}
        </h1>
        <p className="mt-1 text-sm text-muted">
          A read-only copy of a thesis in progress, shared by its author.
        </p>
      </header>

      {document.chapters.length > 1 ? (
        <nav aria-label="Chapters" className="mt-6 flex flex-wrap gap-2">
          {document.chapters.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setChapterId(c.id)}
              aria-current={c.id === chapterId ? 'page' : undefined}
              className={`rounded-md border px-2.5 py-1 text-xs ${
                c.id === chapterId
                  ? 'border-accent bg-accent text-accent-ink'
                  : 'border-line bg-surface text-ink hover:bg-sunk'
              }`}
            >
              {c.title}
            </button>
          ))}
        </nav>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 text-sm text-warn">
          {error}
        </p>
      ) : null}

      <article
        className="mt-6 rounded-md border border-line bg-surface p-5"
        data-testid="read-chapter"
      >
        {chapter ? (
          <>
            <h2 className="text-balance text-[20px] font-bold leading-snug tracking-[-0.01em] text-ink">
              {chapter.title}
            </h2>
            {chapter.blocks.map((block, i) =>
              block.kind === 'heading' ? (
                // Blocks are positional and read-only; their index is their identity here.
                // biome-ignore lint/suspicious/noArrayIndexKey: read-only positional render
                <h3 key={`b-${i}`} className="mt-5 text-[16px] font-semibold text-ink">
                  {block.text}
                </h3>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: read-only positional render
                <p key={`b-${i}`} className="mt-3 leading-relaxed">
                  {block.text}
                </p>
              ),
            )}
          </>
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </article>
    </main>
  );
}
