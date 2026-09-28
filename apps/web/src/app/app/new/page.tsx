'use client';

/**
 * `/app/new` — the chooser (PHASES 6.3): "Path A vs Path B with one-line explanation each."
 *
 * Both paths end on the same proposal screen (FR-1.4); the choice is only where the first
 * material comes from — a paper the student has written, or a topic they describe.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api';

type EntryPath = 'A_TOPIC' | 'B_PAPER';

const PATHS: Array<{ value: EntryPath; name: string; line: string; next: string }> = [
  {
    value: 'B_PAPER',
    name: 'Start from a paper I have written',
    line: 'Upload it; the proposal, glossary and starting library are read out of it.',
    next: 'You will upload the paper next.',
  },
  {
    value: 'A_TOPIC',
    name: 'Start from a topic',
    line: 'A short conversation — two or three questions — narrows it into a proposal skeleton.',
    next: 'You will describe the topic in a sentence next.',
  },
];

export default function NewThesisPage() {
  const router = useRouter();
  const [entryPath, setEntryPath] = useState<EntryPath>('B_PAPER');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const document = await api<{ id: string }>('/documents', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), entryPath }),
      });
      router.push(`/app/d/${document.id}/proposal`);
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not create it.',
      );
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <nav className="text-xs text-muted">
        <Link href="/app" className="hover:underline">
          Theses
        </Link>{' '}
        / New
      </nav>
      <h1 className="mt-2 text-balance text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">
        Where does this thesis start?
      </h1>

      <form onSubmit={create} className="mt-6 space-y-4">
        <fieldset className="space-y-3">
          <legend className="sr-only">Starting point</legend>
          {PATHS.map((path) => (
            <label
              key={path.value}
              className={`block cursor-pointer rounded-lg border p-4 ${
                entryPath === path.value ? 'border-ink bg-surface' : 'border-line bg-paper'
              }`}
            >
              <span className="flex items-start gap-3">
                <input
                  type="radio"
                  name="entryPath"
                  value={path.value}
                  checked={entryPath === path.value}
                  onChange={() => setEntryPath(path.value)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-medium">{path.name}</span>
                  <span className="block text-sm text-muted">{path.line}</span>
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="rounded-md border border-line bg-surface p-4">
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
            className="mt-1 h-10 w-full rounded-md border border-line px-3 text-sm"
            placeholder={
              entryPath === 'A_TOPIC'
                ? 'e.g. Drip irrigation uptake among smallholders'
                : 'e.g. the title of your paper'
            }
          />
          <p className="mt-1 text-xs text-muted">
            {PATHS.find((p) => p.value === entryPath)?.next} You can change the title later.
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-warn">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={busy || title.trim().length === 0}>
          {busy ? 'Creating…' : 'Continue'}
        </Button>
      </form>
    </main>
  );
}
