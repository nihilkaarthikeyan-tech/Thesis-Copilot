'use client';

/**
 * The Stage 4 editor screen — PRD §6.2 layout, §6.3 keymap, Appendix B wiring.
 *
 * Left rail: chapter list. Centre: the TipTap editor at 72ch. Right panel: Sources / Citations
 * placeholders (real content in weeks 2–3). Top bar: document + chapter title, autosave state, the
 * usage meter from `/usage/me`, mode toggle placeholder.
 *
 * Ghost text streams over SSE (lib/sse.ts). Autosave is Appendix B.7 via `createAutosave`. A 409
 * freezes saving and shows the reload banner. Ctrl/Cmd+S forces a save and a MANUAL snapshot.
 */

import { type ChartSpec, chartSpecSchema, type DiagramSpec, diagramSpecSchema } from '@tc/types';
import {
  type Autosave,
  type AutosaveStatus,
  aiTextToFragment,
  type CitationPassage,
  createAutosave,
  getGhostState,
  type LocalDraft,
  tableRowsAt,
  tableToChartInput,
  thesisExtensions,
  wordCountByProvenance,
} from '@tc/ui';
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type MessageKey, tNow } from '@/i18n';
import { useT } from '@/i18n/react';
import { API_URL, ApiError, api } from '@/lib/api';
import { chapterLabel } from '@/lib/chapter-label';
import { COLLAB_CLOSE, connectLive, createLiveDoc, type LiveDoc, othersIn } from '@/lib/collab';
import { rememberLastChapter } from '@/lib/last-chapter';
import { canReadBeside, requestReadBeside } from '@/lib/read-beside';
import { readerHref } from '@/lib/reader';
import { assistRequest } from '@/lib/sse';

/** §6.2: the cap resets at 00:00 UTC on the 1st; shown in the student's own timezone. */
function formatResetsAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    date,
  );
}

/** `GET /sources/:id/chunks/:chunkId` (PHASES 3.5). */
type PassageDto = {
  text: string;
  page: number | null;
  section: string | null;
  source: {
    title: string | null;
    year: number | null;
    authors: unknown;
    groundingLevel?: string;
    venue?: string | null;
    doi?: string | null;
    citationCount?: number | null;
    oaStatus?: string | null;
    openAccess?: boolean | null;
    venueCitedness?: number | null;
  };
  pdfUrl: string | null;
};

/** "Goel, M., Rao, S. and others" — the card's author line, from CSL names. */
function authorLine(authors: unknown): string | null {
  if (!Array.isArray(authors) || authors.length === 0) return null;
  const names = (authors as Array<{ family?: string; given?: string; literal?: string }>)
    .slice(0, 3)
    .map((a) =>
      a.family ? `${a.family}${a.given ? `, ${a.given.charAt(0)}.` : ''}` : (a.literal ?? ''),
    )
    .filter(Boolean);
  if (names.length === 0) return null;
  return authors.length > 3 ? `${names.join('; ')} and others` : names.join('; ');
}

/** "Kumar 2021" for the popover header; falls back through what is actually known. */
function shortRefOf(source: PassageDto['source']): string {
  const first = Array.isArray(source.authors)
    ? (source.authors[0] as { family?: string; literal?: string } | undefined)
    : undefined;
  const name = first?.family?.trim() || first?.literal?.trim().split(/\s+/).pop() || null;
  if (name && source.year) return `${name} ${source.year}`;
  if (name) return name;
  if (source.title) return source.title.slice(0, 40);
  return 'Source';
}

import { AddProposalPrompt } from '../AddProposalPrompt';
import { FirstRunHint } from '../onboarding/FirstRunHint';
import { HowSuggestionsWork } from '../onboarding/HowSuggestionsWork';
import { ThemeToggle } from '../theme';
import { Button } from '../ui/button';
import { Kbd } from '../ui/primitives';
import { ChapterContents } from './ChapterContents';
import { ChartDialog } from './ChartDialog';
import type { Mention } from './ChatMentions';
import { ChatPanel } from './ChatPanel';
import { ChecksIndex } from './ChecksIndex';
import { CitationList } from './CitationList';
import { CitationsPanel, type Rendered } from './CitationsPanel';
import { CitePicker } from './CitePicker';
import { CiteSuggestions } from './CiteSuggestions';
import { CommandToolbar } from './CommandToolbar';
import { DiagramDialog } from './DiagramDialog';
import { DRAFT_SECTION_EVENT, DraftMode } from './DraftMode';
import { FindPapersPanel } from './FindPapersPanel';
import { FirstSessionGuide, markSuggestionKept } from './FirstSessionGuide';
import { type Flag, FlagsPanel } from './FlagsPanel';
import { type FormatActions, FormatToolbar, WordCount } from './FormatToolbar';
import { useGuidedInput } from './GuidedInput';
import { LibraryFilling, PAPERS_AWAITED } from './LibraryFilling';
import { ParaphrasePanel } from './ParaphrasePanel';
import { ProofreadPanel } from './ProofreadPanel';
import { ReadBesidePane } from './ReadBesidePane';
import { ReaderHandoffBar } from './ReaderHandoff';
import { ReviewPanel } from './ReviewPanel';
import { ScaffoldPanel } from './ScaffoldPanel';
import { ShareButton } from './ShareButton';
import { SlashMenu } from './SlashMenu';
import { LIBRARY_CHANGED, SourcePins } from './SourcePins';
import { SourceQualityPanel } from './SourceQualityPanel';
import { SuggestionBar } from './SuggestionBar';
import { UNDO_PARAM, VersionHistory } from './VersionHistory';
import { WordImport } from './WordImport';

type ExportResult = { url: string; filename: string; bytes: number };

type ChapterMeta = {
  id: string;
  title: string;
  order: number;
  outlineNodeId: string;
  wordCount: number;
};
type DocumentDetail = {
  id: string;
  title: string;
  chapters: ChapterMeta[];
  /** ADR-0028: a co-author has been invited and live editing is on. */
  liveEditing?: boolean;
  ownerEmail?: string;
};
type ChapterView = {
  id: string;
  title: string;
  content: unknown;
  version: number;
  wordCount: number;
  /** Which outline node this chapter is; draft mode drafts that node (FR-4.4). */
  outlineNodeId: string;
};
type Usage = { actions: Array<{ action: string; used: number; cap: number; remaining: number }> };
type Timing = { ttfbMs: number; latencyMs: number };

const STATUS_LABEL: Record<AutosaveStatus, MessageKey> = {
  idle: 'editor.status.idle',
  dirty: 'editor.status.dirty',
  saving: 'editor.status.saving',
  saved: 'editor.status.saved',
  conflict: 'editor.status.conflict',
  error: 'editor.status.error',
};

/** The panel tabs, in order; each label is `editor.tab.<id>`. */
const TABS = ['sources', 'papers', 'citations', 'chat', 'flags', 'review'] as const;

/** The passage behind a citation and its paper's record, for the hover card and the evidence card. */
async function resolvePassage(
  sourceId: string,
  chunkId: string | null,
): Promise<CitationPassage | null> {
  if (!chunkId) return null;
  try {
    const p = await api<PassageDto>(`/sources/${sourceId}/chunks/${chunkId}`);
    return {
      text: p.text,
      page: p.page,
      section: p.section,
      shortRef: shortRefOf(p.source),
      pdfUrl: p.pdfUrl,
      record: {
        title: p.source.title,
        authors: authorLine(p.source.authors),
        year: p.source.year,
        venue: p.source.venue ?? null,
        doi: p.source.doi ?? null,
        grounding: p.source.groundingLevel ?? null,
        citedByCount: p.source.citationCount ?? null,
        openAccess: p.source.openAccess ?? null,
        oaStatus: p.source.oaStatus ?? null,
        journalCitedness: p.source.venueCitedness ?? null,
      },
    };
  } catch {
    return null;
  }
}

/**
 * A short message to the student, with an optional next step. It sits at the foot of the screen:
 * above the toolbar it was off-screen whenever the student had scrolled down to the Suggest bar,
 * and a 4 s fade meant Ctrl+/ looked like it did nothing (2026-10-04 journey).
 */
type Notice = { text: string; action: 'findPapers' | null };

export function ThesisEditor({ documentId, chapterId }: { documentId: string; chapterId: string }) {
  const router = useRouter();
  const { t } = useT();
  const [doc, setDoc] = useState<DocumentDetail | null>(null);
  const [chapter, setChapter] = useState<ChapterView | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * ADR-0028: with the `collaboration` flag on, the chapter is edited live — through the room,
   * not autosave — and the student's own address names their cursor. Decided before the editor
   * is built, because the extensions cannot change underneath it.
   */
  const [liveEmail, setLiveEmail] = useState<string | null | undefined>(undefined);

  const refreshUsage = useCallback(() => {
    api<Usage>('/usage/me')
      .then(setUsage)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<DocumentDetail>(`/documents/${documentId}`),
      api<ChapterView>(`/chapters/${chapterId}`),
    ])
      .then(([d, c]) => {
        if (cancelled) return;
        setDoc(d);
        setChapter(c);
        // Live only when there is someone to write with: the document has a co-author and the
        // feature is on (`liveEditing` is the server's answer to both).
        setLiveEmail(d.liveEditing && d.ownerEmail ? d.ownerEmail : null);
      })
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.problem.status === 401) router.replace('/sign-in');
        else setError(e instanceof Error ? e.message : tNow('editor.loadError'));
      });
    refreshUsage();
    return () => {
      cancelled = true;
    };
  }, [documentId, chapterId, router, refreshUsage]);

  /**
   * The outline is built in the background when the student leaves the proposal (2026-10-04,
   * from the Jenni study: a new thesis there lands with every heading). While it runs the chapter
   * list says so; when it finishes, the list fills in without a reload.
   */
  const [outlineBuilding, setOutlineBuilding] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wasBuilding = false;
    const check = () => {
      api<{ generating?: boolean }>(`/documents/${documentId}/outline`)
        .then((view) => {
          if (cancelled) return;
          const building = view.generating === true;
          setOutlineBuilding(building);
          if (building) {
            wasBuilding = true;
            timer = setTimeout(check, 4_000);
          } else if (wasBuilding) {
            void api<DocumentDetail>(`/documents/${documentId}`).then((d) => {
              if (!cancelled) setDoc(d);
            });
          }
        })
        .catch(() => undefined);
    };
    check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [documentId]);

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <p role="alert" className="text-sm text-warn">
          {error}
        </p>
        <Link href="/app" className="mt-4 inline-block text-sm underline">
          {t('proposal.back')}
        </Link>
      </main>
    );
  }

  if (!doc || !chapter || liveEmail === undefined) {
    return <p className="p-6 text-sm text-muted">{t('editor.loadingChapter')}</p>;
  }

  return (
    <ChapterEditor
      doc={doc}
      chapter={chapter}
      usage={usage}
      onUsageChange={refreshUsage}
      liveEmail={liveEmail}
      outlineBuilding={outlineBuilding}
    />
  );
}

function ChapterEditor({
  doc,
  chapter,
  usage,
  onUsageChange,
  liveEmail,
  outlineBuilding,
}: {
  doc: DocumentDetail;
  chapter: ChapterView;
  usage: Usage | null;
  onUsageChange: () => void;
  /** Set when the chapter is edited live (ADR-0028); null keeps autosave. */
  liveEmail: string | null;
  /** The outline is being built from the proposal; the chapter list fills in when it is done. */
  outlineBuilding: boolean;
}) {
  const { t, rich } = useT();
  const [live] = useState<LiveDoc | null>(() => (liveEmail ? createLiveDoc(liveEmail) : null));
  const [liveState, setLiveState] = useState<{
    synced: boolean;
    online: boolean;
    others: string[];
  }>({ synced: false, online: true, others: [] });
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [conflict, setConflict] = useState(false);
  const [timing, setTiming] = useState<Timing | null>(null);
  /**
   * A short message to the student, with an optional next step. It sits at the foot of the
   * screen: above the toolbar it was off-screen whenever the student had scrolled down to the
   * Suggest bar, and a 4 s fade meant Ctrl+/ looked like it did nothing (2026-10-04 journey).
   */
  const [noticeRaw, setNotice] = useState<string | Notice | null>(null);
  const noticeState: Notice | null =
    typeof noticeRaw === 'string' ? { text: noticeRaw, action: null } : noticeRaw;
  const notice = noticeState?.text ?? null;
  const [localDraft, setLocalDraft] = useState<LocalDraft | null>(null);
  const [tab, setTab] = useState<'sources' | 'papers' | 'citations' | 'chat' | 'flags' | 'review'>(
    'sources',
  );
  const [autoSuggest, setAutoSuggest] = useState(false);
  /** ADR-0073: the next-step guide is on screen, so the other first-run cards wait. */
  const [guideShown, setGuideShown] = useState(false);
  const [allKeys, setAllKeys] = useState(false);
  /** The comment being read in the review tab; clicking its passage in the text selects it too. */
  const [activeComment, setActiveComment] = useState<string | null>(null);

  // The thesis list offers "Continue writing" back into this chapter.
  useEffect(() => {
    rememberLastChapter({
      documentId: doc.id,
      chapterId: chapter.id,
      documentTitle: doc.title,
      chapterTitle: chapter.title,
    });
  }, [doc.id, doc.title, chapter.id, chapter.title]);

  // FR-4.6: automatic-suggest is per user and off by default (ADR-0006).
  useEffect(() => {
    api<{ automaticSuggest?: boolean }>('/settings')
      .then((s) => setAutoSuggest(s.automaticSuggest === true))
      .catch(() => undefined);
  }, []);
  const [howOpen, setHowOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  /**
   * Below the widths where they fit beside the text, the chapter list and the tool panels open as
   * drawers over it. Before this they were simply hidden, and a student on a phone or a small
   * tablet lost sources, citations, chat, flags and review with no way to reach any of them.
   */
  const [drawer, setDrawer] = useState<'chapters' | 'panel' | null>(null);
  /** Text the student chose to ask the chat about; a new nonce each time, so the same text refills. */
  const [chatPrefill, setChatPrefill] = useState<{
    text: string;
    nonce: number;
    mention?: Mention;
  } | null>(null);
  /** A selected sentence the student asked papers for; the Papers tab searches it. */
  const [papersQuery, setPapersQuery] = useState<{ text: string; nonce: number } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (!drawer && !moreOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawer(null);
        setMoreOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer, moreOpen]);
  /**
   * Set when the page loaded straight after a restore: the id of the snapshot the restore wrote of
   * the text it replaced. Offering to put that back is what makes a restore safe to try.
   */
  const [undoVersionId, setUndoVersionId] = useState<string | null>(() =>
    typeof window === 'undefined'
      ? null
      : new URL(window.location.href).searchParams.get(UNDO_PARAM),
  );
  const [undoing, setUndoing] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<ExportResult | null>(null);
  const autosaveRef = useRef<Autosave | null>(null);
  const guided = useGuidedInput();
  /** The options are built before the editor exists; the retry needs the editor. */
  const editorRef = useRef<Editor | null>(null);
  const retriedRef = useRef(false);

  const reducedMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  /**
   * Stores a figure and hands the node back a key and a signed URL.
   *
   * `fetch` rather than the `api()` helper, and deliberately: the helper sets
   * `content-type: application/json` for anything it does not recognise as `FormData`, and a JSON
   * content-type on a multipart route is the exact fault the hard-won rules already record once.
   * Letting the browser set the header is what puts the multipart boundary on it.
   */
  const uploadFigure = useCallback(
    async (file: File): Promise<{ key: string; url: string }> => {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`${API_URL}/api/v1/chapters/${chapter.id}/figures`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(problem?.detail ?? 'That image could not be added.');
      }
      return (await response.json()) as { key: string; url: string };
    },
    [chapter.id],
  );

  const extensions = useMemo(
    () =>
      thesisExtensions({
        ghostText: {
          chapterId: chapter.id,
          request: assistRequest,
          autoSuggest,
          fadeMs: reducedMotion ? 0 : 400,
          onOutcome: (e) => {
            void api('/assist/outcome', {
              method: 'POST',
              body: JSON.stringify({
                suggestionId: e.suggestionId,
                outcome: e.outcome,
                keptChars: e.keptChars,
              }),
            }).catch(() => undefined);
            if (e.outcome === 'ACCEPTED' || e.outcome === 'PARTIAL') {
              onUsageChange();
              markSuggestionKept(doc.id);
            }
          },
          onTiming: (t) => {
            setTiming(t);
            onUsageChange();
          },
          onError: (e) => {
            // §6.2 / PHASES 5.2. Cap: say when it resets, in the student's own timezone.
            if (e.code === 'CAP_EXCEEDED') {
              // A trial that has ended (ADR-0036) has no reset date and says all it needs to.
              const when = e.resetsAt ? formatResetsAt(e.resetsAt) : null;
              setNotice(
                when
                  ? `${e.message} It resets on ${when}. Until then, keep writing — nothing you type is affected.`
                  : e.message,
              );
              return;
            }
            // Provider error: retry once before showing anything. A single blip should not cost
            // the student a keystroke; two in a row is a real outage and they should know.
            if (e.code === 'PROVIDER_ERROR' || e.code === 'STREAM_FAILED' || e.code === 'NETWORK') {
              if (!retriedRef.current) {
                retriedRef.current = true;
                setTimeout(() => editorRef.current?.commands.requestSuggestion(), 300);
                return;
              }
              retriedRef.current = false;
              setNotice(tNow('editor.notice.serviceDown'));
              return;
            }
            setNotice(e.message);
          },
          onIneligible: (reason) => setNotice(reason),
          onDone: (info) => {
            retriedRef.current = false;
            // ADR-0037: nothing in the library covers this, and a search has started. Said
            // first, because it is what will actually change the next suggestion.
            // A.1 (2026-09-30): with no source for what comes next, the model writes nothing and
            // names the gap instead of padding the page.
            const gap = info.needsSource ? `: ${info.needsSource}` : '';
            // ADR-0070: the library is still filling. The progress line above the page says
            // how far along it is, and asks for this suggestion again when a paper is ready.
            // ADR-0071: the suggestion follows a cited passage's wording. Said now, while the
            // student can still choose not to keep it as it stands.
            if (info.closeTo && !info.empty) {
              setNotice(
                tNow(
                  info.closeTo.kind === 'verbatim'
                    ? 'editor.notice.closeToVerbatim'
                    : 'editor.notice.closeTo',
                  {
                    ref: info.closeTo.shortRef,
                    words: info.closeTo.overlapText.split(' ').slice(0, 12).join(' '),
                  },
                ),
              );
              return;
            }
            if (info.papersLoading) {
              // Nothing written: wait, and ask again when a paper is ready. Something written:
              // it cites nothing yet, and the student is told citations will follow.
              if (info.empty) window.dispatchEvent(new Event(PAPERS_AWAITED));
              setNotice(
                tNow(
                  info.empty ? 'editor.notice.papersLoading' : 'editor.notice.papersLoadingShown',
                ),
              );
              return;
            }
            if (info.findingSources) {
              // The Sources panel looks again now and once the search has had time to land.
              window.dispatchEvent(new Event(LIBRARY_CHANGED));
              setTimeout(() => window.dispatchEvent(new Event(LIBRARY_CHANGED)), 60_000);
              setNotice(tNow('editor.notice.findingSources', { gap }));
              return;
            }
            if (info.needsSource) {
              setNotice({
                text: tNow('editor.notice.needsSource', { gap }),
                action: 'findPapers',
              });
              return;
            }
            // Empty-grounding state: the suggestion had no passage to draw on. Not an error —
            // a hint about what would make the next one better.
            if (!info.grounded) {
              if (info.pinned === 0) {
                setNotice({
                  text: info.empty
                    ? tNow('editor.notice.emptyLibrary')
                    : tNow('editor.notice.noSources'),
                  action: 'findPapers',
                });
              } else {
                setNotice(tNow('editor.notice.noPinnedMatch'));
              }
              return;
            }
            // Grounded but the model wrote nothing: Suggest must never look like it did nothing.
            if (info.empty) {
              setNotice(tNow('editor.notice.empty'));
            }
          },
          // PHASES 3.7: an inline input, not window.prompt, which blocks the page and steals
          // focus from the document.
          promptForInstruction: guided.controller.ask,
        },
        draft: {
          onOutcome: ({ draftId, outcome }) => {
            void fetch(
              `${API_URL}/api/v1/draft/${draftId}/${outcome === 'ACCEPTED' ? 'accept' : 'discard'}`,
              {
                method: 'POST',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({}),
              },
            ).catch(() => undefined);
            onUsageChange();
          },
          onBeforeAccept: async (draftId) => {
            await autosaveRef.current?.flush();
            await api(`/chapters/${chapter.id}/snapshot`, {
              method: 'POST',
              body: JSON.stringify({ reason: 'PRE_DRAFT_ACCEPT' }),
            }).catch(() => undefined);
            void draftId;
          },
          // A draft is a suggestion event like any other, so the same rating route takes it.
          onRate: (draftId, rating) =>
            api('/assist/rating', {
              method: 'POST',
              body: JSON.stringify({ suggestionId: draftId, rating }),
            }).then(
              () => true,
              () => false,
            ),
        },
        // PHASES 3.5: the hover popover reads the real passage behind a citation.
        citation: {
          resolvePassage,
          // "Read beside": the PDF in a pane next to the chapter, on a wide enough screen.
          readBeside: requestReadBeside,
          canReadBeside: () => canReadBeside(window.innerWidth),
          readerHref: (sourceId: string, page: number | null, chunkId: string | null) =>
            readerHref(doc.id, sourceId, page, chunkId),
        },
        imageUpload: uploadFigure,
        ...(live
          ? {
              collaboration: {
                document: live.doc,
                provider: { awareness: live.awareness },
                user: live.user,
              },
            }
          : {}),
        imageUploadError: (error: unknown) =>
          setNotice(error instanceof Error ? error.message : 'That image could not be added.'),
        // A figure's link lasts fifteen minutes and a chapter stays open for hours.
        imageResolveUrl: (key: string) =>
          api<{ url: string }>(
            `/chapters/${chapter.id}/figures/link?key=${encodeURIComponent(key)}`,
          ).then((r) => r.url),
        // Clicking a highlighted passage opens its comment in the panel (review.ts).
        review: {
          onSelect: (commentId: string) => {
            setTab('review');
            setActiveComment(commentId);
          },
        },
        // Cross-references read "Figure 3.2"; this supplies the 3. The number lives on the
        // document's chapter list, not on the loaded chapter — `ChapterView` carries the content,
        // and a chapter does not know its own position in the thesis.
        chapterNumber: doc.chapters.find((c) => c.id === chapter.id)?.order ?? 1,
        resizableTables: true,
      }),
    [
      chapter.id,
      doc.id,
      doc.chapters,
      reducedMotion,
      onUsageChange,
      guided.controller,
      autoSuggest,
      uploadFigure,
      live,
    ],
  );

  const editor = useEditor({
    extensions,
    // Live, the text comes over the socket; setting it here too would put it in twice.
    ...(live ? {} : { content: chapter.content as never }),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'thesis-editor',
        spellcheck: 'true',
        'aria-label': `${chapter.title} — editor`,
      },
    },
  });
  editorRef.current = editor;

  /** The chapter the editor last placed the cursor in on opening; see the autosave effect. */
  const focusedChapterRef = useRef<string | null>(null);
  /** Labels are re-fetched after every save; set inside the label effect below. */
  const refreshLabelsRef = useRef<() => void>(() => undefined);

  /**
   * The citation report links a problem as `?from=&to=`: select it once the chapter is in. Live,
   * the text arrives over the socket after the editor exists, so it waits for a document long
   * enough to hold the range rather than giving up on the empty one.
   */
  useEffect(() => {
    if (!editor || typeof window === 'undefined') return;
    const params = new URL(window.location.href).searchParams;
    const from = Number(params.get('from'));
    const to = Number(params.get('to'));
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) return;
    const select = () => {
      if (to > editor.state.doc.content.size) return false;
      editor.chain().focus().setTextSelection({ from, to }).scrollIntoView().run();
      return true;
    };
    if (select()) return;
    const onUpdate = () => {
      if (select()) editor.off('update', onUpdate);
    };
    editor.on('update', onUpdate);
    return () => {
      editor.off('update', onUpdate);
    };
  }, [editor]);

  /**
   * The toolbar's side of "Insert figure".
   *
   * `uploadImage` starts the upload and returns immediately — the node is inserted in a `.then`
   * inside the extension — so a failure surfaces here rather than as a silently missing picture.
   */
  /**
   * The `uploadImage` command, and nothing else.
   *
   * This used to be a second copy of that command written inline, and the copy is what ran — so
   * the one in `@tc/ui` was a file nobody had ever executed, and it quietly carried the fixes
   * this one did not. Both bugs were in the copy: the figure was left *selected* after insertion,
   * so clicking "Insert table" next replaced it and the picture vanished without a word; and the
   * storage key was written by `updateAttributes`, which targets whatever the selection happens
   * to be on, so a figure could reach the exporter with no key and become a placeholder in the
   * submitted thesis.
   */
  /** The toolbar's field and file-picker actions, for the "/" menu (`SlashMenu`). */
  const formatActions = useRef<FormatActions | null>(null);

  const insertFigure = useCallback((file: File) => {
    setNotice(null);
    editorRef.current?.commands.uploadImage(file);
  }, []);

  /**
   * ADR-0027: a chart from the student's numbers. Opens on the selected chart to edit it, on the
   * table the cursor is in with its numbers already filled, or empty.
   */
  const [chart, setChart] = useState<{ initial: ChartSpec | null; replacing: boolean } | null>(
    null,
  );
  const openChart = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    setNotice(null);
    const existing = ed.isActive('image')
      ? chartSpecSchema.safeParse(ed.getAttributes('image').chart)
      : null;
    if (existing?.success) {
      setChart({ initial: existing.data, replacing: true });
      return;
    }
    const rows = tableRowsAt(ed);
    const fromTable = rows ? tableToChartInput(rows) : null;
    setChart({
      initial: fromTable
        ? {
            type: 'bar',
            title: '',
            xLabel: fromTable.xLabel,
            yLabel: '',
            categories: fromTable.categories,
            series: fromTable.series,
          }
        : null,
      replacing: false,
    });
  }, []);
  const insertChart = useCallback(
    async (spec: ChartSpec, png: Blob) => {
      const ed = editorRef.current;
      if (!ed) return;
      // The same upload path as a picture, so every export and the link renewal treat it as one.
      const { key, url } = await uploadFigure(new File([png], 'chart.png', { type: 'image/png' }));
      const attrs = {
        src: url,
        key,
        alt: spec.title || 'Chart',
        caption: spec.title || null,
        chart: spec,
      };
      if (chart?.replacing) ed.chain().focus().updateAttributes('image', attrs).run();
      else ed.chain().focus().insertFigure(attrs).run();
    },
    [uploadFigure, chart],
  );

  /**
   * A chat answer into the chapter (2026-10-04): new paragraphs after the paragraph the cursor was
   * last in, each `{{cite:KEY}}` a citation node with the label chat showed, each `$…$` an equation,
   * all marked as AI text so the word counts and the AI-usage export stay truthful.
   */
  const addChatAnswer = useCallback(
    (
      text: string,
      citations: Array<{ key: string; sourceId: string; chunkId: string; label: string }>,
    ) => {
      const ed = editorRef.current;
      if (!ed) return;
      const store = (ed.storage as { citation?: { renderedMap?: Record<string, string> } })
        .citation;
      const resolved = citations.map((c) => ({ ...c, rendered: `(${c.label})` }));
      const paragraphType = ed.schema.nodes.paragraph;
      if (!paragraphType) return;
      const paragraphs = text
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) =>
          paragraphType.create(
            null,
            aiTextToFragment(ed.schema, p, {
              provenance: { kind: 'ASSIST', actionId: null },
              citations: resolved,
              onCitation: (key, rendered) => {
                if (store?.renderedMap && rendered) store.renderedMap[key] = rendered;
              },
            }),
          ),
        );
      if (paragraphs.length === 0) return;
      const { $from } = ed.state.selection;
      // After the top-level block the cursor is in; the end of the chapter if it is nowhere.
      const at = $from.depth >= 1 ? $from.after(1) : ed.state.doc.content.size;
      ed.chain()
        .focus()
        .command(({ tr, dispatch }) => {
          if (dispatch) tr.insert(at, paragraphs);
          return true;
        })
        .run();
      setNotice(tNow('editor.notice.chatAdded'));
    },
    [],
  );

  /** ADR-0049: a diagram from the student's own steps and links; opens on a selected one. */
  const [diagram, setDiagram] = useState<{
    initial: DiagramSpec | null;
    replacing: boolean;
  } | null>(null);
  const openDiagram = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    setNotice(null);
    const existing = ed.isActive('image')
      ? diagramSpecSchema.safeParse(ed.getAttributes('image').diagram)
      : null;
    setDiagram(
      existing?.success
        ? { initial: existing.data, replacing: true }
        : { initial: null, replacing: false },
    );
  }, []);
  const insertDiagram = useCallback(
    async (spec: DiagramSpec, png: Blob) => {
      const ed = editorRef.current;
      if (!ed) return;
      const { key, url } = await uploadFigure(
        new File([png], 'diagram.png', { type: 'image/png' }),
      );
      const attrs = {
        src: url,
        key,
        alt: spec.title || 'Diagram',
        caption: spec.title || null,
        diagram: spec,
      };
      if (diagram?.replacing) ed.chain().focus().updateAttributes('image', attrs).run();
      else ed.chain().focus().insertFigure(attrs).run();
    },
    [uploadFigure, diagram],
  );

  // ADR-0028: live, the room stores the chapter; here only the connection is watched, and
  // Ctrl/Cmd+S still takes a snapshot of what the room has written.
  useEffect(() => {
    if (!editor || !live) return;
    const provider = connectLive(chapter.id, live);
    const onSync = (synced: boolean) => setLiveState((s) => ({ ...s, synced }));
    const onStatus = ({ status: s }: { status: string }) =>
      setLiveState((state) => ({ ...state, online: s === 'connected' }));
    const onClose = (event: { code: number } | null) => {
      if (event?.code === COLLAB_CLOSE.changedElsewhere) setConflict(true);
    };
    const onAwareness = () => setLiveState((s) => ({ ...s, others: othersIn(live) }));
    provider.on('sync', onSync);
    provider.on('status', onStatus);
    provider.on('connection-close', onClose);
    live.awareness.on('change', onAwareness);
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        api(`/chapters/${chapter.id}/snapshot`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'MANUAL' }),
        })
          .then(() => setNotice(tNow('editor.snapshotSaved')))
          .catch(() => setNotice(tNow('editor.snapshotFailed')));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      live.awareness.off('change', onAwareness);
      provider.destroy();
    };
  }, [editor, live, chapter.id]);

  // Appendix B.7 autosave.
  useEffect(() => {
    if (!editor || live) return;
    const autosave = createAutosave({
      editor,
      initialVersion: chapter.version,
      storageKey: `tc:chapter:${chapter.id}`,
      onStatus: (s) => {
        setStatus(s);
        if (s === 'conflict') setConflict(true);
      },
      save: async (content, baseVersion) => {
        try {
          const result = await api<{ version: number }>(`/chapters/${chapter.id}`, {
            method: 'PUT',
            body: JSON.stringify({ content, baseVersion }),
          });
          // The saved document is what the server renders labels from (ADR-0045).
          refreshLabelsRef.current();
          return { ok: true, version: result.version };
        } catch (e) {
          if (e instanceof ApiError && e.problem.status === 409) {
            return { ok: false, conflict: true, serverVersion: Number(e.problem.serverVersion) };
          }
          return { ok: false, error: e instanceof Error ? e.message : 'save failed' };
        }
      },
    });
    autosaveRef.current = autosave;
    setLocalDraft(autosave.localDraft());

    // ADR-0045: chapters written before it hold citation nodes keyed by the request-local passage
    // id (`S1#c1`), several per chapter, pointing at different sources. One label map cannot
    // serve them; each twin after the first gets a key of its own, once, when the chapter opens.
    // After the autosave is listening, so the repair is saved and the labels re-rendered.
    editor.commands.dedupeCitationKeys();

    // A new chapter (a heading and an empty paragraph) opens ready to type: the cursor in the
    // paragraph. Before, nothing had focus, and Ctrl+/ did nothing until the student clicked
    // (2026-10-04 journey audit). Once per chapter: this effect runs again later, and moving the
    // cursor then would take it from wherever the student had put it.
    if (
      focusedChapterRef.current !== chapter.id &&
      editor.state.doc.childCount <= 2 &&
      editor.state.doc.textContent.trim().length < 80
    ) {
      editor.commands.focus('end');
    }
    focusedChapterRef.current = chapter.id;

    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void autosave.flush().then(() =>
          api(`/chapters/${chapter.id}/snapshot`, {
            method: 'POST',
            body: JSON.stringify({ reason: 'MANUAL' }),
          })
            .then(() => setNotice(tNow('editor.snapshotSaved')))
            .catch(() => setNotice(tNow('editor.snapshotFailed'))),
        );
      }
    };
    window.addEventListener('keydown', onKey);
    const onBeforeUnload = () => {
      void autosave.flush();
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onBeforeUnload);
      void autosave.flush();
      autosave.stop();
    };
  }, [editor, live, chapter.id, chapter.version]);

  useEffect(() => {
    if (!noticeRaw) return;
    // Keyed on the stored value, not the derived object, which is new on every render.
    const lingers = typeof noticeRaw !== 'string' && noticeRaw.action !== null;
    // Long enough to read a sentence; longer when there is something to do about it.
    const t = setTimeout(() => setNotice(null), lingers ? 15_000 : 8_000);
    return () => clearTimeout(t);
  }, [noticeRaw]);

  /**
   * FR-5.2: a style switch re-renders every citation without touching the document — the labels
   * live in the extension's storage, and `setCitationStyle` dispatches a re-render transaction.
   */
  const applyRendered = useCallback((rendered: Rendered) => {
    const current = editorRef.current;
    if (!current) return;
    current.commands.setCitationStyle(
      rendered.style,
      rendered.labels,
      rendered.noteStyle === true,
      rendered.styleFamily === 'numeric',
    );
    // A citation whose source left the library is drawn red (B.5); before ADR-0045 nothing in
    // the app ever told the editor which those were.
    for (const sourceId of rendered.missingSourceIds ?? []) {
      current.commands.markSourceRemoved(sourceId);
    }
  }, []);

  /**
   * The labels used to arrive only when the Citations tab was opened, so every chapter opened on
   * any other tab showed "(Source, n.d.)" for each citation (found 2026-09-27 while photographing
   * the editor). They load with the chapter now, again whenever a citation appears whose key has
   * no label yet, and — ADR-0045 — after every save: the server renders the saved document, so
   * only then can a new node get its real label, a numeric style renumber after a deletion, or
   * the "(Kumar, 2021)" a suggestion seeded become the "[7]" the style actually wants.
   */
  useEffect(() => {
    if (!editor) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      api<Rendered>(`/documents/${doc.id}/citations`)
        .then((rendered) => {
          if (live) applyRendered(rendered);
        })
        .catch(() => undefined);
    };
    refreshLabelsRef.current = refresh;
    const unlabeled = () => {
      const labels =
        (editor.storage as { citation?: { renderedMap?: Record<string, string> } }).citation
          ?.renderedMap ?? {};
      let missing = false;
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'citation' && !labels[String(node.attrs.key)]) missing = true;
        return !missing;
      });
      return missing;
    };
    const onUpdate = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (unlabeled()) refresh();
      }, 1000);
    };
    refresh();
    editor.on('update', onUpdate);
    return () => {
      live = false;
      clearTimeout(timer);
      editor.off('update', onUpdate);
    };
  }, [editor, doc.id, applyRendered]);

  /**
   * D.1.3's "Suggest fix". Until scoped revision lands (A.14, Block 2) this selects the flagged
   * range and points the student at the command toolbar, which is the same COMMAND-capped path a
   * fix would take. It never edits the chapter — no flag is ever applied automatically.
   */
  const suggestFix = useCallback((flag: Flag) => {
    const editorInstance = editorRef.current;
    if (!editorInstance) return;
    editorInstance
      .chain()
      .focus()
      .setTextSelection({ from: flag.from, to: flag.to })
      .scrollIntoView()
      .run();
    setNotice(tNow('editor.notice.flagSelected', { flag: flag.description }));
  }, []);

  const assist = usage?.actions.find((a) => a.action === 'ASSIST');
  const draft = usage?.actions.find((a) => a.action === 'DRAFT');
  const ghost = editor ? getGhostState(editor) : undefined;

  return (
    <div className="flex min-h-dvh flex-col">
      {/* One line from `lg` up (2026-09-28): the header used to wrap when its right side grew —
          the save status going from "Saved" to "Unsaved changes" or "Saving…" — which pushed the
          whole page down a line under the student's pointer. A click that started on a button
          ended on whatever moved there, and was lost. The title truncates instead. */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2 lg:flex-nowrap">
        {/* A floor on the width (2026-10-04): with a long title and a crowded right side the
            breadcrumb shrank to "Theses / /". Now it wraps to its own line before it vanishes. */}
        <div className="flex min-w-[14rem] flex-1 items-baseline gap-2 text-[13px]">
          <Link href="/app" className="shrink-0 text-muted hover:text-accent">
            {t('common.theses')}
          </Link>
          <span className="shrink-0 text-faint" aria-hidden="true">
            /
          </span>
          <span className="min-w-[5rem] truncate font-semibold text-ink" title={doc.title}>
            {doc.title}
          </span>
          <span className="shrink-0 text-faint" aria-hidden="true">
            /
          </span>
          <span className="min-w-[4rem] truncate text-muted" title={chapter.title}>
            {chapter.title}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1 lg:shrink-0 lg:flex-nowrap">
          <span
            data-testid="autosave-status"
            // A fixed width, so "Saved" becoming "Unsaved changes" does not shift the buttons.
            className={`inline-block min-w-[7.5rem] whitespace-nowrap px-1.5 text-right text-[12px] ${
              status === 'conflict' || status === 'error' ? 'font-semibold text-warn' : 'text-faint'
            }`}
          >
            {live
              ? conflict
                ? t('editor.status.conflict')
                : !liveState.online
                  ? t('editor.live.reconnecting')
                  : !liveState.synced
                    ? t('editor.live.connecting')
                    : liveState.others.length === 0
                      ? t('editor.live.live')
                      : t('editor.live.with', { names: liveState.others.join(', ') })
              : t(STATUS_LABEL[status])}
          </span>
          <span
            data-testid="usage-meter"
            className="tnum mr-1 whitespace-nowrap border-l border-line pl-3 text-[12px] text-muted"
          >
            {t('editor.usage', {
              assist: assist ? `${assist.used}/${assist.cap}` : '–',
              draft: draft ? `${draft.used}/${draft.cap}` : '–',
            })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            data-testid="open-history"
            onClick={() => setHistoryOpen(true)}
          >
            {t('editor.history')}
          </Button>
          <ShareButton documentId={doc.id} />
          <ThemeToggle className="mr-1 hidden xl:inline-flex" />
          <Button
            variant="ghost"
            size="sm"
            className="hidden md:inline-flex"
            onClick={() => setHowOpen(true)}
          >
            {t('editor.howSuggestions')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="hidden md:inline-flex"
            onClick={() => setFeedbackOpen((open) => !open)}
          >
            {t('editor.feedback')}
          </Button>
          {/* The same two, on a screen too narrow for them to sit in the bar. */}
          <span className="relative md:hidden">
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={moreOpen}
              data-testid="header-more"
              onClick={() => setMoreOpen((open) => !open)}
            >
              {t('common.more')}
            </Button>
            {moreOpen ? (
              <span className="absolute right-0 top-full z-40 mt-1 grid w-52 rounded-md border border-line bg-surface p-1 shadow-lg">
                <button
                  type="button"
                  className="rounded px-2 py-1.5 text-left text-sm hover:bg-sunk"
                  onClick={() => {
                    setMoreOpen(false);
                    setHowOpen(true);
                  }}
                >
                  {t('editor.howSuggestions')}
                </button>
                <a
                  href="/help"
                  target="_blank"
                  rel="noopener"
                  className="rounded px-2 py-1.5 text-left text-sm hover:bg-sunk"
                  onClick={() => setMoreOpen(false)}
                >
                  {t('common.help')}
                </a>
                <button
                  type="button"
                  className="rounded px-2 py-1.5 text-left text-sm hover:bg-sunk"
                  onClick={() => {
                    setMoreOpen(false);
                    setFeedbackOpen(true);
                  }}
                >
                  {t('editor.feedback')}
                </button>
              </span>
            ) : null}
          </span>
          {exported ? (
            <a
              href={exported.url}
              download={exported.filename}
              data-testid="export-link"
              className="rounded-md border border-line-strong bg-surface px-2.5 py-1 text-[12px] font-semibold text-accent transition-colors hover:bg-sunk"
            >
              {t('editor.download', { file: exported.filename })}
            </a>
          ) : (
            <button
              type="button"
              className="rounded-md border border-line-strong bg-surface px-2.5 py-1 text-[12px] font-semibold text-ink transition-colors hover:bg-sunk disabled:opacity-45"
              disabled={exporting}
              title={t('editor.exportTitle')}
              onClick={() => {
                // FR-8.1: the export is a signed link, shown rather than opened, because a tab
                // opened after an await is what popup blockers exist to stop.
                setExporting(true);
                api<ExportResult>(`/documents/${doc.id}/export`, {
                  method: 'POST',
                  body: JSON.stringify({ chapterId: chapter.id, format: 'docx' }),
                })
                  .then(setExported)
                  .catch((e: unknown) =>
                    setNotice(
                      e instanceof ApiError
                        ? (e.problem.detail ?? e.problem.title)
                        : tNow('editor.exportError'),
                    ),
                  )
                  .finally(() => setExporting(false));
              }}
            >
              {exporting ? t('editor.exporting') : t('editor.export')}
            </button>
          )}
        </div>
      </header>

      {conflict ? (
        <div
          role="alert"
          className="border-b border-warn/40 bg-warn/10 px-4 py-2 text-sm text-warn"
        >
          {t('editor.conflictBanner')}{' '}
          <button type="button" className="underline" onClick={() => window.location.reload()}>
            {t('editor.reload')}
          </button>
        </div>
      ) : null}

      {undoVersionId ? (
        <div
          role="status"
          data-testid="restore-banner"
          className="border-b border-line bg-accent-soft px-4 py-2 text-sm text-ink"
        >
          {t('editor.restoreBanner')}{' '}
          <button
            type="button"
            className="font-semibold underline"
            disabled={undoing}
            onClick={() => {
              // Undo is another restore — of the snapshot the first one wrote — and it writes its
              // own PRE_RESTORE, so undoing the undo is possible too, from History.
              setUndoing(true);
              api(`/versions/${undoVersionId}/restore`, {
                method: 'POST',
                body: JSON.stringify({}),
              })
                .then(() => {
                  const url = new URL(window.location.href);
                  url.searchParams.delete(UNDO_PARAM);
                  window.location.assign(url.toString());
                })
                .catch(() => {
                  setUndoing(false);
                  setNotice(tNow('editor.undoError'));
                });
            }}
          >
            {undoing ? t('editor.undoing') : t('editor.undo')}
          </button>{' '}
          ·{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.delete(UNDO_PARAM);
              window.history.replaceState(null, '', url.toString());
              setUndoVersionId(null);
            }}
          >
            {t('common.dismiss')}
          </button>
        </div>
      ) : null}

      {localDraft && editor ? (
        <div role="status" className="border-b border-line bg-paper px-4 py-2 text-sm">
          {t('editor.localDraft', { time: new Date(localDraft.savedAt).toLocaleTimeString() })}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              editor.commands.setContent(localDraft.content as never);
              setLocalDraft(null);
            }}
          >
            {t('editor.restore')}
          </button>{' '}
          ·{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              autosaveRef.current?.clearLocalDraft();
              setLocalDraft(null);
            }}
          >
            {t('common.discard')}
          </button>
        </div>
      ) : null}

      <div className="flex flex-1">
        <aside
          data-testid="chapter-rail"
          className={`shrink-0 border-r border-line bg-sunk px-3 py-4 md:static md:z-auto md:block md:w-56 md:overflow-visible md:shadow-none ${
            drawer === 'chapters'
              ? 'fixed inset-y-0 left-0 z-40 w-[min(18rem,85vw)] overflow-y-auto shadow-2xl'
              : 'hidden'
          }`}
        >
          <p className="mb-2 flex items-baseline justify-between gap-2">
            <span className="eyebrow">{t('editor.chapters')}</span>
            <Link
              href={`/app/d/${doc.id}/outline`}
              className="text-[11px] font-semibold text-muted hover:text-accent"
            >
              {t('editor.outline')}
            </Link>
          </p>
          <ul className="grid list-none gap-0.5 p-0">
            {doc.chapters.map((c, index) => (
              <li key={c.id}>
                <Link
                  href={`/app/d/${doc.id}/write/${c.id}`}
                  aria-current={c.id === chapter.id ? 'page' : undefined}
                  className={`block rounded-md border-l-2 px-2 py-1.5 text-[13px] transition-colors ${
                    c.id === chapter.id
                      ? 'border-accent bg-surface font-semibold text-ink'
                      : 'border-transparent text-muted hover:bg-surface hover:text-ink'
                  }`}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate">{chapterLabel(c.title, index)}</span>
                    <span className="tnum shrink-0 text-[11px] text-faint">{c.wordCount}</span>
                  </span>
                </Link>
                {c.id === chapter.id ? <ChapterContents editor={editor} /> : null}
              </li>
            ))}
          </ul>
          {outlineBuilding ? (
            <p className="mt-3 text-[12px] text-muted" role="status" data-testid="outline-building">
              {t('editor.outlineBuilding')}
            </p>
          ) : null}
          <WordImport documentId={doc.id} />
        </aside>

        {/* min-w-0 so a wide table or equation scrolls inside the page instead of widening it. */}
        <main className="min-w-0 flex-1 px-4 pt-8 pb-24 sm:px-6 lg:pb-8">
          <ScaffoldPanel documentId={doc.id} outlineNodeId={chapter.outlineNodeId} />
          {/* ADR-0070: the next-step guide. ADR-0073: while it shows, it is the only card above
              the page — its last step is planning (the proposal), its second links the
              walkthrough — so the proposal prompt and the first-run hint wait until it is done. */}
          <FirstSessionGuide
            documentId={doc.id}
            editor={editor}
            onSuggest={() => editor?.chain().focus().requestSuggestion().run()}
            onShowSources={() => setTab('sources')}
            onHowItWorks={() => setHowOpen(true)}
            onVisibleChange={setGuideShown}
            className="mx-auto mb-4 max-w-[72ch]"
          />
          {guideShown ? null : (
            /* ADR-0062: a thesis begun with "Start writing now" has no proposal yet. */
            <AddProposalPrompt
              documentId={doc.id}
              variant="editor"
              className="mx-auto mb-4 max-w-[72ch]"
            />
          )}
          {guideShown ? null : (
            <FirstRunHint id="editor" className="mx-auto mb-4 max-w-[72ch]">
              {t('editor.hint.intro')}{' '}
              {autoSuggest ? t('editor.hint.auto') : t('editor.hint.manual')}
              {autoSuggest ? null : (
                <span className="hidden sm:inline">
                  {' '}
                  {rich('editor.hint.orKey', { key: <kbd>Ctrl+/</kbd> })}
                </span>
              )}
              {t('editor.hint.stop')}{' '}
              <span className="hidden sm:inline">
                {rich('editor.hint.keys', { tab: <kbd>Tab</kbd>, esc: <kbd>Esc</kbd> })}{' '}
              </span>
              {t('editor.hint.cites')}{' '}
              <button type="button" className="underline" onClick={() => setHowOpen(true)}>
                {t('editor.hint.how')}
              </button>
            </FirstRunHint>
          )}
          {noticeState ? (
            <div className="pointer-events-none fixed inset-x-0 bottom-28 z-40 flex justify-center px-4 lg:bottom-20">
              <div className="pointer-events-auto flex max-w-xl items-start gap-3 rounded-md border border-line bg-surface px-4 py-3 text-sm shadow-lg">
                <p data-testid="notice" role="status" className="flex-1">
                  {noticeState.text}
                </p>
                {noticeState.action === 'findPapers' ? (
                  <a
                    data-testid="notice-action"
                    href={`/app/d/${doc.id}/sources?tab=discover`}
                    className="shrink-0 rounded bg-accent px-2 py-1 text-xs font-medium text-paper"
                  >
                    {t('common.findPapers')}
                  </a>
                ) : null}
                <button
                  type="button"
                  aria-label={t('editor.closeMessage')}
                  className="shrink-0 text-xs text-muted underline"
                  onClick={() => setNotice(null)}
                >
                  {t('common.close')}
                </button>
              </div>
            </div>
          ) : null}
          <FormatToolbar
            editor={editor}
            readEquationPhoto={(image) => {
              const form = new FormData();
              form.append('file', image, 'equation');
              return api<
                | { ok: true; latex: string; reading: string }
                | { ok: false; refusal: string; reading: string }
              >(`/equations/from-photo?documentId=${doc.id}`, {
                method: 'POST',
                body: form,
              }).finally(onUsageChange);
            }}
            describeEquation={(description, current) =>
              api<
                | { ok: true; latex: string; reading: string }
                | { ok: false; refusal: string; reading: string }
              >('/equations/from-words', {
                method: 'POST',
                body: JSON.stringify({ documentId: doc.id, description, current: current || null }),
              }).finally(onUsageChange)
            }
            onInsertImage={insertFigure}
            onInsertChart={openChart}
            onInsertDiagram={openDiagram}
            actionsRef={formatActions}
          />
          <LibraryFilling
            documentId={doc.id}
            onFirstReady={() => {
              setNotice(null);
              // A suggestion still on its way makes the command a no-op; try again shortly
              // rather than lose the one the student is waiting for.
              let tries = 0;
              const ask = () => {
                const asked = editorRef.current?.chain().focus().requestSuggestion().run();
                if (!asked && ++tries < 6) window.setTimeout(ask, 1_000);
              };
              ask();
            }}
          />
          <EditorContent editor={editor} />
          {/* Typing "/" offers the toolbar's blocks at the caret. */}
          <SlashMenu
            editor={editor}
            actionsRef={formatActions}
            canInsertFigure
            onInsertChart={openChart}
            onInsertDiagram={openDiagram}
          />
          <div className="mx-auto mt-8 flex max-w-[72ch] flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-3 text-[11.5px] text-faint">
            {/* A visible way in (2026-10-04): the only one used to be a shortcut a new student had
                to have read about. The mouse keeps the cursor where it was. */}
            <button
              type="button"
              data-testid="suggest-button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor?.chain().focus().requestSuggestion().run()}
              className="rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-semibold text-accent-ink hover:bg-accent-hover"
            >
              {t('editor.suggest')}
            </button>
            {/* ADR-0073: drafting the section was a shortcut only; now it is a button too. */}
            <button
              type="button"
              data-testid="draft-section-button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => window.dispatchEvent(new Event(DRAFT_SECTION_EVENT))}
              className="rounded-md border border-line px-2.5 py-1 text-[11.5px] font-semibold text-ink hover:border-line-strong"
            >
              {t('editor.draftButton')}
            </button>
            {/* ADR-0073: three keys a first-time student needs; the rest behind "More keys". */}
            {(
              [
                ['Ctrl+/', 'editor.key.suggestion'],
                ['Tab', 'editor.key.accept'],
                ['Esc', 'editor.key.dismiss'],
                ...(allKeys
                  ? ([
                      ['Alt+→', 'editor.key.word'],
                      ['Shift+→', 'editor.key.guided'],
                      ['Ctrl+Shift+D', 'editor.key.draft'],
                      ['@', 'editor.key.cite'],
                      ['Ctrl+S', 'editor.key.snapshot'],
                    ] as const)
                  : []),
              ] as const
            ).map(([key, what]) => (
              // Keys mean nothing on a touch screen, so they start at the small-tablet width.
              <span key={key} className="hidden items-center gap-1.5 sm:flex">
                <Kbd>{key}</Kbd>
                {t(what)}
              </span>
            ))}
            <button
              type="button"
              className="hidden underline sm:inline"
              onClick={() => setAllKeys((v) => !v)}
            >
              {allKeys ? t('editor.key.fewer') : t('editor.key.more')}
            </button>
            <WordCount editor={editor} className="ml-auto" />
          </div>
        </main>

        <ReadBesidePane documentId={doc.id} />

        <aside
          data-testid="tool-panel"
          className={`shrink-0 border-l border-line bg-sunk lg:static lg:z-auto lg:block lg:w-72 lg:overflow-visible lg:shadow-none ${
            drawer === 'panel'
              ? 'fixed inset-y-0 right-0 z-40 w-[min(24rem,92vw)] overflow-y-auto shadow-2xl'
              : 'hidden'
          }`}
        >
          <div className="flex items-center justify-between border-b border-line px-3 py-2 lg:hidden">
            <span className="eyebrow">{t('editor.tools')}</span>
            <button
              type="button"
              className="text-xs text-muted underline"
              onClick={() => setDrawer(null)}
            >
              {t('common.close')}
            </button>
          </div>
          <div className="flex border-b border-line" role="tablist">
            {TABS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`flex-1 border-b-2 px-2 py-2 text-[12px] capitalize transition-colors ${
                  tab === id
                    ? 'border-accent bg-surface font-semibold text-ink'
                    : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {t(`editor.tab.${id}`)}
              </button>
            ))}
          </div>
          <div className="p-3 text-[13px] text-muted">
            {tab === 'sources' ? (
              <SourcePins documentId={doc.id} chapterId={chapter.id} />
            ) : tab === 'papers' ? (
              <FindPapersPanel
                documentId={doc.id}
                documentTitle={doc.title}
                editor={editor}
                initialQuery={papersQuery}
              />
            ) : tab === 'citations' ? (
              <>
                <CitationList editor={editor} chapterId={chapter.id} />
                <CitationsPanel
                  documentId={doc.id}
                  chapterId={chapter.id}
                  editor={editor}
                  onRendered={applyRendered}
                />
              </>
            ) : tab === 'chat' ? (
              <ChatPanel
                documentId={doc.id}
                onUsageChange={onUsageChange}
                onAddToDocument={addChatAnswer}
                prefill={chatPrefill}
                onOpenPassage={(sourceId, chunkId) => {
                  // ADR-0068: the passage in the paper reader, not the library list.
                  window.open(
                    `${readerHref(doc.id, sourceId, null, chunkId)}&view=text`,
                    '_blank',
                    'noopener,noreferrer',
                  );
                }}
              />
            ) : tab === 'review' ? (
              <ReviewPanel
                documentId={doc.id}
                chapterId={chapter.id}
                editor={editor}
                activeId={activeComment}
                onActiveChange={setActiveComment}
                save={async () => {
                  await autosaveRef.current?.flush();
                }}
                // The server rewrote the chapter; a reload is what the conflict banner does too,
                // and the save above means there is nothing unsaved to lose by it.
                onChapterChanged={() => window.location.reload()}
              />
            ) : (
              <>
                <ChecksIndex documentId={doc.id} onOpenReview={() => setTab('review')} />
                <FlagsPanel
                  documentId={doc.id}
                  chapterId={chapter.id}
                  editor={editor}
                  onSuggestFix={suggestFix}
                />
                {/* Same tab, because both answer "what should I look at before I hand this in?" */}
                <ProofreadPanel
                  chapterId={chapter.id}
                  editor={editor}
                  save={async () => {
                    await autosaveRef.current?.flush();
                  }}
                  onUsageChange={onUsageChange}
                />
                <ParaphrasePanel chapterId={chapter.id} editor={editor} />
                <SourceQualityPanel documentId={doc.id} />
              </>
            )}
          </div>
        </aside>
      </div>

      {drawer ? (
        <button
          type="button"
          aria-label={t('common.close')}
          data-testid="drawer-backdrop"
          className={`fixed inset-0 z-30 bg-ink/30 ${drawer === 'chapters' ? 'md:hidden' : 'lg:hidden'}`}
          onClick={() => setDrawer(null)}
        />
      ) : null}

      {/* Where the side panels are, on a screen too narrow to show them beside the text. */}
      <nav
        aria-label={t('editor.chapterAndTools')}
        data-testid="mobile-bar"
        className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-line bg-surface lg:hidden"
      >
        <button
          type="button"
          className="shrink-0 px-2.5 py-3 text-[12px] font-semibold text-ink md:hidden"
          aria-expanded={drawer === 'chapters'}
          onClick={() => setDrawer((open) => (open === 'chapters' ? null : 'chapters'))}
        >
          {t('editor.chapters')}
        </button>
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`mobile-${id}`}
            className={`flex-1 shrink-0 px-2 py-3 text-[12px] capitalize ${
              drawer === 'panel' && tab === id ? 'font-semibold text-accent' : 'text-muted'
            }`}
            onClick={() => {
              if (drawer === 'panel' && tab === id) {
                setDrawer(null);
                return;
              }
              setTab(id);
              setDrawer('panel');
            }}
          >
            {t(`editor.tab.${id}`)}
          </button>
        ))}
      </nav>

      {guided.element}
      <SuggestionBar
        editor={editor}
        onRefine={guided.controller.ask}
        resolvePassage={resolvePassage}
      />
      <HowSuggestionsWork open={howOpen} onClose={() => setHowOpen(false)} documentId={doc.id} />
      <ChartDialog
        open={chart !== null}
        initial={chart?.initial ?? null}
        replacing={chart?.replacing ?? false}
        onClose={() => setChart(null)}
        onInsert={insertChart}
      />
      <DiagramDialog
        open={diagram !== null}
        initial={diagram?.initial ?? null}
        replacing={diagram?.replacing ?? false}
        onClose={() => setDiagram(null)}
        onInsert={insertDiagram}
      />
      {historyOpen ? (
        <VersionHistory
          chapterId={chapter.id}
          currentWords={
            editor
              ? Object.values(wordCountByProvenance(editor.state.doc)).reduce((a, b) => a + b, 0)
              : chapter.wordCount
          }
          save={async () => {
            await autosaveRef.current?.flush();
          }}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}

      {feedbackOpen ? (
        <form
          data-testid="feedback-form"
          className="fixed right-4 bottom-16 z-30 w-[24rem] rounded-md border border-line bg-surface p-3 shadow-lg"
          onSubmit={(event) => {
            // PHASES 5.9: the admin receives the document id and the last five suggestion
            // events, never the chapter text.
            event.preventDefault();
            if (!feedbackText.trim()) return;
            setFeedbackBusy(true);
            api('/feedback', {
              method: 'POST',
              body: JSON.stringify({
                documentId: doc.id,
                message: feedbackText.trim(),
                page: window.location.pathname,
              }),
            })
              .then(() => {
                setFeedbackOpen(false);
                setFeedbackText('');
                setNotice(tNow('editor.feedbackSent'));
              })
              .catch(() => setNotice(tNow('editor.feedbackFailed')))
              .finally(() => setFeedbackBusy(false));
          }}
        >
          <label className="text-xs text-muted" htmlFor="feedback-text">
            {t('editor.feedbackLabel')}
          </label>
          <textarea
            id="feedback-text"
            rows={4}
            maxLength={4000}
            value={feedbackText}
            onChange={(event) => setFeedbackText(event.target.value)}
            className="mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
          />
          <div className="mt-2 flex justify-end gap-3 text-xs">
            <button type="button" className="underline" onClick={() => setFeedbackOpen(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={feedbackBusy || !feedbackText.trim()}
              className="rounded-md px-3 py-1 disabled:opacity-50 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
            >
              {feedbackBusy ? t('common.sending') : t('common.send')}
            </button>
          </div>
        </form>
      ) : null}

      <CommandToolbar
        editor={editor}
        documentId={doc.id}
        chapterId={chapter.id}
        onUsageChange={onUsageChange}
        onNotice={setNotice}
        onReviewSelection={(from, to) => {
          // The job reads the saved chapter, so what is on screen is saved first.
          void (async () => {
            try {
              await autosaveRef.current?.flush();
              await api(`/chapters/${chapter.id}/examiner-review`, {
                method: 'POST',
                body: JSON.stringify({ from, to }),
              });
              onUsageChange();
              setTab('flags');
              setDrawer('panel');
              setNotice(
                'The examiner is reading the selection. Its findings appear here as flags.',
              );
            } catch (error) {
              setNotice(
                error instanceof ApiError
                  ? (error.problem.detail ?? error.problem.title)
                  : 'The review could not be started.',
              );
            }
          })();
        }}
        onFindPapers={(text) => {
          setPapersQuery({ text, nonce: Date.now() });
          setTab('papers');
          setDrawer('panel');
        }}
        onAskChat={(text) => {
          setChatPrefill({ text, nonce: Date.now() });
          setTab('chat');
          setDrawer('panel');
        }}
      />

      <CiteSuggestions editor={editor} chapterId={chapter.id} onUsageChange={onUsageChange} />

      {/* Typing `@` cites deliberately; `CiteSuggestions` above offers one when a sentence ends.
          Both insert the same node — the difference is who started it. */}
      <CitePicker editor={editor} documentId={doc.id} />

      {/* ADR-0068: "Cite in my chapter" / "Ask chat about this" from the paper reader. */}
      <ReaderHandoffBar
        editor={editor}
        documentId={doc.id}
        onAsk={(text, mention) => {
          setChatPrefill({ text, nonce: Date.now(), mention });
          setTab('chat');
          setDrawer('panel');
        }}
      />

      <DraftMode
        editor={editor}
        chapterId={chapter.id}
        outlineNodeId={chapter.outlineNodeId}
        onUsageChange={onUsageChange}
      />

      {process.env.NODE_ENV !== 'production' ? (
        <div
          data-testid="dev-timing"
          className="fixed bottom-3 right-3 rounded bg-ink/85 px-3 py-2 font-mono text-[11px] text-paper"
        >
          ghost: {ghost?.status ?? 'idle'} · ttfb {timing ? `${timing.ttfbMs} ms` : '–'} · latency{' '}
          {timing ? `${timing.latencyMs} ms` : '–'}
        </div>
      ) : null}
    </div>
  );
}
