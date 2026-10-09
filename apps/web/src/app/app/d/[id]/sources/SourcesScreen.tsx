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
import { sourceMetricBadges } from '@tc/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddIntoPicker, useAddInto } from '@/components/sources/AddInto';
import { EditDetails } from '@/components/sources/EditDetails';
import { Input } from '@/components/ui/primitives';
import { API_URL, ApiError, api } from '@/lib/api';
import {
  addedSummary,
  type Collection,
  type CollectionFilter,
  collectionCounts,
  inCollection,
  pruneSelection,
  selectionState,
  toggleAll,
} from '@/lib/collections';
import {
  anyFilterOn,
  applyLibraryFilters,
  type LibraryFilters,
  type LibraryKind,
  NO_FILTERS,
} from '@/lib/library-filters';
import { readerHref } from '@/lib/reader';
import { CollectionsStrip } from './CollectionsStrip';
import { DiscoverPanel } from './DiscoverPanel';
import { type DuplicatePair, DuplicatesPanel } from './DuplicatesPanel';
import { LibraryDrawer } from './LibraryDrawer';
import { PasteId } from './PasteId';
import { ZoteroImport, type ZoteroImportResult } from './ZoteroImport';

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
  /** Free to read (true), closed (false), not known (null); `oaStatus` names the route. */
  openAccess?: boolean | null;
  oaStatus?: string | null;
  isPreprint: boolean;
  isRetracted: boolean;
  hasFile: boolean;
  rawReference: string | null;
  /** ADR-0037: added by the system because the library had nothing on a section. */
  autoAddedAt?: string | null;
  /** Why the AI cannot quote it in full, as far as the record shows; null when it can. */
  noFullTextReason?: string | null;
  /** The collections (folders) this paper is in (2026-10-04). */
  collectionIds?: string[];
  /** R17: the CSL type, for the kind filter. */
  type?: string | null;
};

const POLL_MS = 3_000;

export function SourcesScreen({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [sources, setSources] = useState<Source[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'full' | 'missing' | 'unresolved'>('all');
  const [duplicates, setDuplicates] = useState<DuplicatePair[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionFilter, setCollectionFilter] = useState<CollectionFilter>({ kind: 'all' });
  /** Rows ticked for "Add to collection…" / "Remove from collection". */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'library' | 'discover'>('library');
  // `?tab=discover` opens on Discover: the editor's empty library links straight to it. Read after
  // mount — on the server there is no address bar, and a state initialiser runs there.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'discover') setTab('discover');
  }, []);
  /** The chapter to go back to; the screen had no way back to writing (2026-10-04). */
  const [writeHref, setWriteHref] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * R18 (ADR-0105, ADR-0129): "Add into" — the collection every add on this screen files into, or
   * none, kept on the thesis. Papers an add created are found by comparing the library before and
   * after it, so every way in (a file, Zotero, a PDF, an ID) files the same way; ones an add
   * reports by id (an ID already in the library) are filed too. Discover sends it with the add.
   */
  // The strip's own list, so the two never disagree; a collection made here reloads the screen.
  const reloadRef = useRef<() => Promise<unknown>>(async () => undefined);
  const addInto = useAddInto(documentId, {
    collections,
    reload: () => reloadRef.current(),
  });

  const load = useCallback(async (): Promise<Source[] | null> => {
    try {
      const [doc, rows] = await Promise.all([
        api<{ title: string; chapters?: Array<{ id: string }> }>(`/documents/${documentId}`),
        api<Source[]>(`/documents/${documentId}/sources`),
      ]);
      setTitle(doc.title);
      setSources(rows);
      setError(null);
      // Library issues are a side panel: if they cannot be loaded, the library still shows.
      api<DuplicatePair[]>(`/documents/${documentId}/sources/duplicates`)
        .then(setDuplicates)
        .catch(() => setDuplicates([]));
      // Collections likewise: without them the strip is empty and the library still works.
      api<Collection[]>(`/documents/${documentId}/collections`)
        .then(setCollections)
        .catch(() => setCollections([]));
      const first = doc.chapters?.[0]?.id;
      if (first) setWriteHref(`/app/d/${documentId}/write/${first}`);
      return rows;
    } catch (e) {
      if (e instanceof ApiError && e.problem.status === 401) router.replace('/sign-in');
      else setError(e instanceof Error ? e.message : 'Could not load the library.');
      return null;
    }
  }, [documentId, router]);
  reloadRef.current = load;

  const libraryIds = () => new Set((sources ?? []).map((s) => s.id));
  async function fileInto(before: Set<string>, known: string[] = []): Promise<string> {
    const rows = await load();
    const target = addInto.collectionId;
    if (!target || !rows) return '';
    const ids = [...new Set([...rows.filter((r) => !before.has(r.id)).map((r) => r.id), ...known])];
    if (ids.length === 0) return '';
    try {
      await api(`/collections/${target}/sources`, {
        method: 'POST',
        body: JSON.stringify({ sourceIds: ids }),
      });
      const name = addInto.name ?? 'the collection';
      await load();
      return ` Filed in ${name}.`;
    } catch {
      return ' They could not be filed in the collection; add them from the list.';
    }
  }
  useEffect(() => {
    void load();
  }, [load]);

  // References resolve in the background, so keep refreshing while any are still pending — and,
  // R14, for a few minutes after "Fetch PDF", while the open copies are looked for and read.
  const pending = sources?.some((s) => s.status === 'PENDING').valueOf();
  const [fetchingUntil, setFetchingUntil] = useState(0);
  const fetching = fetchingUntil > 0;
  useEffect(() => {
    if (!pending && !fetching) return;
    const timer = setInterval(() => {
      void load();
      if (fetching && Date.now() > fetchingUntil) setFetchingUntil(0);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pending, fetching, fetchingUntil, load]);

  const counts = useMemo(() => {
    const rows = sources ?? [];
    return {
      total: rows.length,
      fullText: rows.filter((s) => s.groundingLevel === 'FULL_TEXT').length,
      missing: rows.filter((s) => s.groundingLevel !== 'FULL_TEXT').length,
      unresolved: rows.filter((s) => s.status === 'UNRESOLVED').length,
      pending: rows.filter((s) => s.status === 'PENDING').length,
      // R14: no PDF at all, so at most the abstract can be quoted.
      noPdf: rows.filter((s) => !s.hasFile && s.status !== 'PENDING').length,
    };
  }, [sources]);

  // A collection that was deleted (here or in another tab) falls back to "All".
  const activeFilter: CollectionFilter = useMemo(
    () =>
      collectionFilter.kind === 'one' && !collections.some((c) => c.id === collectionFilter.id)
        ? { kind: 'all' }
        : collectionFilter,
    [collectionFilter, collections],
  );
  const byCollection = useMemo(() => collectionCounts(sources ?? []), [sources]);

  // The collection chosen in the strip, then the full-text filter, both at once.
  /** R17 (ADR-0104): year, open access and kind, on top of the full-text and collection filters. */
  const [more, setMore] = useState<LibraryFilters>(NO_FILTERS);
  // The year boxes keep what is typed; the filter takes it only once it is a whole year.
  const [yearText, setYearText] = useState({ from: '', to: '' });
  /** R17: the paper the details drawer is showing. */
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const visible = useMemo(() => {
    const rows = applyLibraryFilters(inCollection(sources ?? [], activeFilter), more);
    if (filter === 'full') return rows.filter((s) => s.groundingLevel === 'FULL_TEXT');
    if (filter === 'missing') return rows.filter((s) => s.groundingLevel !== 'FULL_TEXT');
    if (filter === 'unresolved') return rows.filter((s) => s.status === 'UNRESOLVED');
    return rows;
  }, [sources, filter, activeFilter, more]);

  const visibleIds = useMemo(() => visible.map((s) => s.id), [visible]);
  // A ticked row that a filter hides is unticked, so an action never reaches a paper off screen.
  useEffect(() => {
    setSelected((current) => pruneSelection(current, visibleIds));
  }, [visibleIds]);
  const ticked = selectionState(selected, visibleIds);
  const collectionName = (id: string) => collections.find((c) => c.id === id)?.name ?? null;

  async function reloadCollections(message?: string) {
    if (message) setNotice(message);
    await load();
  }

  async function addToCollection(collectionId: string) {
    const ids = [...selected];
    if (ids.length === 0) return;
    setError(null);
    try {
      const result = await api<{ added: number; count: number }>(
        `/collections/${collectionId}/sources`,
        { method: 'POST', body: JSON.stringify({ sourceIds: ids }) },
      );
      setSelected(new Set());
      setNotice(addedSummary(result.added, ids.length, collectionName(collectionId) ?? 'it'));
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not add them.',
      );
    }
  }

  async function removeFromCollection(collectionId: string) {
    const ids = [...selected];
    if (ids.length === 0) return;
    setError(null);
    try {
      const result = await api<{ removed: number }>(`/collections/${collectionId}/sources/remove`, {
        method: 'POST',
        body: JSON.stringify({ sourceIds: ids }),
      });
      setSelected(new Set());
      setNotice(
        `Took ${result.removed} ${result.removed === 1 ? 'paper' : 'papers'} out of ${
          collectionName(collectionId) ?? 'the collection'
        }. ${result.removed === 1 ? 'It is' : 'They are'} still in your library.`,
      );
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not take them out.',
      );
    }
  }

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const before = libraryIds();
      const form = new FormData();
      form.append('file', file);
      await api(`/documents/${documentId}/sources/upload`, { method: 'POST', body: form });
      const filed = await fileInto(before);
      if (filed) setNotice(`PDF added.${filed}`);
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
      const before = libraryIds();
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
          .join(' ') + (await fileInto(before)),
      );
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'That import did not work.',
      );
    } finally {
      setImporting(false);
    }
  }

  /** ADR-0062: the same report as a file import, for a read from Zotero by key. */
  async function zoteroImported(result: ZoteroImportResult) {
    const before = libraryIds();
    setTab('library');
    setError(null);
    const filed = await fileInto(before);
    setNotice(
      [
        `Imported ${result.queued} of ${result.entries} references from Zotero; they are being looked up.`,
        result.alreadyPresent > 0 ? `${result.alreadyPresent} were already in the library.` : '',
        result.skipped > 0
          ? `${result.skipped} had no title and no DOI, so there was nothing to look them up by — add those by hand.`
          : '',
      ]
        .filter(Boolean)
        .join(' ') + filed,
    );
  }

  /** "Add the PDF": the student's copy of a paper we could not read in full, on that exact source. */
  /** R14 (ADR-0101): look again for open-access copies — all papers without a PDF, or one. */
  async function fetchPdfs(sourceIds?: string[]) {
    try {
      const result = await api<{ queued: number; noDoi: number }>(
        `/documents/${documentId}/sources/fetch-pdfs`,
        { method: 'POST', body: JSON.stringify(sourceIds ? { sourceIds } : {}) },
      );
      const parts: string[] = [];
      if (result.queued > 0) {
        parts.push(
          `Looking for open-access copies of ${result.queued} ${result.queued === 1 ? 'paper' : 'papers'}. This list updates as they are found and read; some papers have no free copy anywhere.`,
        );
        setFetchingUntil(Date.now() + 4 * 60_000);
      }
      if (result.noDoi > 0) {
        parts.push(
          `${result.noDoi} ${result.noDoi === 1 ? 'paper has' : 'papers have'} no DOI, so no copy can be looked up: add ${result.noDoi === 1 ? 'its PDF' : 'their PDFs'} yourself.`,
        );
      }
      setNotice(parts.join(' ') || 'Every paper here already has its PDF.');
    } catch (e) {
      setNotice(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : 'Could not start the search.',
      );
    }
  }

  async function attachPdf(sourceId: string, file: File) {
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append('file', file);
      await api(`/sources/${sourceId}/upload`, { method: 'POST', body: form });
      setNotice('PDF added. It is being read now; the badge changes to Full text when it is done.');
      await load();
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'That upload did not work.',
      );
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

  // A failed first load used to leave "Loading the library…" up for good (2026-10-04).
  if (!sources) {
    return error ? (
      <div className="p-6 text-sm">
        <p role="alert" className="text-warn">
          {error}
        </p>
        <button type="button" className="mt-2 underline" onClick={() => void load()}>
          Try again
        </button>
      </div>
    ) : (
      <p className="p-6 text-sm text-muted">Loading the library…</p>
    );
  }

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
        {writeHref ? (
          <Link
            href={writeHref}
            data-testid="back-to-writing"
            className="ml-auto font-medium text-accent hover:underline"
          >
            Back to writing →
          </Link>
        ) : null}
      </nav>

      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-balance text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">
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
          {/* R18 (ADR-0105, ADR-0129): every add below, and Discover's, goes into this
              collection; the choice is kept on the thesis, so the editor offers the same one. */}
          <AddIntoPicker addInto={addInto} />
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
          <ZoteroImport documentId={documentId} onImported={zoteroImported} />
          {/* R16 (ADR-0103): a DOI, arXiv id, PubMed id or ISBN. */}
          <PasteId
            documentId={documentId}
            onImported={(message, sourceId) => {
              const before = libraryIds();
              void fileInto(before, [sourceId]).then((filed) => setNotice(message + filed));
            }}
          />
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
          addInto={addInto.collectionId}
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
          {counts.total > 0 ? (
            <CollectionsStrip
              documentId={documentId}
              collections={collections}
              counts={byCollection}
              total={counts.total}
              filter={activeFilter}
              onFilter={setCollectionFilter}
              onChanged={reloadCollections}
              onError={setError}
            />
          ) : null}

          <div className="mt-6 flex gap-2 text-sm">
            {(
              [
                ['all', `All ${counts.total}`],
                ['full', `Full text ${counts.fullText}`],
                ['missing', `Without full text ${counts.missing}`],
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

          {/* R17 (ADR-0104): narrow the list by year, access and kind. */}
          <div
            className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted"
            data-testid="library-filters"
          >
            <span className="flex items-center gap-1">
              <label htmlFor="filter-year-from">Year</label>
              <Input
                id="filter-year-from"
                inputMode="numeric"
                placeholder="from"
                className="h-8 w-20"
                value={yearText.from}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  setYearText((t) => ({ ...t, from: v }));
                  setMore((m) => ({ ...m, yearFrom: /^\d{4}$/.test(v) ? Number(v) : null }));
                }}
                data-testid="filter-year-from"
              />
              <span>–</span>
              <label htmlFor="filter-year-to" className="sr-only">
                Year to
              </label>
              <Input
                id="filter-year-to"
                inputMode="numeric"
                placeholder="to"
                className="h-8 w-20"
                value={yearText.to}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  setYearText((t) => ({ ...t, to: v }));
                  setMore((m) => ({ ...m, yearTo: /^\d{4}$/.test(v) ? Number(v) : null }));
                }}
                data-testid="filter-year-to"
              />
            </span>
            <span className="flex items-center gap-1">
              <label htmlFor="filter-access">Access</label>
              <select
                id="filter-access"
                value={more.access}
                onChange={(e) =>
                  setMore((m) => ({ ...m, access: e.target.value as LibraryFilters['access'] }))
                }
                className="h-8 rounded-md border border-line-strong bg-surface px-2 text-ink"
                data-testid="filter-access"
              >
                <option value="any">Any</option>
                <option value="open">Open access</option>
                <option value="closed">Not open</option>
              </select>
            </span>
            <span className="flex items-center gap-1">
              <label htmlFor="filter-kind">Kind</label>
              <select
                id="filter-kind"
                value={more.kind}
                onChange={(e) => setMore((m) => ({ ...m, kind: e.target.value as LibraryKind }))}
                className="h-8 rounded-md border border-line-strong bg-surface px-2 text-ink"
                data-testid="filter-kind"
              >
                <option value="any">Any</option>
                <option value="article">Journal articles</option>
                <option value="book">Books</option>
                <option value="chapter">Book chapters</option>
                <option value="conference">Conference papers</option>
                <option value="preprint">Preprints</option>
                <option value="other">Other</option>
              </select>
            </span>
            {anyFilterOn(more) ? (
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setMore(NO_FILTERS);
                  setYearText({ from: '', to: '' });
                }}
                data-testid="filter-clear"
              >
                Clear ({visible.length} shown)
              </button>
            ) : null}
          </div>

          <DuplicatesPanel
            pairs={duplicates}
            onMerged={(message) => {
              setNotice(message);
              void load();
            }}
          />

          {/* R14 (ADR-0101): how many have no PDF, and one press to look for free copies. */}
          {counts.noPdf > 0 && (filter === 'all' || filter === 'missing') ? (
            <div
              className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-sunk px-3 py-2 text-sm"
              data-testid="no-pdf-banner"
            >
              <span>
                {counts.noPdf} {counts.noPdf === 1 ? 'paper has' : 'papers have'} no PDF, so only
                {counts.noPdf === 1 ? ' its abstract' : ' their abstracts'} can be quoted.
              </span>
              <button
                type="button"
                className="font-semibold text-accent underline disabled:opacity-50"
                disabled={fetching}
                onClick={() => void fetchPdfs()}
                data-testid="fetch-pdfs"
              >
                {fetching ? 'Looking…' : 'Fetch open-access copies'}
              </button>
            </div>
          ) : null}
          {filter === 'missing' && visible.length > 0 ? (
            <p className="mt-4 text-sm text-muted">
              The AI can only quote the abstract of these. If you have the paper, add its PDF and it
              will be read in full.
            </p>
          ) : null}

          {visible.length > 0 ? (
            <SelectionBar
              state={ticked}
              count={selected.size}
              collections={collections}
              activeCollectionId={activeFilter.kind === 'one' ? activeFilter.id : null}
              onToggleAll={() => setSelected((current) => toggleAll(current, visibleIds))}
              onAdd={(id) => void addToCollection(id)}
              onRemove={(id) => void removeFromCollection(id)}
              onClear={() => setSelected(new Set())}
            />
          ) : null}

          {visible.length === 0 ? (
            <p className="mt-10 rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">
              {counts.total === 0
                ? 'Nothing here yet. Upload your paper on the proposal screen and its references land here automatically.'
                : activeFilter.kind === 'one' && (byCollection.byId.get(activeFilter.id) ?? 0) === 0
                  ? 'This collection is empty. Tick papers under All and choose "Add to collection…".'
                  : 'Nothing matches that filter.'}
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line rounded-md border border-line">
              {visible.map((source) => (
                <SourceRow
                  key={source.id}
                  documentId={documentId}
                  source={source}
                  selected={selected.has(source.id)}
                  onSelect={(on) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (on) next.add(source.id);
                      else next.delete(source.id);
                      return next;
                    })
                  }
                  collectionNames={(source.collectionIds ?? [])
                    .map(collectionName)
                    .filter((n): n is string => n !== null)}
                  onRefix={refix}
                  onRemove={remove}
                  onOpen={openPdf}
                  onAttach={filter === 'missing' ? attachPdf : undefined}
                  onFetchPdf={filter === 'missing' ? (id) => void fetchPdfs([id]) : undefined}
                  onEdited={() => {
                    setNotice('Details saved. Every citation of this paper now follows them.');
                    void load();
                  }}
                  onDetails={setDrawerId}
                />
              ))}
            </ul>
          )}
        </>
      ) : null}
      {drawerId ? (
        <LibraryDrawer
          documentId={documentId}
          ids={visibleIds}
          sourceId={drawerId}
          onStep={setDrawerId}
          onClose={() => setDrawerId(null)}
          onEdited={() => void load()}
        />
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

/**
 * Ticks and what to do with them: "Add to collection…" (a list of the collections) and, inside a
 * collection, "Remove from <it>". Shown above the list whenever there is a list.
 */
function SelectionBar({
  state,
  count,
  collections,
  activeCollectionId,
  onToggleAll,
  onAdd,
  onRemove,
  onClear,
}: {
  state: 'none' | 'some' | 'all';
  count: number;
  collections: Collection[];
  activeCollectionId: string | null;
  onToggleAll: () => void;
  onAdd: (collectionId: string) => void;
  onRemove: (collectionId: string) => void;
  onClear: () => void;
}) {
  const active = collections.find((c) => c.id === activeCollectionId) ?? null;
  return (
    <div
      className="mt-6 flex flex-wrap items-center gap-3 px-4 text-sm"
      data-testid="selection-bar"
    >
      <label className="flex items-center gap-2 text-muted">
        <input
          type="checkbox"
          data-testid="select-all"
          checked={state === 'all'}
          ref={(el) => {
            if (el) el.indeterminate = state === 'some';
          }}
          onChange={onToggleAll}
        />
        {count > 0 ? `${count} selected` : 'Select'}
      </label>
      {count > 0 ? (
        <>
          {collections.length > 0 ? (
            <select
              aria-label="Add the selected papers to a collection"
              data-testid="add-to-collection"
              className="rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-ink"
              value=""
              onChange={(e) => {
                if (e.target.value) onAdd(e.target.value);
              }}
            >
              <option value="">Add to collection…</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-muted">
              Make a collection above (+ New collection) to put these in it.
            </span>
          )}
          {active ? (
            <button
              type="button"
              data-testid="remove-from-collection"
              className="underline hover:text-warn"
              onClick={() => onRemove(active.id)}
            >
              Remove from {active.name}
            </button>
          ) : null}
          <button type="button" className="text-muted underline" onClick={onClear}>
            Clear
          </button>
        </>
      ) : null}
    </div>
  );
}

function SourceRow({
  documentId,
  source,
  selected,
  onSelect,
  collectionNames,
  onRefix,
  onRemove,
  onOpen,
  onAttach,
  onFetchPdf,
  onEdited,
  onDetails,
}: {
  documentId: string;
  source: Source;
  selected: boolean;
  onSelect: (on: boolean) => void;
  /** The names of the collections this paper is in, shown small under its title. */
  collectionNames: string[];
  onRefix: (id: string, doi: string) => void;
  onRemove: (id: string) => void;
  onOpen: (id: string) => void;
  /** Set in the "Without full text" view: offers "Add the PDF" and says why it is missing. */
  onAttach?: ((id: string, file: File) => Promise<void>) | undefined;
  /** R14: set in the same view — look again for an open-access copy of this paper. */
  onFetchPdf?: ((id: string) => void) | undefined;
  /** R15: the paper's details were corrected; the list reads them again. */
  onEdited?: (() => void) | undefined;
  /** R17: opens the details drawer on this paper. */
  onDetails?: ((id: string) => void) | undefined;
}) {
  const [fixing, setFixing] = useState(false);
  const [attaching, setAttaching] = useState(false);
  /** R15 (ADR-0102): the details form, open under the row. */
  const [editing, setEditing] = useState(false);
  const [doi, setDoi] = useState('');

  const meta = [source.year ? String(source.year) : null, source.venue].filter(Boolean).join(' · ');
  // Coverage map rows 21, 32, 46: only facts that were fetched get a badge. Citedness is
  // OpenAlex's figure (ADR-0022), named as OpenAlex's — not Clarivate's Journal Impact Factor.
  const metrics = sourceMetricBadges({
    citedByCount: source.citationCount,
    openAccess: source.openAccess ?? null,
    oaStatus: source.oaStatus ?? null,
    journalCitedness: source.venueCitedness,
  });

  return (
    <li className="px-4 py-3" data-testid="library-row">
      <div className="flex items-start justify-between gap-4">
        <input
          type="checkbox"
          className="mt-1.5 shrink-0"
          data-testid="select-source"
          aria-label={`Select ${source.title ?? source.rawReference ?? 'this source'}`}
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
        />
        <div className="min-w-0 flex-1">
          {/* ADR-0068: the title opens the paper here, in the reader — not the publisher's site. */}
          <Link
            href={readerHref(documentId, source.id)}
            data-testid="library-read-title"
            className="font-medium text-ink hover:text-accent hover:underline"
          >
            {source.title ?? source.rawReference ?? 'Untitled source'}
          </Link>
          {authorLine(source.authors) ? (
            <p className="text-sm text-muted">{authorLine(source.authors)}</p>
          ) : null}
          {meta ? <p className="text-xs text-muted">{meta}</p> : null}
          {collectionNames.length > 0 ? (
            <p className="mt-1 flex flex-wrap gap-1" data-testid="row-collections">
              {collectionNames.map((name) => (
                <span
                  key={name}
                  className="rounded-sm bg-sunk px-1.5 py-0.5 text-[11px] font-medium text-muted"
                >
                  {name}
                </span>
              ))}
            </p>
          ) : null}
          {metrics.length > 0 ? (
            <ul className="mt-1 flex flex-wrap gap-1" aria-label="About this paper">
              {metrics.map((m) => (
                <li
                  key={m.kind}
                  data-testid={m.kind === 'citedness' ? 'journal-citedness' : `source-${m.kind}`}
                  title={m.title}
                  className={`cursor-help rounded-full border px-2 py-0.5 text-[11px] ${
                    m.kind === 'open-access'
                      ? 'border-accent/30 text-accent'
                      : 'border-line text-muted'
                  }`}
                >
                  {m.label}
                </li>
              ))}
            </ul>
          ) : null}

          {source.isRetracted ? (
            <p className="mt-1 text-xs font-medium text-warn">
              This paper has been retracted. Do not cite it without saying so.
            </p>
          ) : null}
          {source.isPreprint ? (
            <p className="mt-1 text-xs text-muted">Preprint, not peer reviewed.</p>
          ) : null}

          {onAttach && source.noFullTextReason ? (
            <p className="mt-1 text-xs text-muted" data-testid="no-full-text-reason">
              {source.noFullTextReason}
            </p>
          ) : null}

          {source.status === 'UNRESOLVED' && source.rawReference ? (
            <p className="mt-1 truncate text-xs text-muted" title={source.rawReference}>
              From your paper: {source.rawReference}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <GroundingBadge source={source} />
          {source.autoAddedAt ? (
            <Badge tone="muted" data-testid="auto-added-badge">
              Added automatically
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <Link
          href={readerHref(documentId, source.id)}
          data-testid="library-read"
          className="font-semibold text-accent underline"
        >
          Read
        </Link>
        {source.doi ? (
          <a
            className="underline"
            href={`https://doi.org/${source.doi}`}
            target="_blank"
            rel="noopener noreferrer"
            title="The publisher's page, in a new tab"
          >
            {source.doi} ↗
          </a>
        ) : null}
        {source.hasFile ? (
          <button type="button" className="underline" onClick={() => onOpen(source.id)}>
            PDF file ↗
          </button>
        ) : null}
        {onDetails ? (
          <button
            type="button"
            className="font-semibold text-accent underline"
            onClick={() => onDetails(source.id)}
            data-testid="library-details"
          >
            Details
          </button>
        ) : null}
        {source.status !== 'PENDING' ? (
          <button
            type="button"
            className="underline"
            aria-expanded={editing}
            onClick={() => setEditing((on) => !on)}
            data-testid="edit-details-open"
          >
            Edit details
          </button>
        ) : null}
        {onFetchPdf && source.doi && !source.hasFile ? (
          <button
            type="button"
            className="font-semibold text-accent underline"
            onClick={() => onFetchPdf(source.id)}
            data-testid="fetch-pdf"
          >
            Fetch PDF
          </button>
        ) : null}
        {onAttach ? (
          <label
            className="cursor-pointer font-semibold text-accent underline"
            data-testid="attach-pdf"
          >
            {attaching ? 'Uploading…' : source.hasFile ? 'Replace the PDF' : 'Add the PDF'}
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              disabled={attaching}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setAttaching(true);
                void onAttach(source.id, file).finally(() => setAttaching(false));
              }}
            />
          </label>
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
      {editing ? (
        <EditDetails
          sourceId={source.id}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onEdited?.();
          }}
        />
      ) : null}
    </li>
  );
}
