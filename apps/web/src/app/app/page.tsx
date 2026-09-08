'use client';

/**
 * `/app` — the document list (PRD §6.1).
 *
 * An unauthenticated visit is sent to sign-in. The redirect is decided by the API's 401, not by
 * reading the cookie here, so the browser never has to understand the session format.
 *
 * Two bars, not one. The account links (settings, billing, sign out) belong to the session and sit
 * in a top bar; "Your theses" is the page's own heading. Putting both on a single `justify-between`
 * row was what made the links read as a scattered strip with no owner.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { FirstRunHint } from '@/components/onboarding/FirstRunHint';
import { ThemeToggle } from '@/components/theme';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardBody,
  Empty,
  Hint,
  Input,
  Label,
  PageHeader,
} from '@/components/ui/primitives';
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

const ENTRY_PATHS = [
  {
    value: 'B_PAPER',
    label: 'A paper I have written',
    hint: 'It reads the paper and builds the proposal around it',
  },
  {
    value: 'A_TOPIC',
    label: 'A topic',
    hint: 'It checks the literature and helps you find the gap',
  },
] as const;

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

  /** The stages of PRD §6.1, in the order a thesis actually moves through them. */
  const stages = (id: string, firstChapterId: string | null) => [
    { href: `/app/d/${id}/proposal`, label: 'Proposal' },
    { href: `/app/d/${id}/sources`, label: 'Sources' },
    { href: `/app/d/${id}/outline`, label: 'Outline' },
    { href: `/app/d/${id}/review`, label: 'Review' },
    { href: `/app/d/${id}/submit`, label: 'Submit' },
    { href: `/app/d/${id}/write/${firstChapterId ?? 'none'}`, label: 'Write' },
  ];

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3">
          <Link href="/" className="font-serif text-[16px] font-semibold tracking-tight">
            Thesis Copilot
          </Link>
          <nav className="flex items-center gap-1">
            <ThemeToggle className="mr-1 hidden sm:inline-flex" />
            <Button asChild variant="ghost" size="sm">
              <Link href="/app/settings">Settings</Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/app/account">Account</Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut().then(() => router.replace('/sign-in'))}
            >
              Sign out
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <PageHeader
          title="Your theses"
          lede="Each one keeps its own sources, outline and citation style."
          actions={
            <Button asChild variant="secondary" size="sm">
              <Link href="/app/new">Start from a paper</Link>
            </Button>
          }
        />

        {documents && documents.length === 0 ? (
          <FirstRunHint id="list" className="mt-6">
            Step 1 of 3: name the thesis and say whether it grows from a paper you have written. You
            can change the title later; nothing here is final.
          </FirstRunHint>
        ) : null}

        <Card className="mt-6">
          <CardBody>
            <form onSubmit={create} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="title">Working title</Label>
                <Input
                  id="title"
                  name="title"
                  required
                  maxLength={300}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Low-cost solar dryers for smallholder farms"
                />
              </div>

              <fieldset className="flex flex-col gap-2 border-0 p-0">
                <legend className="mb-1 text-[13px] font-semibold text-ink">Start from</legend>
                <div className="flex flex-wrap gap-2">
                  {ENTRY_PATHS.map((option) => {
                    const checked = entryPath === option.value;
                    return (
                      <label
                        key={option.value}
                        className={`flex min-w-[15rem] flex-1 cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 transition-colors ${
                          checked
                            ? 'border-accent bg-accent-soft'
                            : 'border-line hover:border-line-strong'
                        }`}
                      >
                        <input
                          type="radio"
                          name="entryPath"
                          value={option.value}
                          checked={checked}
                          onChange={() => setEntryPath(option.value)}
                          className="mt-0.5 accent-accent"
                        />
                        <span>
                          <span className="block text-[13.5px] font-semibold text-ink">
                            {option.label}
                          </span>
                          <Hint className="mt-0.5">{option.hint}</Hint>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <Button
                type="submit"
                disabled={busy || title.trim().length === 0}
                className="self-start"
              >
                {busy ? 'Creating…' : 'Create thesis'}
              </Button>
            </form>
          </CardBody>
        </Card>

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger"
          >
            {error}
          </p>
        ) : null}

        <section className="mt-8" aria-live="polite">
          {documents === null ? (
            <p className="text-[13px] text-muted">Loading…</p>
          ) : documents.length === 0 ? (
            <Empty title="No theses yet">
              Give one a working title above. You can rename it at any point.
            </Empty>
          ) : (
            <>
              <div className="eyebrow mb-2">
                {documents.length} {documents.length === 1 ? 'thesis' : 'theses'}
              </div>
              <ul className="grid list-none gap-2 p-0">
                {documents.map((d) => (
                  <li key={d.id}>
                    <Card className="transition-colors hover:border-line-strong">
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                        <div className="min-w-0">
                          <Link
                            href={`/app/d/${d.id}/write/${d.firstChapterId ?? 'none'}`}
                            className="font-serif text-[16px] font-semibold text-ink hover:text-accent"
                          >
                            {d.title}
                          </Link>
                          <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted">
                            <Badge tone="neutral">
                              {d.entryPath === 'B_PAPER' ? 'From a paper' : 'From a topic'}
                            </Badge>
                            <span>
                              updated{' '}
                              {new Date(d.updatedAt).toLocaleDateString(undefined, {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </span>
                          </p>
                        </div>
                        <nav className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                          {stages(d.id, d.firstChapterId).map((stage) => (
                            <Link
                              key={stage.label}
                              href={stage.href}
                              className="text-muted hover:text-accent"
                            >
                              {stage.label}
                            </Link>
                          ))}
                        </nav>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
