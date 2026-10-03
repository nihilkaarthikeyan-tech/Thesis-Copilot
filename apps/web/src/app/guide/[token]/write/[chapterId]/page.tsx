'use client';

/**
 * `/guide/:token/write/:chapterId` — a co-author's live editor (ADR-0028).
 *
 * Reached from the guide page when the share allows editing. The token is accepted again here,
 * which is what binds the session to the share and says whether editing is allowed at all; the
 * chapter itself arrives over the socket.
 */

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CoAuthorEditor } from '@/components/editor/CoAuthorEditor';
import { ApiError, api } from '@/lib/api';
import '../../../../editor.css';
// Equations in a co-author's editor rendered unstyled: the KaTeX sheet was only on the student's
// write page (ADR-0045).
import 'katex/dist/katex.min.css';

type GuideDocument = {
  documentId: string;
  title: string;
  studentEmail: string;
  chapters: Array<{ id: string; title: string; order: number }>;
  canEdit: boolean;
  viewerEmail: string;
};

export default function CoAuthorPage() {
  const { token, chapterId } = useParams<{ token: string; chapterId: string }>();
  const router = useRouter();
  const [document, setDocument] = useState<GuideDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The accept answers with the viewer's own address too, so nothing here asks the auth routes,
    // which are rate-limited per address (§12.1) and have refused a page for asking.
    api<GuideDocument>(`/guide/accept/${token}`, { method: 'POST', body: '{}' })
      .then(setDocument)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.problem.status === 401) {
          router.replace(
            `/sign-in?next=${encodeURIComponent(`/guide/${token}/write/${chapterId}`)}`,
          );
          return;
        }
        setError(
          e instanceof ApiError
            ? (e.problem.detail ?? e.problem.title)
            : 'That link could not be opened.',
        );
      });
  }, [token, chapterId, router]);

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <p role="alert" className="text-sm text-warn">
          {error}
        </p>
      </main>
    );
  }
  if (!document) return <p className="p-6 text-sm text-muted">Opening…</p>;

  const chapter = document.chapters.find((c) => c.id === chapterId);
  if (!document.canEdit || !chapter) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <p className="text-sm text-muted">
          This share lets you read and comment, not edit.{' '}
          <Link href={`/guide/${token}`} className="underline">
            Back to the thesis
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-4">
        <p className="text-xs text-muted">
          <Link href={`/guide/${token}`} className="underline">
            {document.title}
          </Link>{' '}
          · writing with {document.studentEmail}
        </p>
        <h1 className="mt-1 text-[24px] font-bold leading-tight tracking-[-0.02em] text-ink">
          {chapter.title}
        </h1>
      </header>
      <CoAuthorEditor
        chapterId={chapter.id}
        chapterTitle={chapter.title}
        email={document.viewerEmail}
      />
    </main>
  );
}
