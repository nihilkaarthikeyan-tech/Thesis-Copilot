'use client';

/**
 * `/admin/theses/:id` — a student's thesis, read-only, for an administrator (2026-09-29).
 *
 * The owner chose open access: an admin may read a thesis for support or to stop misuse, never
 * change it. Opening this page is logged and emails the student (the privacy page says so, and
 * the banner below says so to the admin). No editor is mounted; the chapter is drawn as HTML.
 */

import '../../../editor.css';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ago, whole } from '@/components/admin/kit';
import { ReadOnlyChapter } from '@/components/admin/ReadOnlyChapter';
import { Card } from '@/components/ui/primitives';
import { isSessionGone, signInUrlFor } from '@/lib/admin-gate';
import { ApiError, api } from '@/lib/api';

type Thesis = {
  id: string;
  title: string;
  citationStyle: string;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; email: string; name: string | null };
  words: number;
  writtenByStudentShare: number | null;
  sources: number;
  shares: number;
  studentEmailed: boolean;
  chapters: Array<{ id: string; title: string; order: number; wordCount: number }>;
};

type Chapter = {
  id: string;
  title: string;
  content: unknown;
  citeLabels: Record<string, string>;
};

export default function AdminThesisPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [thesis, setThesis] = useState<Thesis | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Thesis>(`/admin/theses/${id}`)
      .then((t) => {
        setThesis(t);
        setChapterId(t.chapters[0]?.id ?? null);
      })
      .catch((e: unknown) => {
        if (isSessionGone(e)) router.replace(signInUrlFor(`/admin/theses/${id}`));
        else
          setError(
            e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not open it.',
          );
      });
  }, [id, router]);

  useEffect(() => {
    if (!chapterId) return;
    setChapter(null);
    api<Chapter>(`/admin/theses/${id}/chapters/${chapterId}`)
      .then(setChapter)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.problem.title : 'Could not load that chapter.'),
      );
  }, [id, chapterId]);

  const firstName = thesis?.owner.name?.trim().split(/\s+/)[0];
  const who = firstName || thesis?.owner.email || 'the student';
  const whoShort = firstName || 'the student';

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      {thesis ? (
        <p
          role="note"
          data-testid="admin-read-only-banner"
          className="mb-5 rounded-md border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-ink"
        >
          <strong>Read-only view.</strong> You are looking at {who}&rsquo;s thesis as an
          administrator. This visit is logged
          {thesis.studentEmailed ? `, and ${whoShort} is emailed that it happened` : ''}. Nothing
          here can be changed.
        </p>
      ) : null}

      <nav className="text-xs text-muted" aria-label="Breadcrumb">
        <Link href="/admin/users" className="hover:underline">
          Users
        </Link>
        {thesis ? (
          <>
            {' / '}
            <Link href={`/admin/users/${thesis.owner.id}`} className="hover:underline">
              {thesis.owner.email}
            </Link>
            {' / Theses'}
          </>
        ) : null}
      </nav>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {!thesis && !error ? <p className="mt-6 text-sm text-muted">Opening…</p> : null}

      {thesis ? (
        <>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <h1 className="max-w-[48ch] text-balance text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink">
              {thesis.title}
            </h1>
            <Link
              href={`/admin/users/${thesis.owner.id}`}
              className="text-sm font-semibold text-accent hover:underline"
            >
              Back to {firstName || 'the account'}
            </Link>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[13rem_1fr_14rem]">
            <nav aria-label="Chapters" className="lg:sticky lg:top-6 lg:self-start">
              <p className="eyebrow">Chapters</p>
              <ol className="mt-2 flex gap-1 overflow-x-auto lg:block lg:space-y-0.5">
                {thesis.chapters.map((c) => (
                  <li key={c.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => setChapterId(c.id)}
                      aria-current={c.id === chapterId ? 'true' : undefined}
                      className={`w-full rounded-md px-2.5 py-1.5 text-left text-[13px] ${
                        c.id === chapterId
                          ? 'bg-accent-soft font-semibold text-accent'
                          : 'text-muted hover:bg-sunk hover:text-ink'
                      }`}
                    >
                      {c.order}. {c.title}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>

            <Card className="min-w-0 px-5 py-6 sm:px-8">
              {thesis.chapters.length === 0 ? (
                <p className="text-sm text-muted">This thesis has no chapters yet.</p>
              ) : chapter ? (
                <ReadOnlyChapter content={chapter.content} citeLabels={chapter.citeLabels} />
              ) : (
                <p className="text-sm text-muted">Loading the chapter…</p>
              )}
            </Card>

            <Card className="self-start p-4 text-sm">
              <p className="font-bold text-ink">About this thesis</p>
              <dl className="mt-3 space-y-2">
                {[
                  ['Words', whole(thesis.words)],
                  [
                    `Written by ${whoShort}`,
                    thesis.writtenByStudentShare === null
                      ? '—'
                      : `${thesis.writtenByStudentShare}%`,
                  ],
                  ['Sources', whole(thesis.sources)],
                  ['Style', thesis.citationStyle.toUpperCase()],
                  ['Shared with', `${thesis.shares} guide${thesis.shares === 1 ? '' : 's'}`],
                  ['Last change', ago(thesis.updatedAt)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-muted">{label}</dt>
                    <dd className="tnum text-right font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>
        </>
      ) : null}
    </main>
  );
}
