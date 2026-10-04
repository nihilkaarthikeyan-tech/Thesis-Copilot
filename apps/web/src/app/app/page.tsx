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
import { LogoMark } from '@/components/LogoMark';
import { NextAction } from '@/components/NextAction';
import { FirstRunHint } from '@/components/onboarding/FirstRunHint';
import {
  StartingStyle,
  type StartingStyleChoice,
  saveStartingStyle,
} from '@/components/onboarding/StartingStyle';
import { SetupChecklist } from '@/components/SetupChecklist';
import { TrialNotice } from '@/components/TrialNotice';
import { ThemeToggle } from '@/components/theme';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
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
import { signOut, useSession } from '@/lib/auth-client';
import { type LastChapter, readLastChapter } from '@/lib/last-chapter';

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
  const session = useSession();
  // The admin screens are SUPERADMIN-only; the link is the only way a student home says so.
  const isAdmin = (session.data?.user as { role?: string } | undefined)?.role === 'SUPERADMIN';
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  /** The chapter last open in this browser, offered first (2026-10-04, from the Jenni study). */
  const [lastChapter, setLastChapter] = useState<LastChapter | null>(null);
  useEffect(() => {
    setLastChapter(readLastChapter());
  }, []);
  const [title, setTitle] = useState('');
  const [entryPath, setEntryPath] = useState<'A_TOPIC' | 'B_PAPER'>('B_PAPER');
  const [citationStyle, setCitationStyle] = useState<StartingStyleChoice>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The thesis the student asked to delete, while the confirmation is open (2026-09-29). */
  const [deleting, setDeleting] = useState<DocumentSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  /**
   * With theses on the list, the new-thesis form waits behind "Start another thesis" below them
   * (2026-10-04, from the Jenni journey study): a returning student came back to a form, not to
   * their work. `?new=1` opens it, so a link can still go straight to creating one. Read from
   * `window` after mount rather than `useSearchParams`, which would need a Suspense boundary.
   */
  const [formOpen, setFormOpen] = useState(false);
  const [focusForm, setFocusForm] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('new') === '1') setFormOpen(true);
  }, []);
  useEffect(() => {
    if (formOpen && focusForm) document.getElementById('title')?.focus();
  }, [formOpen, focusForm]);
  /** ADR-0057: the thesis being copied, while the copy is made. */
  const [copying, setCopying] = useState<string | null>(null);

  // The administrator's home is the admin screen, not a student's thesis list (2026-09-29, the
  // owner's instruction). Every sign-in — code, password or Google — lands on `/app`, so this one
  // redirect covers them all.
  useEffect(() => {
    if (isAdmin) router.replace('/admin');
  }, [isAdmin, router]);

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
      const created = await api<{ id: string }>('/documents', {
        method: 'POST',
        body: JSON.stringify({ title, entryPath }),
      });
      await saveStartingStyle(created.id, citationStyle);
      // Straight on to the proposal (2026-10-04): creating used to clear the field and leave the
      // student on this list, choosing between nine links on the new card.
      router.push(`/app/d/${created.id}/proposal`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the document.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(doc: DocumentSummary) {
    setDeleteBusy(true);
    setError(null);
    try {
      await api(`/documents/${doc.id}`, { method: 'DELETE' });
      setDeleting(null);
      await load();
    } catch (e) {
      setDeleting(null);
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'Could not delete the thesis. Try again.',
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  /**
   * ADR-0057: "Make a copy". The copy has its own chapters, outline and library, none of the
   * original's shares or comments, and costs no AI allowance. It lands at the top of the list.
   */
  async function copy(doc: DocumentSummary) {
    setCopying(doc.id);
    setError(null);
    try {
      await api(`/documents/${doc.id}/copy`, { method: 'POST', body: '{}' });
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'Could not copy the thesis. Try again.',
      );
    } finally {
      setCopying(null);
    }
  }

  /** The stages of PRD §6.1, in the order a thesis actually moves through them. */
  const stages = (id: string) => [
    { href: `/app/d/${id}/proposal`, label: 'Proposal' },
    { href: `/app/d/${id}/sources`, label: 'Sources' },
    { href: `/app/d/${id}/outline`, label: 'Outline' },
    { href: `/app/d/${id}/review`, label: 'Review' },
    { href: `/app/d/${id}/submit`, label: 'Submit' },
  ];
  /**
   * Used less often, so behind "More" (2026-10-04): ten links on every card made the one a
   * student wants most — writing — the ninth thing to read.
   */
  const moreStages = (id: string) => [
    // ADR-0039: a chapter planned, written, checked and delivered as drafts to accept.
    { href: `/app/d/${id}/build`, label: 'Build a chapter' },
    // ADR-0040: a grounded, un-metered ranking of where to submit.
    { href: `/app/d/${id}/journals`, label: 'Journals' },
    // ADR-0030: after submission comes the defence.
    { href: `/app/d/${id}/viva`, label: 'Viva practice' },
  ];
  /** The chapter to write in: the last one open here for this thesis, else the first. */
  const writeHref = (d: DocumentSummary) =>
    lastChapter?.documentId === d.id
      ? `/app/d/${d.id}/write/${lastChapter.chapterId}`
      : `/app/d/${d.id}/write/${d.firstChapterId ?? 'none'}`;
  const continueWith =
    lastChapter && documents?.some((d) => d.id === lastChapter.documentId) ? lastChapter : null;

  /** Above the empty list for a first thesis; below the list, on request, for another. */
  const createForm = (
    <Card className="mt-4" data-testid="new-thesis-form">
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

          <StartingStyle value={citationStyle} onChange={setCitationStyle} />

          <Button type="submit" disabled={busy || title.trim().length === 0} className="self-start">
            {busy ? 'Creating…' : 'Create thesis'}
          </Button>
        </form>
      </CardBody>
    </Card>
  );

  // Until the session says who this is, show nothing rather than flash a student's list at an
  // administrator on their way to /admin.
  if (session.isPending || isAdmin) {
    return <div className="min-h-dvh" aria-busy="true" />;
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[16px] font-bold tracking-tight"
          >
            <LogoMark size={22} />
            Thesis Copilot
          </Link>
          <nav className="flex items-center gap-1">
            <ThemeToggle className="mr-1 hidden sm:inline-flex" />
            {isAdmin ? (
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin" data-testid="admin-link">
                  Admin
                </Link>
              </Button>
            ) : null}
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

        {continueWith ? (
          <Card className="mt-6 border-accent/40" data-testid="continue-writing">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="eyebrow">Continue writing</div>
                <p className="mt-1 truncate text-[15px] font-semibold text-ink">
                  {continueWith.documentTitle}
                </p>
                <p className="truncate text-[12.5px] text-muted">{continueWith.chapterTitle}</p>
              </div>
              <Button asChild size="sm">
                <Link href={`/app/d/${continueWith.documentId}/write/${continueWith.chapterId}`}>
                  Continue writing
                </Link>
              </Button>
            </div>
          </Card>
        ) : null}

        <TrialNotice className="mt-6" />

        {documents && documents.length === 0 ? (
          <FirstRunHint id="list" className="mt-6">
            Step 1 of 3: name the thesis and say whether it grows from a paper you have written. You
            can change the title later; nothing here is final.
          </FirstRunHint>
        ) : null}

        {documents && documents.length === 0 ? <div className="mt-6">{createForm}</div> : null}

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
                            href={writeHref(d)}
                            className="text-[16px] font-bold text-ink hover:text-accent"
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
                          <Button asChild size="sm">
                            <Link href={writeHref(d)}>Write</Link>
                          </Button>
                          {stages(d.id).map((stage) => (
                            <Link
                              key={stage.label}
                              href={stage.href}
                              className="text-muted hover:text-accent"
                            >
                              {stage.label}
                            </Link>
                          ))}
                          <details className="relative">
                            <summary className="cursor-pointer list-none text-muted hover:text-accent">
                              More
                            </summary>
                            <div className="absolute right-0 z-10 mt-1 flex w-40 flex-col gap-1 rounded-md border border-line bg-surface p-2 shadow-lg">
                              {moreStages(d.id).map((stage) => (
                                <Link
                                  key={stage.label}
                                  href={stage.href}
                                  className="text-muted hover:text-accent"
                                >
                                  {stage.label}
                                </Link>
                              ))}
                              <button
                                type="button"
                                disabled={copying !== null}
                                onClick={() => void copy(d)}
                                data-testid="copy-thesis"
                                className="text-left text-muted hover:text-accent disabled:opacity-50"
                              >
                                {copying === d.id ? 'Copying…' : 'Make a copy'}
                              </button>
                            </div>
                          </details>
                          <button
                            type="button"
                            onClick={() => setDeleting(d)}
                            className="text-muted hover:text-danger"
                            aria-label={`Delete “${d.title}”`}
                            data-testid="delete-thesis"
                          >
                            Delete
                          </button>
                        </nav>
                      </div>
                      <div className="border-t border-line px-4 py-2">
                        <NextAction documentId={d.id} compact />
                      </div>
                      {/* Below the recommendation, and only until it is finished: the arc is for
                          somebody who has not seen the product, and the next action is for
                          everybody after that. */}
                      <div className="px-4 pb-3">
                        <SetupChecklist documentId={d.id} />
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {documents && documents.length > 0 ? (
          <section className="mt-8" data-testid="start-another">
            {formOpen ? (
              <>
                <h2 className="text-[15px] font-semibold text-ink">Start another thesis</h2>
                {createForm}
              </>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  setFormOpen(true);
                  setFocusForm(true);
                }}
              >
                Start another thesis
              </Button>
            )}
          </section>
        ) : null}

        <Dialog
          open={deleting !== null}
          onClose={() => setDeleting(null)}
          title="Delete this thesis?"
          testId="delete-thesis-dialog"
        >
          <p className="text-muted">
            “{deleting?.title}”, with its chapters, sources, versions and files, is removed for
            good. Export a copy first if you want one.
          </p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {deleting ? (
              <Button asChild variant="secondary">
                <Link href={`/app/d/${deleting.id}/submit`}>Export .docx first</Link>
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={deleteBusy}
              onClick={() => deleting && void remove(deleting)}
              data-testid="delete-thesis-confirm"
            >
              {deleteBusy ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </Dialog>
      </main>
    </div>
  );
}
