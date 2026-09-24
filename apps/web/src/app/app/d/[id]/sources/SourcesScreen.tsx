'use client';

/**
 * Stage 2 library — PRD §6.1 `/app/d/:id/sources` and PHASES 1-W2 task 2.8.
 *
 *   "List with status, grounding badge (Full text / Abstract only / Unresolved), year, venue,
 *    citation count, retracted warning; upload button; 'Fix reference' for `UNRESOLVED` (manual
 *    DOI entry → re-resolve); PDF viewer opening at a page (signed URL)."
 *
 * FR-2.2's acceptance criterion is that the badge shows "Full text" against "Abstract only", so the
 * badge is the most prominent thing on each row after the title: it tells the student which sources
 * the AI can actually quote from.
 */

import type { CslAuthor } from '@tc/retrieval';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_URL, ApiError, api } from '@/lib/api';
import { DiscoverPanel } from './DiscoverPanel';

type Source = {
  id: string;
  status: 'PENDING' | 'RESOLVED' | 'UNRESOLVED' | 'FAILED' | string;
  title: string | null;
  authors: CslAuthor[] | null;
  year: number | null;
  venue: string | null;
  doi: string | null;
  groundingLevel: 'NONE' | 'ABSTRACT' | 'FULL_TEXT' | string;
  citationCount: number | null;
  venueCitedness: number | null;
  isPreprint: boolean;
  isRetracted: boolean;
  hasFile: boolean;
  rawReference: string | null;
};

const POLL_MS = 3_000;

export function SourcesScreen({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [sources, setSources] = useState<Source[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'full' | 'unresolved'>('all');
  const [tab, setTab] = useState<'library' | 'discover'>('library');
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [doc, rows] = await Promise.all([
        api<{ title: string }>(`/documents/${documentId}`),
        api<Source[]>(`/documents/${documentId}/sources`),
      ]);
      setTitle(doc.title);
      setSources(rows);
    } catch (e) {
      if (e instanceof ApiError && e.problem.status === 401) router.replace('/sign-in');
      else setError(e instanceof Error ? e.message : 'Could not load the library.');
    }
  }, [documentId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  // References resolve in the background, so keep refreshing while any are still pending.
  const pending = sources?.some((s) => s.status === 'PENDING').valueOf();
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [pending, load]);

  const counts = useMemo(() => {
    const rows = sources ?? [];
    return {
      total: rows.length,
      fullText: rows.filter((s) => s.groundingLevel === 'FULL_TEXT').length,
      unresolved: rows.filter((s) => s.status === 'UNRESOLVED').length,
      pending: rows.filter((s) => s.status === 'PENDING').length,
    };
  }, [sources]);

  const visible = useMemo(() => {
    const rows = sources ?? [];
    if (filter === 'full') return rows.filter((s) => s.groundingLevel === 'FULL_TEXT');
    if (filter === 'unresolved') return rows.filter((s) => s.status === 'UNRESOLVED');
    return rows;
  }, [sources, filter]);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      await api(`/documents/${documentId}/sources/upload`, { method: 'POST', body: form });
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'That upload did not work.',
      );
    } finally {
      setUploading(false);
    }
  }

  // FR-2.9: a .bib/.ris export from Zotero or Mendeley.
  async function importFile(file: File) {
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await api<{
        entries: number;
        skipped: number;
        queued: number;
        alreadyPresent: number;
      }>(`/documents/${documentId}/sources/import`, { method: 'POST', body: form });
      setTab('library');
      setNotice(
        [
          `Imported ${result.queued} of ${result.entries} entries; they are being looked up.`,
          // A silently shorter library is the thing a student notices last and trusts least.
          result.skipped > 0
            ? `${result.skipped} more had no title and no DOI, so there was nothing to look them up by — add those by hand.`
            : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'That import did not work.',
      );
    } finally {
      setImporting(false);
    }
  }

  async function refix(sourceId: string, doi: string) {
    setError(null);
    try {
      await api(`/sources/${sourceId}/refix`, { method: 'POST', body: JSON.stringify({ doi }) });
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not queue that.',
      );
    }
  }

  async function remove(sourceId: string) {
    setError(null);
    try {
      await api(`/sources/${sourceId}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not remove it.',
      );
    }
  }

  async function openPdf(sourceId: string) {
    try {
      const { url } = await api<{ url: string }>(`/sources/${sourceId}/file`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setError('That file could not be opened.');
    }
  }

  if (!sources) return <p className="p-6 text-sm text-muted">Loading the library…</p>;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <nav className="mb-6 flex items-center gap-2 text-sm text-muted">
        <Link href="/app" className="hover:underline">
          Theses
        </Link>
        <span>/</span>
        <span className="text-ink">{title}</span>
        <span>/</span>
        <span>Sources</span>
      </nav>

      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-balance font-serif text-[27px] font-semibold leading-tight text-ink">
            Sources
          </h1>
          <p className="mt-1 text-sm text-muted">
            {counts.total} in the library · {counts.fullText} with full text
            {counts.pending > 0 ? ` · ${counts.pending} still looking up` : ''}
            {counts.unresolved > 0 ? ` · ${counts.unresolved} need a hand` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* The way out. Plain links, so the browser downloads the file the server names: the
              session cookie goes with a top-level navigation, and nothing has to be stored. */}
          {counts.total > 0 ? (
            <span
              className="flex items-center gap-1.5 rounded-md border border-line px-3 py-2 text-sm"
              data-testid="library-export"
            >
              <span className="text-muted">Export</span>
              {(['bib', 'ris', 'csv'] as const).map((format) => (
                <a
                  key={format}
                  href={`${API_URL}/api/v1/documents/${documentId}/sources/export?format=${format}`}
                  className="font-semibold text-accent underline"
                  data-testid={`library-export-${format}`}
                  title={
                    format === 'bib'
                      ? 'BibTeX, for LaTeX and any reference manager'
                      : format === 'ris'
                        ? 'RIS, for Zotero, Mendeley and EndNote'
                        : 'A spreadsheet of the whole library'
                  }
                >
                  .{format}
                </a>
              ))}
            </span>
          ) : null}
          <label className="cursor-pointer rounded-md border border-line px-3 py-2 text-sm hover:bg-paper">
            {importing ? 'Importing…' : 'Import .bib / .ris'}
            <input
              type="file"
              accept=".bib,.bibtex,.ris"
              className="hidden"
              disabled={importing}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importFile(file);
              }}
            />
          </label>
          <label className="cursor-pointer rounded-md border border-line px-3 py-2 text-sm hover:bg-paper">
            {uploading ? 'Uploading…' : 'Add a PDF'}
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </label>
        </div>
      </div>

      <div className="mt-6 flex border-b border-line text-sm">
        {(
          [
            ['library', 'Library'],
            ['discover', 'Discover'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-4 py-2 ${tab === key ? 'border-b-2 border-ink font-medium' : 'text-muted'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {notice ? (
        <p role="status" className="mt-4 text-sm">
          {notice}
        </p>
      ) : null}

      {tab === 'discover' ? (
        <DiscoverPanel
          documentId={documentId}
          hasLibrary={counts.total - counts.pending - counts.unresolved > 0}
          onAdded={() => void load()}
        />
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn"
        >
          {error}
        </p>
      ) : null}

      {tab === 'library' ? (
        <>
          <div className="mt-6 flex gap-2 text-sm">
            {(
              [
                ['all', `All ${counts.total}`],
                ['full', `Full text ${counts.fullText}`],
                ['unresolved', `Needs a hand ${counts.unresolved}`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-md px-3 py-1 ${filter === key ? 'bg-accent text-accent-ink font-semibold' : 'border border-line text-muted hover:border-line-strong hover:text-ink'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="mt-10 rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">
              {counts.total === 0
                ? 'Nothing here yet. Upload your paper on the proposal screen and its references land here automatically.'
                : 'Nothing matches that filter.'}
            </p>
          ) : (
            <ul className="mt-6 divide-y divide-line rounded-md border border-line">
              {visible.map((source) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  onRefix={refix}
                  onRemove={remove}
                  onOpen={openPdf}
                />
              ))}
            </ul>
          )}
        </>
      ) : null}
    </main>
  );
}

function GroundingBadge({ source }: { source: Source }) {
  // FR-2.2 AC: the badge says whether the AI can quote passages or only the abstract.
  if (source.status === 'UNRESOLVED') {
    return <Badge tone="warn">Not found</Badge>;
  }
  if (source.status === 'PENDING') {
    return <Badge tone="muted">Looking it up…</Badge>;
  }
  if (source.groundingLevel === 'FULL_TEXT') {
    return <Badge tone="good">Full text</Badge>;
  }
  return <Badge tone="muted">Abstract only</Badge>;
}

function Badge({ tone, children }: { tone: 'good' | 'muted' | 'warn'; children: React.ReactNode }) {
  const tones = {
    good: 'bg-accent/10 text-accent border-accent/30',
    muted: 'bg-paper text-muted border-line',
    warn: 'bg-warn/10 text-warn border-warn/30',
  } as const;
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${tones[tone]}`}>
      {children}
    </span>
  );
}

function authorLine(authors: CslAuthor[] | null): string {
  if (!authors || authors.length === 0) return '';
  const names = authors.map((a) => a.family ?? a.literal ?? '').filter(Boolean);
  if (names.length === 0) return '';
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}

function SourceRow({
  source,
  onRefix,
  onRemove,
  onOpen,
}: {
  source: Source;
  onRefix: (id: string, doi: string) => void;
  onRemove: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const [fixing, setFixing] = useState(false);
  const [doi, setDoi] = useState('');

  const meta = [
    source.year ? String(source.year) : null,
    source.venue,
    source.citationCount !== null ? `${source.citationCount} citations` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  // ADR-0022. OpenAlex's figure, named as OpenAlex's — not Clarivate's Journal Impact Factor.
  const citedness =
    source.venueCitedness !== null && source.venueCitedness !== undefined
      ? source.venueCitedness.toFixed(1)
      : null;

  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium">{source.title ?? source.rawReference ?? 'Untitled source'}</p>
          {authorLine(source.authors) ? (
            <p className="text-sm text-muted">{authorLine(source.authors)}</p>
          ) : null}
          {meta || citedness ? (
            <p className="text-xs text-muted">
              {meta}
              {citedness ? (
                <span
                  data-testid="journal-citedness"
                  title="The journal's 2-year mean citedness, from OpenAlex: citations last year to what it published in the two years before, per paper. It is the idea behind an impact factor, computed on OpenAlex's data — not Clarivate's Journal Impact Factor."
                >
                  {meta ? ' · ' : ''}journal citedness {citedness}
                </span>
              ) : null}
            </p>
          ) : null}

          {source.isRetracted ? (
            <p className="mt-1 text-xs font-medium text-warn">
              This paper has been retracted. Do not cite it without saying so.
            </p>
          ) : null}
          {source.isPreprint ? (
            <p className="mt-1 text-xs text-muted">Preprint, not peer reviewed.</p>
          ) : null}

          {source.status === 'UNRESOLVED' && source.rawReference ? (
            <p className="mt-1 truncate text-xs text-muted" title={source.rawReference}>
              From your paper: {source.rawReference}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <GroundingBadge source={source} />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        {source.doi ? (
          <a
            className="underline"
            href={`https://doi.org/${source.doi}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {source.doi}
          </a>
        ) : null}
        {source.hasFile ? (
          <button type="button" className="underline" onClick={() => onOpen(source.id)}>
            Open PDF
          </button>
        ) : null}
        {source.status === 'UNRESOLVED' ? (
          <button type="button" className="underline" onClick={() => setFixing((v) => !v)}>
            {fixing ? 'Cancel' : 'Fix this reference'}
          </button>
        ) : null}
        <button
          type="button"
          className="text-muted underline hover:text-warn"
          onClick={() => onRemove(source.id)}
        >
          Remove
        </button>
      </div>

      {fixing ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (doi.trim()) {
              onRefix(source.id, doi.trim());
              setFixing(false);
              setDoi('');
            }
          }}
        >
          <input
            aria-label="DOI"
            placeholder="10.1016/j.enpol.2021.112121"
            className="flex-1 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
            value={doi}
            onChange={(e) => setDoi(e.target.value)}
          />
          <button
            type="submit"
            className="rounded-md px-3 py-1.5 text-sm bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
          >
            Look it up
          </button>
        </form>
      ) : null}
    </li>
  );
}
