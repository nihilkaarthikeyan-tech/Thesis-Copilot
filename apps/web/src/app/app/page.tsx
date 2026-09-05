'use client';

/**
 * `/app` — the document list (PRD §6.1). Phase 0 scope per PHASES task 0.8: create and list only.
 *
 * An unauthenticated visit is sent to sign-in. The redirect is decided by the API's 401, not by
 * reading the cookie here, so the browser never has to understand the session format.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api';
import { signOut } from '@/lib/auth-client';

type DocumentSummary = {
  id: string;
  title: string;
  entryPath: 'A_TOPIC' | 'B_PAPER';
  createdAt: string;
  updatedAt: string;
  /** The chapter the editor opens by default; null only for legacy rows without chapters. */
  firstChapterId: string | null;
};

export default function DocumentListPage() {
  const router = useRouter();
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [title, setTitle] = useState('');
  const [entryPath, setEntryPath] = useState<'A_TOPIC' | 'B_PAPER'>('B_PAPER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDocuments(await api<DocumentSummary[]>('/documents'));
    } catch (e) {
      if (e instanceof ApiError && e.problem.status === 401) {
        router.replace('/sign-in');
        return;
      }
      setError(e instanceof Error ? e.message : 'Could not load your documents.');
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api<DocumentSummary>('/documents', {
        method: 'POST',
        body: JSON.stringify({ title, entryPath }),
      });
      setTitle('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the document.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <header className="flex items-baseline justify-between">
        <h1 className="font-serif text-2xl">Your theses</h1>
        <button
          type="button"
          className="text-xs text-muted underline"
          onClick={() => signOut().then(() => router.replace('/sign-in'))}
        >
          Sign out
        </button>
      </header>

      <form
        onSubmit={create}
        className="mt-8 flex flex-col gap-3 rounded-lg border border-line bg-white p-4"
      >
        <label className="text-sm" htmlFor="title">
          Working title
        </label>
        <input
          id="title"
          name="title"
          required
          maxLength={300}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-10 rounded-md border border-line px-3 text-sm"
          placeholder="e.g. Low-cost solar dryers for smallholder farms"
        />
        <fieldset className="flex gap-4 text-sm">
          <legend className="mb-1 text-sm">Start from</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="entryPath"
              value="B_PAPER"
              checked={entryPath === 'B_PAPER'}
              onChange={() => setEntryPath('B_PAPER')}
            />
            a paper I have written
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="entryPath"
              value="A_TOPIC"
              checked={entryPath === 'A_TOPIC'}
              onChange={() => setEntryPath('A_TOPIC')}
            />
            a topic
          </label>
        </fieldset>
        <Button type="submit" disabled={busy || title.trim().length === 0} className="self-start">
          {busy ? 'Creating…' : 'Create thesis'}
        </Button>
      </form>

      {error ? (
        <p role="alert" className="mt-4 text-sm text-warn">
          {error}
        </p>
      ) : null}

      <section className="mt-8" aria-live="polite">
        {documents === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : documents.length === 0 ? (
          <p className="text-sm text-muted">No theses yet. Create one above.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-white">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <Link
                    href={`/app/d/${d.id}/write/${d.firstChapterId ?? 'none'}`}
                    className="font-medium hover:underline"
                  >
                    {d.title}
                  </Link>
                  <p className="text-xs text-muted">
                    {d.entryPath === 'B_PAPER' ? 'From a paper' : 'From a topic'} · updated{' '}
                    {new Date(d.updatedAt).toLocaleString()}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
