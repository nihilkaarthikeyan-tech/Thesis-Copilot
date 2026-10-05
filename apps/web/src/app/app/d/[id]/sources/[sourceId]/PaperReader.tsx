'use client';

/**
 * The paper reader — `/app/d/:id/sources/:sourceId` (ADR-0068).
 *
 * A student added a paper and then could not read it here: the library's title went to the
 * publisher. This page reads it inside Thesis Copilot, as Jenni's reader does: the PDF drawn on
 * the page (when we hold one), or the text we extracted (always, and all an abstract-only paper
 * has); search with Ctrl/Cmd+F; and a selected passage copied with its citation, cited in the
 * chapter, or asked about in chat.
 *
 * Every state says what is true: still being looked up or read (and the page refreshes itself),
 * only the abstract held (with "Add the PDF"), a PDF that yielded no text (with the reason).
 */

import type { CslAuthor } from '@tc/retrieval';
import { sourceMetricBadges } from '@tc/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type PdfController,
  PdfView,
  type ReaderView,
  ZOOM_STEPS,
} from '@/components/reader/PdfView';
import { type Selected, SelectionMenu } from '@/components/reader/SelectionMenu';
import { type Passage, TextView } from '@/components/reader/TextView';
import { Button } from '@/components/ui/button';
import { Badge, Kbd } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';
import { readLastChapter } from '@/lib/last-chapter';
import { mentionLabel } from '@/lib/mentions';
import { matchLabel, quoteWithCitation, stepMatch, writeHandoff } from '@/lib/reader';

type Reading = 'LOOKING_UP' | 'READING' | 'FULL_TEXT' | 'ABSTRACT' | 'UNREADABLE' | 'NOTHING';

type ReaderSource = {
  id: string;
  documentId: string;
  status: string;
  title: string | null;
  authors: CslAuthor[] | null;
  year: number | null;
  venue: string | null;
  doi: string | null;
  groundingLevel: string;
  citationCount: number | null;
  venueCitedness: number | null;
  oaStatus: string | null;
  openAccess: boolean | null;
  isPreprint: boolean;
  isRetracted: boolean;
  hasFile: boolean;
  rawReference: string | null;
  noFullTextReason: string | null;
  collections: Array<{ id: string; name: string }>;
  passageCount: number;
  reading: Reading;
};

type DocumentInfo = { id: string; title: string; chapters: Array<{ id: string }> };

const POLL_MS = 3_000;

function authorLine(authors: CslAuthor[] | null): string {
  if (!authors || authors.length === 0) return '';
  const names = authors
    .map((a) => [a.given, a.family].filter(Boolean).join(' ') || a.literal || '')
    .filter(Boolean);
  if (names.length <= 4) return names.join(', ');
  return `${names.slice(0, 4).join(', ')} and ${names.length - 4} more`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // An older browser, or a page without clipboard permission: the textarea route.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export function PaperReader({ documentId, sourceId }: { documentId: string; sourceId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const initialPage = Number(params.get('page')) || null;

  const [source, setSource] = useState<ReaderSource | null>(null);
  const [document_, setDocument] = useState<DocumentInfo | null>(null);
  const [passages, setPassages] = useState<Passage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<'pdf' | 'text' | null>(null);
  const [pdfState, setPdfState] = useState<{ status: string; pages?: number; error?: string }>({
    status: 'loading',
  });
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  const [page, setPage] = useState<{ page: number; scale: number }>({ page: 1, scale: 1 });
  const [uploading, setUploading] = useState(false);
  const [copying, setCopying] = useState(false);

  const load = useCallback(async () => {
    try {
      const row = await api<ReaderSource>(`/sources/${sourceId}`);
      if (row.documentId !== documentId)
        throw new ApiError({ type: 'NOT_FOUND', title: 'Not found', status: 404 });
      setSource(row);
      setError(null);
      return row;
    } catch (e) {
      if (e instanceof ApiError && e.problem.status === 401) router.replace('/sign-in');
      else if (e instanceof ApiError && e.problem.status === 404) {
        setError('This paper is not in your library — it may have been removed.');
      } else setError(e instanceof Error ? e.message : 'The paper could not be opened.');
      return null;
    }
  }, [sourceId, documentId, router]);

  useEffect(() => {
    void load();
    api<DocumentInfo>(`/documents/${documentId}`)
      .then(setDocument)
      .catch(() => undefined);
  }, [load, documentId]);

  // The text, whenever there is (more of) it.
  const passageCount = source?.passageCount ?? 0;
  const loaded = source !== null;
  useEffect(() => {
    if (!loaded) return;
    if (passageCount === 0) {
      setPassages([]);
      return;
    }
    api<{ passages: Passage[] }>(`/sources/${sourceId}/text`)
      .then((r) => setPassages(r.passages))
      .catch(() => setPassages([]));
  }, [sourceId, passageCount, loaded]);

  // Still being looked up or read: look again until it settles.
  const settling = source?.reading === 'LOOKING_UP' || source?.reading === 'READING';
  useEffect(() => {
    if (!settling) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [settling, load]);

  // The view: the PDF when there is one and it draws, the text otherwise.
  const hasText = (passages?.length ?? 0) > 0;
  const pdfFailed = pdfState.status === 'error';
  // `?view=text` (a passage opened from chat) asks for the text when there is some.
  const wantsText = params.get('view') === 'text';
  const textKnown = passages !== null;
  const withFile = source?.hasFile ?? false;
  useEffect(() => {
    if (!loaded || !textKnown) return;
    setView((current) => {
      if (withFile && !pdfFailed) return current ?? (wantsText && hasText ? 'text' : 'pdf');
      return 'text';
    });
  }, [loaded, textKnown, withFile, pdfFailed, hasText, wantsText]);

  // ---- Search ------------------------------------------------------------------------------------
  const pdfController = useRef<PdfController | null>(null);
  const textController = useRef<ReaderView | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState(0);
  const [searching, setSearching] = useState(false);
  const active = useCallback(
    (): ReaderView | null => (view === 'pdf' ? pdfController.current : textController.current),
    [view],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the view or the text changes
  useEffect(() => {
    if (!searchOpen) return;
    const target = active();
    if (!target) return;
    if (!query.trim()) {
      target.clear();
      setTotal(0);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      const found = await target.count(query);
      if (!live) return;
      setTotal(found);
      setCurrent(0);
      setSearching(false);
      if (found > 0) await target.show(query, 0);
      else target.clear();
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, searchOpen, view, passages, pdfState.status]);

  const step = useCallback(
    (direction: 1 | -1) => {
      if (total === 0) return;
      const next = stepMatch(current, total, direction);
      setCurrent(next);
      void active()?.show(query, next);
    },
    [current, total, query, active],
  );

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    pdfController.current?.clear();
    textController.current?.clear();
  }, []);

  // `?chunk=` (a citation's passage): in the PDF, find the passage's opening words from its page
  // on and mark them. The extracted text and the PDF's own can differ (ligatures, a hyphen at a
  // line end), so a shorter opening is tried before settling for the page alone.
  const chunkParam = params.get('chunk');
  const pointed = useRef(false);
  useEffect(() => {
    if (pointed.current || !chunkParam || view !== 'pdf' || pdfState.status !== 'ready') return;
    const passage = passages?.find((p) => p.id === chunkParam);
    const pdf = pdfController.current;
    if (!passage || !pdf) return;
    pointed.current = true;
    const words = passage.text.split(/\s+/).filter(Boolean);
    void (async () => {
      for (const length of [8, 4]) {
        if (words.length < 2) break;
        const opening = words.slice(0, length).join(' ');
        const at = await pdf.firstFrom(opening, passage.page ?? 1);
        if (at >= 0) {
          await pdf.show(opening, at);
          return;
        }
      }
      if (passage.page) pdf.goToPage(passage.page);
    })();
  }, [chunkParam, view, pdfState.status, passages]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => {
          searchBox.current?.focus();
          searchBox.current?.select();
        });
      } else if (event.key === 'Escape' && searchOpen) {
        closeSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchOpen, closeSearch]);

  // ---- Selection actions -------------------------------------------------------------------------
  const content = useRef<HTMLDivElement>(null);

  const copyWithCitation = useCallback(
    async (selected: Selected) => {
      setCopying(true);
      setNotice(null);
      try {
        const q = new URLSearchParams({ sourceId });
        if (selected.page) q.set('page', String(selected.page));
        const cite = await api<{ label: string; noteStyle: boolean }>(
          `/documents/${documentId}/citations/quote?${q.toString()}`,
        );
        const text = quoteWithCitation(selected.text, cite.label, cite.noteStyle);
        const ok = await copyText(text);
        setNotice(
          ok
            ? `Copied, with ${cite.label}.`
            : 'Your browser would not let us copy. Select the text and copy it yourself.',
        );
      } catch (e) {
        setNotice(
          e instanceof ApiError
            ? (e.problem.detail ?? e.problem.title)
            : 'The citation could not be made. Nothing was copied.',
        );
      } finally {
        setCopying(false);
      }
    },
    [documentId, sourceId],
  );

  /** The chapter the student was last writing in this thesis, else the first. */
  const targetChapter = useCallback((): string | null => {
    const last = readLastChapter();
    const chapters = document_?.chapters ?? [];
    if (last?.documentId === documentId && chapters.some((c) => c.id === last.chapterId)) {
      return last.chapterId;
    }
    return chapters[0]?.id ?? last?.chapterId ?? null;
  }, [document_, documentId]);

  const label = source ? mentionLabel(source) : 'this paper';

  const goToEditor = useCallback(() => {
    const chapterId = targetChapter();
    if (!chapterId) {
      setNotice('This thesis has no chapter yet. Make the outline first, then cite from here.');
      return false;
    }
    router.push(`/app/d/${documentId}/write/${chapterId}`);
    return true;
  }, [targetChapter, router, documentId]);

  const cite = useCallback(
    (selected: Selected) => {
      if (!targetChapter()) {
        setNotice('This thesis has no chapter yet. Make the outline first, then cite from here.');
        return;
      }
      writeHandoff({
        kind: 'cite',
        documentId,
        sourceId,
        chunkId: selected.chunkId,
        page: selected.page,
        label,
        title: source?.title ?? null,
      });
      goToEditor();
    },
    [documentId, sourceId, label, source, goToEditor, targetChapter],
  );

  const ask = useCallback(
    (selected: Selected) => {
      if (!targetChapter()) {
        setNotice('This thesis has no chapter yet, so there is no chat to ask in.');
        return;
      }
      writeHandoff({
        kind: 'ask',
        documentId,
        sourceId,
        text: selected.text,
        label,
        readable: (source?.groundingLevel ?? 'NONE') !== 'NONE',
      });
      goToEditor();
    },
    [documentId, sourceId, label, source, goToEditor, targetChapter],
  );

  async function attachPdf(file: File) {
    setUploading(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.append('file', file);
      await api(`/sources/${sourceId}/upload`, { method: 'POST', body: form });
      setNotice('PDF added. It is being read now; this page updates when it is done.');
      setPdfState({ status: 'loading' });
      setView(null);
      await load();
    } catch (e) {
      setNotice(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'That upload did not work.',
      );
    } finally {
      setUploading(false);
    }
  }

  const metrics = useMemo(
    () =>
      source
        ? sourceMetricBadges({
            citedByCount: source.citationCount,
            openAccess: source.openAccess,
            oaStatus: source.oaStatus,
            journalCitedness: source.venueCitedness,
          })
        : [],
    [source],
  );

  if (!source) {
    return (
      <main className="mx-auto max-w-3xl p-6 text-sm">
        {error ? (
          <>
            <p role="alert" className="text-warn">
              {error}
            </p>
            <Link href={`/app/d/${documentId}/sources`} className="mt-2 inline-block underline">
              Back to the library
            </Link>
          </>
        ) : (
          <p className="text-muted">Opening the paper…</p>
        )}
      </main>
    );
  }

  const publisher = source.doi ? `https://doi.org/${source.doi}` : null;
  const addPdf = (
    <label className="inline-flex h-9 cursor-pointer items-center rounded-md bg-accent px-4 text-[13px] font-bold text-accent-ink transition-colors hover:bg-accent-hover">
      {uploading ? 'Uploading…' : 'Add the PDF'}
      <input
        type="file"
        accept=".pdf,application/pdf"
        className="sr-only"
        data-testid="reader-add-pdf"
        disabled={uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void attachPdf(file);
        }}
      />
    </label>
  );
  const publisherLink = publisher ? (
    <a
      href={publisher}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-9 items-center rounded-md border border-line-strong bg-surface px-4 text-[13px] font-bold text-ink transition-colors hover:bg-sunk"
    >
      Publisher’s page ↗
    </a>
  ) : null;

  const showPdf = view === 'pdf' && source.hasFile && !pdfFailed;
  const bothViews = source.hasFile && !pdfFailed && hasText;

  return (
    <main className="flex h-dvh flex-col bg-paper" data-testid="paper-reader">
      <header className="shrink-0 border-b border-line bg-surface px-4 pt-3 pb-2 sm:px-6">
        <nav className="flex items-center gap-2 text-[12px] text-muted" aria-label="Breadcrumb">
          <Link href={`/app/d/${documentId}/sources`} className="hover:text-ink hover:underline">
            ← Library
          </Link>
          {document_?.title ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{document_.title}</span>
            </>
          ) : null}
        </nav>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <h1
            className="line-clamp-2 min-w-0 basis-full text-[18px] sm:basis-0 sm:flex-1 font-bold leading-snug tracking-[-0.01em] text-ink sm:text-[20px]"
            title={source.title ?? undefined}
            data-testid="reader-title"
          >
            {source.title ?? source.rawReference ?? 'Untitled paper'}
          </h1>
          <div className="flex shrink-0 items-center gap-2 pt-1">
            <GroundingBadge source={source} />
            {publisher ? (
              <a
                href={publisher}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] font-semibold text-accent underline-offset-4 hover:underline"
                data-testid="reader-publisher"
              >
                Publisher’s page ↗
              </a>
            ) : null}
          </div>
        </div>
        <div className="mt-0.5">
          <p className="text-[13px] text-muted">
            {[authorLine(source.authors), source.year, source.venue].filter(Boolean).join(' · ')}
          </p>
          {metrics.length > 0 || source.collections.length > 0 ? (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {metrics.map((m) => (
                <span
                  key={m.kind}
                  title={m.title}
                  className={`cursor-help rounded-full border px-2 py-0.5 text-[11px] ${
                    m.kind === 'open-access'
                      ? 'border-accent/30 text-accent'
                      : 'border-line text-muted'
                  }`}
                >
                  {m.label}
                </span>
              ))}
              {source.collections.map((c) => (
                <span
                  key={c.id}
                  data-testid="reader-collection"
                  className="rounded-sm bg-sunk px-1.5 py-0.5 text-[11px] font-medium text-muted"
                >
                  {c.name}
                </span>
              ))}
            </div>
          ) : null}
          {source.isRetracted ? (
            <p className="mt-1 text-xs font-medium text-danger">
              This paper has been retracted. Do not cite it without saying so.
            </p>
          ) : null}
          {source.isPreprint ? (
            <p className="mt-1 text-xs text-muted">Preprint, not peer reviewed.</p>
          ) : null}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
          {bothViews ? (
            <div
              role="tablist"
              aria-label="How to read it"
              className="flex rounded-md border border-line-strong p-0.5"
            >
              {(['pdf', 'text'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  data-testid={`reader-view-${v}`}
                  onClick={() => setView(v)}
                  className={`rounded-[7px] px-3 py-1 font-semibold transition-colors ${
                    view === v ? 'bg-accent-soft text-ink' : 'text-muted hover:text-ink'
                  }`}
                >
                  {v === 'pdf' ? 'PDF' : 'Text'}
                </button>
              ))}
            </div>
          ) : null}
          {showPdf ? (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                aria-label="Zoom out"
                onClick={() => setZoom(zoomStep(zoom, page.scale, -1))}
              >
                −
              </Button>
              <Button
                variant={zoom === 'fit' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setZoom('fit')}
                data-testid="reader-fit"
              >
                Fit width
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Zoom in"
                onClick={() => setZoom(zoomStep(zoom, page.scale, 1))}
              >
                +
              </Button>
              <span className="tnum w-11 text-muted">{Math.round(page.scale * 100)}%</span>
              {pdfState.pages ? (
                <span className="tnum text-muted" data-testid="reader-page">
                  Page {page.page} of {pdfState.pages}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {showPdf || hasText ? (
              <Button
                variant="ghost"
                size="sm"
                data-testid="reader-search-open"
                onClick={() => {
                  setSearchOpen(true);
                  requestAnimationFrame(() => searchBox.current?.focus());
                }}
              >
                Search{' '}
                <span className="hidden sm:inline">
                  <Kbd>Ctrl F</Kbd>
                </span>
              </Button>
            ) : null}
          </div>
        </div>

        {searchOpen ? (
          <form
            aria-label="Search this paper"
            className="mt-2 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              step(1);
            }}
          >
            <input
              ref={searchBox}
              type="search"
              aria-label="Search this paper"
              data-testid="reader-search"
              placeholder="Search this paper"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  step(e.shiftKey ? -1 : 1);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  closeSearch();
                }
              }}
              className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-ink sm:max-w-sm"
            />
            <span
              className="tnum w-20 shrink-0 text-[12px] text-muted"
              data-testid="reader-search-count"
              aria-live="polite"
            >
              {searching ? '…' : matchLabel(current, total, query)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Previous match"
              disabled={total === 0}
              onClick={() => step(-1)}
            >
              ↑
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Next match"
              disabled={total === 0}
              onClick={() => step(1)}
              data-testid="reader-search-next"
            >
              ↓
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={closeSearch}>
              Close
            </Button>
          </form>
        ) : null}
      </header>

      <StateBanner
        source={source}
        pdfError={pdfFailed ? (pdfState.error ?? null) : null}
        addPdf={addPdf}
        publisherLink={publisherLink}
      />

      {notice ? (
        <p
          role="status"
          data-testid="reader-notice"
          className="shrink-0 border-b border-line bg-accent-soft px-4 py-1.5 text-[13px] text-ink sm:px-6"
        >
          {notice}
        </p>
      ) : null}

      <div ref={content} className="flex min-h-0 flex-1 flex-col">
        {source.hasFile && !pdfFailed ? (
          <PdfView
            sourceId={sourceId}
            initialPage={initialPage}
            controller={pdfController}
            zoom={zoom}
            onState={setPdfState}
            onPageChange={(p, scale) => setPage({ page: p, scale })}
            className={showPdf ? '' : 'hidden'}
          />
        ) : null}
        {view === 'text' || !source.hasFile || pdfFailed ? (
          hasText ? (
            <TextView
              passages={passages ?? []}
              controller={textController}
              initialPage={initialPage}
              initialChunk={params.get('chunk')}
            />
          ) : passages === null ? (
            <p className="p-6 text-sm text-muted">Opening the text…</p>
          ) : (
            <div className="flex-1" />
          )
        ) : null}
      </div>

      <SelectionMenu
        container={content}
        onCopy={copyWithCitation}
        onCite={cite}
        onAsk={ask}
        busy={copying}
      />
    </main>
  );
}

/** The next zoom step from what is on screen now — "fit" counts as the scale it came to. */
function zoomStep(zoom: 'fit' | number, shown: number, direction: 1 | -1): number {
  const now = zoom === 'fit' ? shown : zoom;
  if (direction === 1) return ZOOM_STEPS.find((s) => s > now + 0.01) ?? ZOOM_STEPS.at(-1) ?? 3;
  return [...ZOOM_STEPS].reverse().find((s) => s < now - 0.01) ?? ZOOM_STEPS[0];
}

function GroundingBadge({ source }: { source: ReaderSource }) {
  if (source.groundingLevel === 'FULL_TEXT') return <Badge tone="ok">Full text</Badge>;
  if (source.status === 'UNRESOLVED') return <Badge tone="warn">Not found</Badge>;
  if (source.status === 'PENDING') return <Badge>Looking it up…</Badge>;
  if (source.groundingLevel === 'ABSTRACT') return <Badge>Abstract only</Badge>;
  return <Badge tone="warn">No text</Badge>;
}

/** Says what is true about what we hold, and offers the way to more. */
function StateBanner({
  source,
  pdfError,
  addPdf,
  publisherLink,
}: {
  source: ReaderSource;
  pdfError: string | null;
  addPdf: React.ReactNode;
  publisherLink: React.ReactNode;
}) {
  const frame = 'shrink-0 border-b border-line px-4 py-3 text-[13px] sm:px-6';
  if (source.reading === 'LOOKING_UP' || source.reading === 'READING') {
    return (
      <div className={`${frame} bg-sunk text-ink`} role="status" data-testid="reader-state-reading">
        <strong className="font-semibold">
          {source.reading === 'LOOKING_UP' ? 'Still being looked up' : 'Still being read'}
        </strong>{' '}
        — this page updates when it is ready.
      </div>
    );
  }
  if (source.reading === 'ABSTRACT' || source.reading === 'NOTHING') {
    return (
      <div className={`${frame} bg-warn-soft text-ink`} data-testid="reader-state-abstract">
        <p>
          <strong className="font-semibold">
            {source.reading === 'ABSTRACT'
              ? 'We hold only the abstract of this paper.'
              : 'We hold no text of this paper.'}
          </strong>{' '}
          {source.noFullTextReason ?? ''} Add your copy of the PDF and it is read in full.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {addPdf}
          {publisherLink}
        </div>
      </div>
    );
  }
  if (source.reading === 'UNREADABLE' || pdfError) {
    return (
      <div
        className={`${frame} bg-warn-soft text-ink`}
        role="alert"
        data-testid="reader-state-unreadable"
      >
        <p>
          <strong className="font-semibold">
            {pdfError ? 'We could not draw this PDF.' : 'We could not read this PDF.'}
          </strong>{' '}
          {pdfError ?? source.noFullTextReason ?? ''}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {addPdf}
          {publisherLink}
        </div>
      </div>
    );
  }
  return null;
}
