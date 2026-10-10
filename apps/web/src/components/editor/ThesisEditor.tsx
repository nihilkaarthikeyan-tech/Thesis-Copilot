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

import {
  type ChartSpec,
  chartSpecSchema,
  type DiagramSpec,
  diagramSpecSchema,
  readSetupCard,
  type SetupCard as SetupState,
  setupStepNumber,
} from '@tc/types';
import {
  type Autosave,
  type AutosaveStatus,
  aiTextToFragment,
  type BlockHandleStorage,
  type BlockMenuRequest,
  type CitationPassage,
  createAutosave,
  getGhostState,
  type LocalDraft,
  sectionAt,
  setAutoSuggest as setEditorAutoSuggest,
  setTableOfContentsLabels,
  tableRowsAt,
  tableToChartInput,
  thesisExtensions,
  wordCountByProvenance,
} from '@tc/ui';
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import {
  Ellipsis,
  Library,
  ListChecks,
  ListTree,
  type LucideIcon,
  MessageSquare,
  MessageSquareText,
  Quote,
  Search,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type MessageKey, tNow } from '@/i18n';
import { useT } from '@/i18n/react';
import { API_URL, ApiError, api } from '@/lib/api';
import { type BlockCheck, type BlockCheckRequest, blockCheckRequest } from '@/lib/block-check';
import { chapterLabel } from '@/lib/chapter-label';
import { COLLAB_CLOSE, connectLive, createLiveDoc, type LiveDoc, othersIn } from '@/lib/collab';
import { rememberLastChapter } from '@/lib/last-chapter';
import { type LimitRefusal, limitNotice, limitRefusal } from '@/lib/limit';
import { canReadBeside, requestReadBeside } from '@/lib/read-beside';
import { readerHref } from '@/lib/reader';
import { assistRequest } from '@/lib/sse';
import { useStayInWindow } from '@/lib/stay-in-window';

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
import { ExportDialog } from '../export/ExportDialog';
import { LimitNotice } from '../LimitNotice';
import { FeatureDot, noteFeatureUsed } from '../onboarding/FeatureDot';
import { FirstRunHint } from '../onboarding/FirstRunHint';
import { HowSuggestionsWork } from '../onboarding/HowSuggestionsWork';
import { SetupCard } from '../onboarding/SetupCard';
import { applyFontStyle, ThemeToggle } from '../theme';
import { UsageMenu } from '../UsageMenu';
import { Kbd } from '../ui/primitives';
import { AiStatementDialog } from './AiStatementDialog';
import { BlockMenu } from './BlockMenu';
import { ChapterContents } from './ChapterContents';
import { ChartDialog } from './ChartDialog';
import type { Mention } from './ChatMentions';
import { ChatPanel } from './ChatPanel';
import { ChecksIndex } from './ChecksIndex';
import { CitationList } from './CitationList';
import { CitationsPanel, type Rendered } from './CitationsPanel';
import { CitedSources } from './CitedSources';
import { CitePicker } from './CitePicker';
import { CiteSuggestions } from './CiteSuggestions';
import { AI_EDIT_FOCUS, CommandToolbar } from './CommandToolbar';
import { DiagramDialog } from './DiagramDialog';
import { DRAFT_SECTION_EVENT, DraftMode } from './DraftMode';
import { FindPapersPanel } from './FindPapersPanel';
import { FirstSessionGuide, markSuggestionKept } from './FirstSessionGuide';
import { type Flag, FlagsPanel } from './FlagsPanel';
import { type FormatActions, FormatToolbar, WordCount } from './FormatToolbar';
import { useGuidedInput } from './GuidedInput';
import { KeyboardShortcuts } from './KeyboardShortcuts';
import { LibraryFilling, type LibraryProgress, PAPERS_AWAITED } from './LibraryFilling';
import { ParaphrasePanel } from './ParaphrasePanel';
import { PasteMenu } from './PasteMenu';
import { ProofreadPanel } from './ProofreadPanel';
import { ReadBesidePane } from './ReadBesidePane';
import { ReaderHandoffBar } from './ReaderHandoff';
import { ReviewMode } from './ReviewMode';
import { ReviewPanel } from './ReviewPanel';
import { type PlanState, SectionGuide } from './SectionGuide';
import { ShareButton } from './ShareButton';
import { SlashMenu } from './SlashMenu';
import { LIBRARY_CHANGED, SourcePins } from './SourcePins';
import { SourceQualityPanel } from './SourceQualityPanel';
import { SourceSettings } from './SourceSettings';
import { StatusLine } from './StatusLine';
import { SuggestionBar } from './SuggestionBar';
import { ThesisSwitcher } from './ThesisSwitcher';
import { UNDO_PARAM, VersionHistory } from './VersionHistory';
import { WordImport } from './WordImport';

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
  /** R6: read for the source settings (`meta.sourcePrefs`). ADR-0145: and the setup card. */
  meta?: unknown;
  /** ADR-0145: the setup card's field row and folded Sources line. */
  field?: string | null;
  citationStyle?: string;
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

/**
 * The panel tabs, in order; each label is `editor.tab.<id>`. ADR-0137: Chat first, and the panel
 * opens on it, as Jenni's does.
 */
const TABS = ['chat', 'sources', 'papers', 'citations', 'flags', 'review'] as const;
type Tab = (typeof TABS)[number];

/** The rail's icon for each tool (ADR-0137). */
const TAB_ICONS: Record<Tab, LucideIcon> = {
  chat: MessageSquare,
  sources: Library,
  papers: Search,
  citations: Quote,
  flags: ListChecks,
  review: MessageSquareText,
};

/** The tool the student had open last in this thesis, in this browser; Chat the first time. */
const toolKey = (documentId: string) => `tc.tool.${documentId}`;
function rememberedTool(documentId: string): Tab {
  try {
    const stored = window.localStorage.getItem(toolKey(documentId));
    return (TABS as readonly string[]).includes(stored ?? '') ? (stored as Tab) : 'chat';
  } catch {
    return 'chat';
  }
}
/** Whether the status line above the text is open (ADR-0137), in this browser. */
const LINE_KEY = 'tc.statusLine.open';

/** R11 (ADR-0098): the features a dot points to, on their tabs. */
const FEATURE_HINTS: Partial<Record<(typeof TABS)[number], { id: string; line: string }>> = {
  sources: {
    id: 'library',
    line: 'Your library: add your own PDFs, .bib files or Zotero papers, and suggestions cite them.',
  },
  citations: {
    id: 'cite',
    line: 'Type @ anywhere in your text to cite a paper from your library. It costs nothing.',
  },
  chat: {
    id: 'chat',
    line: 'Ask about your papers: what they found, where they disagree, what is missing.',
  },
  flags: {
    id: 'checks',
    line: 'Check this chapter as an examiner would: unsupported claims, weak citations, gaps.',
  },
};

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
type Notice = { text: string; action: 'findPapers' | null; limit?: LimitRefusal };

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
  /** ADR-0145: bumped when the setup card asks for a plan, so the list watches for it again. */
  const [outlineWatch, setOutlineWatch] = useState(0);
  const watchOutline = useCallback(() => setOutlineWatch((n) => n + 1), []);
  /** ADR-0145: the setup card renamed the thesis or replaced its chapters. */
  const reloadDoc = useCallback(() => {
    void api<DocumentDetail>(`/documents/${documentId}`)
      .then(setDoc)
      .catch(() => undefined);
  }, [documentId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `outlineWatch` restarts the watch.
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
  }, [documentId, outlineWatch]);

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
      onPlanStarted={watchOutline}
      onDocChanged={reloadDoc}
      outlineWatch={outlineWatch}
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
  onPlanStarted,
  onDocChanged,
  outlineWatch,
}: {
  doc: DocumentDetail;
  chapter: ChapterView;
  usage: Usage | null;
  onUsageChange: () => void;
  /** Set when the chapter is edited live (ADR-0028); null keeps autosave. */
  liveEmail: string | null;
  /** The outline is being built from the proposal; the chapter list fills in when it is done. */
  outlineBuilding: boolean;
  /** ADR-0145: the setup card asked for a plan. */
  onPlanStarted: () => void;
  /** ADR-0145: the setup card changed the thesis's title, field or chapters. */
  onDocChanged: () => void;
  outlineWatch: number;
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
  const [tab, setTab] = useState<Tab>(() =>
    typeof window === 'undefined' ? 'chat' : rememberedTool(doc.id),
  );
  useEffect(() => {
    try {
      window.localStorage.setItem(toolKey(doc.id), tab);
    } catch {
      // The panel opens on Chat next time instead.
    }
  }, [doc.id, tab]);
  /** ADR-0137: the one-line status above the text, and what it reads from the parts below it. */
  const [lineOpen, setLineOpen] = useState(false);
  useEffect(() => {
    try {
      setLineOpen(window.localStorage.getItem(LINE_KEY) === '1');
    } catch {
      // Folded, then.
    }
  }, []);
  const setLine = useCallback((open: boolean) => {
    setLineOpen(open);
    try {
      if (open) window.localStorage.setItem(LINE_KEY, '1');
      else window.localStorage.removeItem(LINE_KEY);
    } catch {
      // Holds for this page view.
    }
  }, []);
  const [libraryProgress, setLibraryProgress] = useState<LibraryProgress | null>(null);
  const [planState, setPlanState] = useState<PlanState>(null);
  const [guideStep, setGuideStep] = useState<string | null>(null);
  /** First steps (in the ⋯ menu) shows the guide even after Hide, until the line is folded. */
  const [firstStepsAsked, setFirstStepsAsked] = useState(false);
  const [autoSuggest, setAutoSuggest] = useState(false);
  /** ADR-0073: the next-step guide is on screen, so the other first-run cards wait. */
  const [guideShown, setGuideShown] = useState(false);
  /**
   * ADR-0145: the "Set up this thesis" card, for a thesis New made (`meta.setup`); null for any
   * other. While it is unfinished the four-step guide, the proposal prompt and the first-run hint
   * wait, and until the aim row is answered the opener does not offer a sentence on its own (the
   * thesis has no title or plan to write from yet).
   */
  const [setup, setSetup] = useState<SetupState | null>(() => readSetupCard(doc.meta));
  const setupWaiting = setup !== null && !setup.done;
  const setupOnTop = setupWaiting && setup?.dismissedAt === null;
  // ADR-0151: held only until the thesis has a title. The questions are optional, so the first
  // sentence no longer waits for them (it waited for the aim row under ADR-0145).
  const holdOpener = setupOnTop && (setup?.step === 'title' || setup?.step === 'field');
  /**
   * ADR-0151: the place the title names that no paper in the library names, from the last
   * first-sentence request; the setup card says so with Find papers. Read through a ref by the
   * suggestion callbacks, which are built once.
   */
  const [settingGap, setSettingGap] = useState<string | null>(null);
  const setupOnTopRef = useRef(setupOnTop);
  setupOnTopRef.current = setupOnTop;
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
    api<{ automaticSuggest?: boolean; fontStyle?: unknown }>('/settings')
      .then((s) => {
        setAutoSuggest(s.automaticSuggest === true);
        // R33 (ADR-0120): the account's font style, so a new device opens in it too.
        applyFontStyle(s.fontStyle);
      })
      .catch(() => undefined);
  }, []);
  const [howOpen, setHowOpen] = useState(false);
  // R35 (ADR-0118): the keys and the Markdown the editor understands.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [aiStatementOpen, setAiStatementOpen] = useState(false);
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
    /** R13 (ADR-0100): a part of a page from the reader, and questions to offer with it. */
    attachment?: { id: string; kind: 'image'; name: string };
    questions?: string[];
    /** ADR-0130: the student's own note on a highlight, put after the passage. */
    note?: string;
  } | null>(null);
  /** A selected sentence the student asked papers for; the Papers tab searches it. */
  const [papersQuery, setPapersQuery] = useState<{ text: string; nonce: number } | null>(null);
  /**
   * R26 (ADR-0126): a check on one paragraph (the block menu) or a selection (the toolbar's
   * examiner review). The Check tab's panel for that check runs it, once, and opens its results
   * in the text.
   */
  const [blockCheck, setBlockCheck] = useState<BlockCheckRequest | null>(null);
  /** R11: a tab opened (not the one the page starts on) counts as its feature used. */
  // Compared with the tab before, not "skip the first run": React runs an effect twice in
  // development, and the second run marked the starting tab used on every load.
  const previousTab = useRef(tab);
  useEffect(() => {
    if (previousTab.current === tab) return;
    previousTab.current = tab;
    const hint = FEATURE_HINTS[tab];
    if (hint) noteFeatureUsed(hint.id);
  }, [tab]);
  /** R7: the block the grip's menu is open on, and where to draw it. */
  const [blockMenu, setBlockMenu] = useState<BlockMenuRequest | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  // Measured once open: the header wraps on a phone, so "⋯" may not sit at the window's edge.
  const moreMenu = useStayInWindow<HTMLSpanElement>(moreOpen);
  const moreWrap = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!drawer && !moreOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawer(null);
        setMoreOpen(false);
      }
    };
    const onDown = (event: MouseEvent) => {
      if (moreWrap.current && !moreWrap.current.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    if (moreOpen) document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
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
  const [exportOpen, setExportOpen] = useState(false);
  const autosaveRef = useRef<Autosave | null>(null);
  const guided = useGuidedInput();
  /** The options are built before the editor exists; the retry needs the editor. */
  const editorRef = useRef<Editor | null>(null);
  /** ADR-0070: an uncited suggestion shown while papers loaded, to replace once one is ready. */
  const uncitedWhileLoading = useRef<string | null>(null);
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
          fadeMs: reducedMotion ? 0 : 400,
          onOutcome: (e) => {
            const kept = e.keptChars > 0;
            // ADR-0144: a kept suggestion is what counts against the allowance, and the server
            // counts it when it records the outcome — so the meter is read again only after that
            // answer, or it shows the count from before the keep.
            void api('/assist/outcome', {
              method: 'POST',
              body: JSON.stringify({
                suggestionId: e.suggestionId,
                outcome: e.outcome,
                keptChars: e.keptChars,
              }),
            })
              .catch(() => undefined)
              .then(() => {
                if (kept) onUsageChange();
              });
            if (kept) markSuggestionKept(doc.id);
          },
          onTiming: (t) => {
            setTiming(t);
            onUsageChange();
          },
          onError: (e) => {
            // §6.2 / PHASES 5.2, R31 (ADR-0122): a limit says which allowance, how much of it
            // was used, and when it resets in the student's own calendar — the same message as
            // every other screen. A trial that has ended (ADR-0036) has no reset date.
            const limit = limitRefusal(e.problem ?? { type: e.code, ...e });
            if (limit) {
              setNotice(limitNotice(limit));
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
            setSettingGap(info.settingGap);
            // ADR-0151: no paper on the thesis's place, so no first sentence was offered. The
            // setup card says so when it is on screen; otherwise the notice does, with Find papers.
            if (info.settingGap) {
              if (!setupOnTopRef.current) {
                setNotice({
                  text: tNow('editor.notice.settingGap', { place: info.settingGap }),
                  action: 'findPapers',
                });
              }
              return;
            }
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
            // ADR-0082: the first answer followed a passage's wording and was asked for again.
            if (info.reworded && !info.empty) {
              setNotice(tNow('editor.notice.reworded'));
              return;
            }
            if (info.papersLoading) {
              // Nothing written: wait, and ask again when a paper is ready. Something written:
              // it cites nothing yet, and the student is told citations will follow.
              // Either way the editor waits for the first paper. An uncited suggestion still on
              // screen then is replaced by a cited one (the real-model run, 2026-10-05: it stayed
              // up and blocked every later request, so no cited suggestion ever came).
              if (!info.empty) {
                const shown = editorRef.current ? getGhostState(editorRef.current) : undefined;
                uncitedWhileLoading.current = shown?.suggestionId ?? null;
              }
              window.dispatchEvent(new Event(PAPERS_AWAITED));
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

  /** ADR-0085: the heading under the cursor, for pins that apply to one section only. */
  const [cursorSection, setCursorSection] = useState<string | null>(null);
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { section } = sectionAt(editor.state.doc, editor.state.selection.from);
      setCursorSection((current) => (current === (section ?? null) ? current : (section ?? null)));
    };
    update();
    editor.on('selectionUpdate', update);
    editor.on('update', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('update', update);
    };
  }, [editor]);
  editorRef.current = editor;
  // R27: the chapter the export dialog previews and exports; the text is read when it opens.
  const chapterOrder = doc.chapters.find((c) => c.id === chapter.id)?.order ?? 1;
  const exportChapter = useMemo(
    () => ({
      id: chapter.id,
      title: chapter.title,
      order: chapterOrder,
      content: () => editorRef.current?.getJSON() ?? null,
      // ADR-0150: the export preview draws each citation with the label the editor shows.
      labels: () => ({
        ...((editorRef.current?.storage as { citation?: { renderedMap?: Record<string, string> } })
          ?.citation?.renderedMap ?? {}),
      }),
    }),
    [chapter.id, chapter.title, chapterOrder],
  );
  // ADR-0078: the setting arrives after the editor is built; the extension reads it live.
  useEffect(() => {
    if (editor) setEditorAutoSuggest(editor, autoSuggest && !holdOpener);
  }, [editor, autoSuggest, holdOpener]);
  /** ADR-0145: the setup card, above the toolbar or inside the status line once folded. */
  const setupCardFor = (placement: 'top' | 'line') =>
    setup ? (
      <SetupCard
        doc={doc}
        chapterId={chapter.id}
        editor={editor}
        card={setup}
        onCard={setSetup}
        onDocChanged={onDocChanged}
        onPlanStarted={onPlanStarted}
        plan={planState}
        autoSuggest={autoSuggest}
        placement={placement}
        settingGap={settingGap}
        onFindPapers={() => findPapersFor(doc.title)}
      />
    ) : null;
  // R28 (ADR-0119): the contents block's words in the interface language, read live.
  useEffect(() => {
    if (!editor) return;
    setTableOfContentsLabels(editor, {
      title: t('toc.title'),
      empty: t('toc.empty'),
      goTo: t('toc.goTo'),
    });
  }, [editor, t]);

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
      // ADR-0074: an answer's "### Part" headings arrive as paragraphs of their own, without the
      // marks — a chat heading is not a thesis heading, and the outline is the student's.
      const paragraphs = text
        .replace(/^#{1,4}\s+(.+)$/gm, '\n$1\n')
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
    const lingers =
      typeof noticeRaw !== 'string' && (noticeRaw.action !== null || noticeRaw.limit !== undefined);
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
      // R40 (ADR-0117): citations side by side read as one bracket.
      rendered.clusters ?? [],
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

  // R7: the grip reads its handler when pressed, so setting it after the editor exists is enough.
  useEffect(() => {
    if (!editor) return;
    const storage = editor.storage.blockHandle as BlockHandleStorage | undefined;
    if (!storage) return;
    storage.onMenu = (request) => {
      editor.commands.setActiveBlock(request.pos);
      setBlockMenu(request);
    };
    return () => {
      storage.onMenu = null;
    };
  }, [editor]);
  // ADR-0095: Ctrl+J, as in Jenni — the edit box with text selected, the chat without.
  useEffect(() => {
    if (!editor) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'j') return;
      event.preventDefault();
      const { from, to, empty } = editor.state.selection;
      if (!empty && editor.state.doc.textBetween(from, to, ' ').trim().length >= 20) {
        window.dispatchEvent(new Event(AI_EDIT_FOCUS));
        return;
      }
      setTab('chat');
      setDrawer('panel');
      window.setTimeout(() => document.getElementById('chat-message')?.focus(), 50);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor]);
  const closeBlockMenu = useCallback(() => {
    setBlockMenu(null);
    editor?.commands.setActiveBlock(null);
  }, [editor]);

  /**
   * A check of the Check tab on part of the chapter (R26): the tab opens, and the panel that owns
   * the check saves the chapter, runs it on the range and opens what it finds in the text.
   */
  function checkRange(
    check: BlockCheck,
    from: number,
    to: number,
    scope: BlockCheckRequest['scope'],
  ): void {
    setBlockCheck(blockCheckRequest(check, from, to, scope));
    setTab('flags');
    setDrawer('panel');
  }
  /** The selection toolbar's examiner review of a selection (ADR-0067). */
  function reviewSelection(from: number, to: number): void {
    checkRange('examiner', from, to, 'selection');
  }
  function findPapersFor(text: string): void {
    setPapersQuery({ text, nonce: Date.now() });
    setTab('papers');
    setDrawer('panel');
  }
  function askChatAbout(text: string): void {
    setChatPrefill({ text, nonce: Date.now() });
    setTab('chat');
    setDrawer('panel');
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {/* One line from `lg` up (2026-09-28): the header used to wrap when its right side grew —
          the save status going from "Saved" to "Unsaved changes" or "Saving…" — which pushed the
          whole page down a line under the student's pointer. A click that started on a button
          ended on whatever moved there, and was lost. The title truncates instead. */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2 lg:sticky lg:top-0 lg:z-30 lg:h-12 lg:flex-nowrap lg:py-0">
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
        {/* ADR-0137: Saved, Share, Export and one ⋯ menu for everything else. */}
        <div className="ml-auto flex items-center justify-end gap-1.5 lg:shrink-0">
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
          <ShareButton documentId={doc.id} />
          {/* R27 (ADR-0121): one export dialog — this chapter or the whole thesis, any format,
              a layout and a preview. The file is a signed link shown in the dialog, because a
              tab opened after an await is what popup blockers exist to stop (FR-8.1). */}
          <button
            type="button"
            data-testid="open-export"
            className="rounded-md bg-accent px-3 py-1 text-[12px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
            title={t('editor.exportTitle')}
            onClick={() => setExportOpen(true)}
          >
            {t('editor.export')}
          </button>
          {exportOpen ? (
            <ExportDialog
              open
              onClose={() => setExportOpen(false)}
              documentId={doc.id}
              documentTitle={doc.title}
              chapter={exportChapter}
              initialScope="chapter"
            />
          ) : null}
          <span ref={moreWrap} className="relative">
            <button
              type="button"
              aria-label={t('editor.menu')}
              title={t('editor.menu')}
              aria-haspopup="true"
              aria-expanded={moreOpen}
              data-testid="header-more"
              onClick={() => setMoreOpen((open) => !open)}
              className="inline-flex size-7 items-center justify-center rounded-md border border-line-strong bg-surface text-muted transition-colors hover:bg-sunk hover:text-ink"
            >
              <Ellipsis aria-hidden="true" className="size-4" strokeWidth={1.75} />
            </button>
            {/* Mounted while shut, so the usage counter's numbers are always there to read. */}
            <span
              ref={moreMenu.ref}
              style={moreMenu.style}
              data-testid="header-more-menu"
              className={`absolute right-0 top-full z-40 mt-1 w-64 max-w-[calc(100vw-1rem)] rounded-md border border-line bg-surface p-1 shadow-lg ${
                moreOpen ? 'grid' : 'hidden'
              }`}
            >
              {/* R12 (ADR-0099): the counter opens every allowance, as bars. */}
              <span className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm">
                <span className="text-ink">{t('editor.menu.usage')}</span>
                <UsageMenu
                  testId="usage-meter"
                  className="tnum whitespace-nowrap text-[12px] text-muted underline-offset-2 hover:text-ink hover:underline"
                  label={t('editor.usage', {
                    assist: assist ? `${assist.used}/${assist.cap}` : '–',
                    draft: draft ? `${draft.used}/${draft.cap}` : '–',
                  })}
                />
              </span>
              <button
                type="button"
                data-testid="open-history"
                className="rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-sunk"
                onClick={() => {
                  setMoreOpen(false);
                  setHistoryOpen(true);
                }}
              >
                {t('editor.history')}
              </button>
              {/* ADR-0148: the statement a university asks for, from this thesis's own record. */}
              <button
                type="button"
                data-testid="open-ai-statement"
                className="rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-sunk"
                onClick={() => {
                  setMoreOpen(false);
                  setAiStatementOpen(true);
                }}
              >
                {t('aiStatement.menu')}
              </button>
              <button
                type="button"
                className="rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-sunk"
                onClick={() => {
                  setMoreOpen(false);
                  setHowOpen(true);
                }}
              >
                {t('editor.howSuggestions')}
              </button>
              <button
                type="button"
                data-testid="open-first-steps"
                className="rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-sunk"
                onClick={() => {
                  setMoreOpen(false);
                  setLine(true);
                  setFirstStepsAsked(true);
                  window.scrollTo({ top: 0 });
                  // ADR-0145: an unfinished setup card comes back to the top, too.
                  if (setup && !setup.done && setup.dismissedAt !== null) {
                    void api<{ setup: SetupState }>(`/documents/${doc.id}/setup`, {
                      method: 'PUT',
                      body: JSON.stringify({ dismissed: false }),
                    })
                      .then((view) => setSetup(view.setup))
                      .catch(() => undefined);
                  }
                }}
              >
                {t('editor.menu.firstSteps')}
              </button>
              <button
                type="button"
                className="rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-sunk"
                onClick={() => {
                  setMoreOpen(false);
                  setShortcutsOpen(true);
                }}
              >
                {t('editor.key.all')}
              </button>
              <a
                href="/help"
                target="_blank"
                rel="noopener"
                className="rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-sunk"
                onClick={() => setMoreOpen(false)}
              >
                {t('common.help')}
              </a>
              <button
                type="button"
                className="rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-sunk"
                onClick={() => {
                  setMoreOpen(false);
                  setFeedbackOpen(true);
                }}
              >
                {t('editor.feedback')}
              </button>
              <span className="mt-1 flex items-center justify-between gap-2 border-t border-line px-2 pt-2 pb-1 text-sm">
                <span className="text-ink">{t('editor.menu.theme')}</span>
                <ThemeToggle />
              </span>
            </span>
          </span>
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
          {/* R32 (ADR-0127): the student's other theses and New ▾, above the chapters. */}
          <ThesisSwitcher documentId={doc.id} />
          <p className="mb-2 flex items-baseline justify-between gap-2">
            <span className="eyebrow">{t('editor.chapters')}</span>
            <Link
              href={`/app/d/${doc.id}/outline`}
              className="text-[11px] font-semibold text-muted hover:text-accent"
            >
              {t('editor.outline')}
            </Link>
          </p>
          {/* grid-cols-1 is minmax(0, 1fr): without it the column grew to the longest section
              title in the list below (they do not wrap), wider than the rail, and every
              chapter's word count slid under the editor (2026-10-08, the owner's screenshot). */}
          <ul className="grid list-none grid-cols-1 gap-0.5 p-0">
            {doc.chapters.map((c, index) => (
              <li key={c.id} className="min-w-0">
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
                {c.id === chapter.id ? (
                  <ChapterContents
                    editor={editor}
                    documentId={doc.id}
                    chapterId={chapter.id}
                    onShowSources={() => {
                      setTab('sources');
                      setDrawer('panel');
                    }}
                  />
                ) : null}
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
          {/* ADR-0137: one slim line above the text; Show opens the chapter's plan, the
              first-session guide and the library line, all still mounted while folded. */}
          <StatusLine
            progress={libraryProgress}
            plan={planState}
            step={
              setupOnTop && setup
                ? t(`setup.next.${setup.step}` as MessageKey)
                : setupWaiting
                  ? null
                  : guideStep
            }
            setup={
              !setup
                ? null
                : setup.done
                  ? t('setup.line.done')
                  : setup.dismissedAt !== null
                    ? t('setup.line.later', { n: setupStepNumber(setup.step) })
                    : null
            }
            open={lineOpen}
            onToggle={() => {
              if (lineOpen) setFirstStepsAsked(false);
              setLine(!lineOpen);
            }}
          >
            {/* ADR-0145: once folded (Finish later, or finished), the setup card is here. */}
            {setup && !setupOnTop ? setupCardFor('line') : null}
            {/* ADR-0072: the chapter's plan, with Add heading and Draft for each section. */}
            <SectionGuide
              documentId={doc.id}
              chapterId={chapter.id}
              editor={editor}
              onState={setPlanState}
              watch={outlineWatch}
            />
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
              onStepChange={setGuideStep}
              forceVisible={lineOpen && firstStepsAsked}
              waiting={setupWaiting}
              className="mx-auto mb-4 max-w-[72ch]"
            />
            {guideShown || setupWaiting ? null : (
              /* ADR-0062: a thesis begun with "Start writing now" has no proposal yet. */
              <AddProposalPrompt
                documentId={doc.id}
                variant="editor"
                className="mx-auto mb-4 max-w-[72ch]"
              />
            )}
            {guideShown || setupWaiting ? null : (
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
            <LibraryFilling
              documentId={doc.id}
              onProgress={setLibraryProgress}
              onFirstReady={() => {
                setNotice(null);
                const current = editorRef.current;
                const stale = uncitedWhileLoading.current;
                uncitedWhileLoading.current = null;
                if (current && stale && getGhostState(current)?.suggestionId === stale) {
                  current.commands.dismissSuggestion();
                }
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
          </StatusLine>
          {/* ADR-0145: a new thesis is set up here, at the top of its empty chapter. */}
          {setupOnTop ? setupCardFor('top') : null}
          {noticeState ? (
            <div className="pointer-events-none fixed inset-x-0 bottom-28 z-40 flex justify-center px-4 lg:bottom-20">
              <div className="pointer-events-auto flex min-w-0 max-w-xl items-start gap-3 rounded-md border border-line bg-surface px-4 py-3 text-sm shadow-lg">
                {noticeState.limit ? (
                  // R31 (ADR-0122): the same limit message as every other screen.
                  <div data-testid="notice" className="min-w-0 flex-1">
                    <LimitNotice limit={noticeState.limit} bare />
                  </div>
                ) : (
                  <p data-testid="notice" role="status" className="flex-1">
                    {noticeState.text}
                  </p>
                )}
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
            {/* R35 (ADR-0118): every key and the Markdown shortcuts. Shown at every width: the
                Markdown works from a phone's keyboard too. */}
            <button
              type="button"
              data-testid="keyboard-shortcuts-button"
              className="underline"
              onClick={() => setShortcutsOpen(true)}
            >
              {t('editor.key.all')}
            </button>
            <WordCount editor={editor} className="ml-auto" />
          </div>
        </main>

        <ReadBesidePane documentId={doc.id} />

        {/* ADR-0137: the tool panel opens on Chat, and the six tools are a rail of icons on its
            right edge from `lg` up, each with its name under it. Below `lg` the panel is a drawer
            opened from the bottom bar, as before, and the same tabs sit three by two at its top
            (every name fits in English and Hindi at every width, 2026-10-08). From `lg` the panel
            is sticky under the header and as tall as the window, so the chat box sits at its foot
            and the rest scrolls. One tablist at every width: the rail and the drawer's grid are
            the same buttons, laid out twice. */}
        <aside
          data-testid="tool-panel"
          className={`shrink-0 border-l border-line bg-sunk lg:sticky lg:top-12 lg:z-auto lg:grid lg:h-[calc(100dvh-3rem)] lg:w-[22rem] lg:grid-cols-[minmax(0,1fr)_4.25rem] lg:grid-rows-[auto_minmax(0,1fr)] lg:self-start lg:shadow-none xl:w-[25rem] ${
            drawer === 'panel'
              ? 'fixed inset-y-0 right-0 z-40 flex w-[min(24rem,92vw)] flex-col shadow-2xl'
              : 'hidden'
          }`}
        >
          <div className="flex min-h-11 min-w-0 items-center justify-between gap-2 border-b border-line px-3 py-1.5 lg:col-start-1 lg:row-start-1">
            <h2
              data-testid="tool-panel-title"
              className="min-w-0 truncate text-[14px] font-semibold capitalize text-ink"
            >
              {t(`editor.tab.${tab}`)}
            </h2>
            <span className="flex shrink-0 items-center gap-2">
              {/* Room for the open tool's own actions (Chat's "+ New chat"). */}
              <span id="tool-panel-actions" data-testid="tool-panel-actions" className="contents" />
              <button
                type="button"
                className="text-xs text-muted underline lg:hidden"
                onClick={() => setDrawer(null)}
              >
                {t('common.close')}
              </button>
            </span>
          </div>
          <div
            role="tablist"
            aria-label={t('editor.tools')}
            className="grid grid-cols-3 gap-1 border-b border-line p-1.5 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:flex lg:flex-col lg:items-stretch lg:gap-1 lg:overflow-y-auto lg:border-b-0 lg:border-l lg:bg-surface lg:px-0 lg:py-2"
          >
            {TABS.map((id) => {
              const hint = FEATURE_HINTS[id];
              const Icon = TAB_ICONS[id];
              return (
                <span key={id} className="relative flex min-w-0">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    aria-label={t(`editor.tab.${id}`)}
                    title={t(`editor.tab.${id}`)}
                    data-testid={`tool-rail-${id}`}
                    onClick={() => setTab(id)}
                    className={`flex min-w-0 flex-1 items-center justify-center rounded-md px-2 py-1.5 transition-colors lg:mx-1 lg:flex-col lg:gap-0.5 lg:px-0.5 ${
                      tab === id
                        ? 'bg-surface font-semibold text-ink shadow-sm ring-1 ring-line lg:bg-accent-soft lg:font-normal lg:text-accent lg:shadow-none lg:ring-0'
                        : 'text-muted hover:bg-surface hover:text-ink lg:hover:bg-sunk'
                    }`}
                  >
                    <Icon
                      aria-hidden="true"
                      className="hidden size-[18px] lg:block"
                      strokeWidth={1.75}
                    />
                    <span
                      aria-hidden="true"
                      className="w-full truncate text-center text-[12px] capitalize lg:text-[10px] lg:leading-tight"
                    >
                      {t(`editor.tab.${id}`)}
                    </span>
                  </button>
                  {/* R11: a dot on a feature not yet used, while the first-session guide is not. */}
                  {hint ? (
                    <FeatureDot
                      id={hint.id}
                      line={hint.line}
                      hidden={guideShown}
                      onTry={() => {
                        setTab(id);
                        if (id === 'chat') {
                          window.setTimeout(
                            () => document.getElementById('chat-message')?.focus(),
                            50,
                          );
                        }
                        if (id === 'citations') {
                          // "@" where the student is writing opens the free library picker.
                          editor?.chain().focus().insertContent(' @').run();
                        }
                      }}
                    />
                  ) : null}
                </span>
              );
            })}
          </div>
          <div
            className={`min-h-0 flex-1 p-3 text-[13px] text-muted lg:col-start-1 lg:row-start-2 ${
              tab === 'chat' ? 'flex flex-col' : 'overflow-y-auto'
            }`}
          >
            {tab === 'sources' ? (
              <>
                <SourceSettings documentId={doc.id} meta={doc.meta} />
                <SourcePins documentId={doc.id} chapterId={chapter.id} section={cursorSection} />
              </>
            ) : tab === 'papers' ? (
              <FindPapersPanel
                documentId={doc.id}
                documentTitle={doc.title}
                editor={editor}
                initialQuery={papersQuery}
              />
            ) : tab === 'citations' ? (
              <>
                {/* R19 (ADR-0106): every paper the thesis cites, and keep the found ones. */}
                <CitedSources documentId={doc.id} />
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
                  request={blockCheck}
                  save={async () => {
                    await autosaveRef.current?.flush();
                  }}
                  onNotice={(text) => {
                    setNotice(text);
                    onUsageChange();
                  }}
                  onSuggestFix={suggestFix}
                  onFindPapers={(text) => {
                    setPapersQuery({ text, nonce: Date.now() });
                    setTab('papers');
                    setDrawer('panel');
                  }}
                />
                {/* Same tab, because both answer "what should I look at before I hand this in?" */}
                <ProofreadPanel
                  chapterId={chapter.id}
                  editor={editor}
                  request={blockCheck}
                  save={async () => {
                    await autosaveRef.current?.flush();
                  }}
                  onUsageChange={onUsageChange}
                />
                {/* ADR-0084: the same panel reviewing tone against a sample. */}
                <ProofreadPanel
                  mode="tone"
                  documentId={doc.id}
                  chapterId={chapter.id}
                  editor={editor}
                  request={blockCheck}
                  save={async () => {
                    await autosaveRef.current?.flush();
                  }}
                  onUsageChange={onUsageChange}
                />
                <ParaphrasePanel chapterId={chapter.id} editor={editor} />
                <SourceQualityPanel
                  documentId={doc.id}
                  chapterId={chapter.id}
                  save={async () => {
                    await autosaveRef.current?.flush();
                  }}
                />
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

      {/* Where the side panels are, on a screen too narrow to show them beside the text.
          QA 2026-10-09: seven words at 12 px were 407 px on a 390 px phone and "Comments" was
          cut off. Chapters is now an icon (its name stays as the accessible name and tooltip),
          the tabs share the width with narrow padding, and below 400 px they drop to 11 px —
          every label whole from 360 px up, with room to spare for a wider font. */}
      <nav
        aria-label={t('editor.chapterAndTools')}
        data-testid="mobile-bar"
        className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-line bg-surface lg:hidden"
      >
        <button
          type="button"
          data-testid="mobile-chapters"
          aria-label={t('editor.chapters')}
          title={t('editor.chapters')}
          className="grid shrink-0 place-items-center px-2.5 py-3 text-ink md:hidden"
          aria-expanded={drawer === 'chapters'}
          onClick={() => setDrawer((open) => (open === 'chapters' ? null : 'chapters'))}
        >
          <ListTree aria-hidden="true" className="h-[18px] w-[18px]" />
        </button>
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`mobile-${id}`}
            className={`flex-1 shrink-0 whitespace-nowrap px-1 py-3 text-[11px] capitalize min-[400px]:text-[12px] ${
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
      <KeyboardShortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
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
      {aiStatementOpen ? (
        <AiStatementDialog open onClose={() => setAiStatementOpen(false)} documentId={doc.id} />
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
        onReviewSelection={reviewSelection}
        onFindPapers={findPapersFor}
        onAskChat={askChatAbout}
      />

      <PasteMenu editor={editor} onFindPapers={findPapersFor} />
      {/* R23 (ADR-0110): a check's results walked through in the text. */}
      <ReviewMode
        editor={editor}
        onStart={() => setDrawer(null)}
        onShowChecks={() => {
          setTab('flags');
          setDrawer('panel');
        }}
      />
      <BlockMenu
        editor={editor}
        request={blockMenu}
        onClose={closeBlockMenu}
        onAskChat={askChatAbout}
        onFindPapers={findPapersFor}
        onCheck={(check, from, to) => checkRange(check, from, to, 'paragraph')}
      />

      <CiteSuggestions editor={editor} chapterId={chapter.id} onUsageChange={onUsageChange} />

      {/* Typing `@` cites deliberately; `CiteSuggestions` above offers one when a sentence ends.
          Both insert the same node — the difference is who started it. */}
      <CitePicker editor={editor} documentId={doc.id} />

      {/* ADR-0068: "Cite in my chapter" / "Ask chat about this" from the paper reader. */}
      <ReaderHandoffBar
        editor={editor}
        documentId={doc.id}
        onAsk={(text, mention, extra) => {
          setChatPrefill({ text, nonce: Date.now(), mention, ...extra });
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
          className="pointer-events-none fixed bottom-3 right-3 rounded bg-ink/85 px-3 py-2 font-mono text-[11px] text-paper"
        >
          ghost: {ghost?.status ?? 'idle'} · ttfb {timing ? `${timing.ttfbMs} ms` : '–'} · latency{' '}
          {timing ? `${timing.latencyMs} ms` : '–'}
        </div>
      ) : null}
    </div>
  );
}
