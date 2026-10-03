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
import { API_URL, ApiError, api } from '@/lib/api';
import { COLLAB_CLOSE, connectLive, createLiveDoc, type LiveDoc, othersIn } from '@/lib/collab';
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

import { FirstRunHint } from '../onboarding/FirstRunHint';
import { HowSuggestionsWork } from '../onboarding/HowSuggestionsWork';
import { ThemeToggle } from '../theme';
import { Button } from '../ui/button';
import { Kbd } from '../ui/primitives';
import { ChartDialog } from './ChartDialog';
import { ChatPanel } from './ChatPanel';
import { CitationList } from './CitationList';
import { CitationsPanel, type Rendered } from './CitationsPanel';
import { CitePicker } from './CitePicker';
import { CiteSuggestions } from './CiteSuggestions';
import { CommandToolbar } from './CommandToolbar';
import { DiagramDialog } from './DiagramDialog';
import { DraftMode } from './DraftMode';
import { type Flag, FlagsPanel } from './FlagsPanel';
import { FormatToolbar, WordCount } from './FormatToolbar';
import { useGuidedInput } from './GuidedInput';
import { ParaphrasePanel } from './ParaphrasePanel';
import { ProofreadPanel } from './ProofreadPanel';
import { ReviewPanel } from './ReviewPanel';
import { ScaffoldPanel } from './ScaffoldPanel';
import { ShareButton } from './ShareButton';
import { SourcePins } from './SourcePins';
import { UNDO_PARAM, VersionHistory } from './VersionHistory';

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

const STATUS_LABEL: Record<AutosaveStatus, string> = {
  idle: 'Saved',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  conflict: 'Changed elsewhere',
  error: 'Save failed — retrying',
};

export function ThesisEditor({ documentId, chapterId }: { documentId: string; chapterId: string }) {
  const router = useRouter();
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
        else setError(e instanceof Error ? e.message : 'Could not load the chapter.');
      });
    refreshUsage();
    return () => {
      cancelled = true;
    };
  }, [documentId, chapterId, router, refreshUsage]);

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <p role="alert" className="text-sm text-warn">
          {error}
        </p>
        <Link href="/app" className="mt-4 inline-block text-sm underline">
          Back to your theses
        </Link>
      </main>
    );
  }

  if (!doc || !chapter || liveEmail === undefined) {
    return <p className="p-6 text-sm text-muted">Loading chapter…</p>;
  }

  return (
    <ChapterEditor
      doc={doc}
      chapter={chapter}
      usage={usage}
      onUsageChange={refreshUsage}
      liveEmail={liveEmail}
    />
  );
}

function ChapterEditor({
  doc,
  chapter,
  usage,
  onUsageChange,
  liveEmail,
}: {
  doc: DocumentDetail;
  chapter: ChapterView;
  usage: Usage | null;
  onUsageChange: () => void;
  /** Set when the chapter is edited live (ADR-0028); null keeps autosave. */
  liveEmail: string | null;
}) {
  const [live] = useState<LiveDoc | null>(() => (liveEmail ? createLiveDoc(liveEmail) : null));
  const [liveState, setLiveState] = useState<{
    synced: boolean;
    online: boolean;
    others: string[];
  }>({ synced: false, online: true, others: [] });
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [conflict, setConflict] = useState(false);
  const [timing, setTiming] = useState<Timing | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [localDraft, setLocalDraft] = useState<LocalDraft | null>(null);
  const [tab, setTab] = useState<'sources' | 'citations' | 'chat' | 'flags' | 'review'>('sources');
  const [autoSuggest, setAutoSuggest] = useState(false);
  /** The comment being read in the review tab; clicking its passage in the text selects it too. */
  const [activeComment, setActiveComment] = useState<string | null>(null);

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
            if (e.outcome === 'ACCEPTED' || e.outcome === 'PARTIAL') onUsageChange();
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
              setNotice(
                'The suggestion service did not answer twice in a row. Your writing is saved; try again in a minute.',
              );
              return;
            }
            setNotice(e.message);
          },
          onDone: (info) => {
            retriedRef.current = false;
            // ADR-0037: nothing in the library covers this, and a search has started. Said
            // first, because it is what will actually change the next suggestion.
            // A.1 (2026-09-30): with no source for what comes next, the model writes nothing and
            // names the gap instead of padding the page.
            const gap = info.needsSource ? `: ${info.needsSource}` : '';
            if (info.findingSources) {
              setNotice(
                `No source in your library covers this yet${gap}. We are finding papers on it and adding them to your library now — ask again in a minute for cited text.`,
              );
              return;
            }
            if (info.needsSource) {
              setNotice(
                `No source in your library covers this yet${gap}. Add sources on it in the Sources panel to continue.`,
              );
              return;
            }
            // Empty-grounding state: the suggestion had no passage to draw on. Not an error —
            // a hint about what would make the next one better.
            if (!info.grounded) {
              setNotice(
                info.pinned === 0
                  ? 'That suggestion had no sources to draw on. Pin some in the Sources panel to get cited text.'
                  : 'None of the pinned sources matched this passage, so the suggestion cites nothing.',
              );
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
        },
        // PHASES 3.5: the hover popover reads the real passage behind a citation.
        citation: {
          resolvePassage: async (sourceId, chunkId): Promise<CitationPassage | null> => {
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
                },
              };
            } catch {
              return null;
            }
          },
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
          .then(() => setNotice('Snapshot saved'))
          .catch(() => setNotice('Snapshot failed'));
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

    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void autosave.flush().then(() =>
          api(`/chapters/${chapter.id}/snapshot`, {
            method: 'POST',
            body: JSON.stringify({ reason: 'MANUAL' }),
          })
            .then(() => setNotice('Snapshot saved'))
            .catch(() => setNotice('Snapshot failed')),
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
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

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
    setNotice(
      `Selected the flagged text. Use the toolbar above it to rewrite — the flag says: ${flag.description}`,
    );
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
        <div className="flex min-w-0 flex-1 items-baseline gap-2 text-[13px]">
          <Link href="/app" className="shrink-0 text-muted hover:text-accent">
            Theses
          </Link>
          <span className="shrink-0 text-faint" aria-hidden="true">
            /
          </span>
          <span className="truncate font-semibold text-ink">{doc.title}</span>
          <span className="shrink-0 text-faint" aria-hidden="true">
            /
          </span>
          <span className="truncate text-muted">{chapter.title}</span>
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
                ? 'Changed elsewhere'
                : !liveState.online
                  ? 'Reconnecting…'
                  : !liveState.synced
                    ? 'Connecting…'
                    : liveState.others.length === 0
                      ? 'Live'
                      : `Live with ${liveState.others.join(', ')}`
              : STATUS_LABEL[status]}
          </span>
          <span
            data-testid="usage-meter"
            className="tnum mr-1 whitespace-nowrap border-l border-line pl-3 text-[12px] text-muted"
          >
            Assist {assist ? `${assist.used}/${assist.cap}` : '–'} · Draft{' '}
            {draft ? `${draft.used}/${draft.cap}` : '–'}
          </span>
          <Button
            variant="ghost"
            size="sm"
            data-testid="open-history"
            onClick={() => setHistoryOpen(true)}
          >
            History
          </Button>
          <ShareButton documentId={doc.id} />
          <ThemeToggle className="mr-1 hidden xl:inline-flex" />
          <Button
            variant="ghost"
            size="sm"
            className="hidden md:inline-flex"
            onClick={() => setHowOpen(true)}
          >
            How suggestions work
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="hidden md:inline-flex"
            onClick={() => setFeedbackOpen((open) => !open)}
          >
            Feedback
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
              More
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
                  How suggestions work
                </button>
                <button
                  type="button"
                  className="rounded px-2 py-1.5 text-left text-sm hover:bg-sunk"
                  onClick={() => {
                    setMoreOpen(false);
                    setFeedbackOpen(true);
                  }}
                >
                  Feedback
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
              Download {exported.filename}
            </a>
          ) : (
            <button
              type="button"
              className="rounded-md border border-line-strong bg-surface px-2.5 py-1 text-[12px] font-semibold text-ink transition-colors hover:bg-sunk disabled:opacity-45"
              disabled={exporting}
              title="Plain .docx of this chapter (FR-8.1)"
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
                        : 'The export did not complete. Try again in a minute.',
                    ),
                  )
                  .finally(() => setExporting(false));
              }}
            >
              {exporting ? 'Exporting…' : 'Export .docx'}
            </button>
          )}
        </div>
      </header>

      {conflict ? (
        <div
          role="alert"
          className="border-b border-warn/40 bg-warn/10 px-4 py-2 text-sm text-warn"
        >
          This chapter was changed elsewhere — reload to continue. Autosave is paused.{' '}
          <button type="button" className="underline" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      ) : null}

      {undoVersionId ? (
        <div
          role="status"
          data-testid="restore-banner"
          className="border-b border-line bg-accent-soft px-4 py-2 text-sm text-ink"
        >
          An older version of this chapter is back. What you had before is saved as a version.{' '}
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
                  setNotice('The undo did not complete. The version is still in History.');
                });
            }}
          >
            {undoing ? 'Undoing…' : 'Undo'}
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
            Dismiss
          </button>
        </div>
      ) : null}

      {localDraft && editor ? (
        <div role="status" className="border-b border-line bg-paper px-4 py-2 text-sm">
          Unsaved changes from {new Date(localDraft.savedAt).toLocaleTimeString()} were found in
          this browser.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              editor.commands.setContent(localDraft.content as never);
              setLocalDraft(null);
            }}
          >
            Restore
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
            Discard
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
            <span className="eyebrow">Chapters</span>
            <Link
              href={`/app/d/${doc.id}/outline`}
              className="text-[11px] font-semibold text-muted hover:text-accent"
            >
              Outline
            </Link>
          </p>
          <ul className="grid list-none gap-0.5 p-0">
            {doc.chapters.map((c) => (
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
                    <span className="truncate">
                      {c.order}. {c.title}
                    </span>
                    <span className="tnum shrink-0 text-[11px] text-faint">{c.wordCount}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </aside>

        {/* min-w-0 so a wide table or equation scrolls inside the page instead of widening it. */}
        <main className="min-w-0 flex-1 px-4 pt-8 pb-24 sm:px-6 lg:pb-8">
          <ScaffoldPanel documentId={doc.id} outlineNodeId={chapter.outlineNodeId} />
          <FirstRunHint id="editor" className="mx-auto mb-4 max-w-[72ch]">
            This is your chapter. Write as you normally would; press <kbd>Ctrl+/</kbd> when you want
            a suggestion, and <kbd>Tab</kbd> to keep it. Pin the sources it may cite under Sources.{' '}
            <button type="button" className="underline" onClick={() => setHowOpen(true)}>
              How suggestions work (90 seconds)
            </button>
          </FirstRunHint>
          {notice ? (
            <p
              data-testid="notice"
              role="status"
              className="mx-auto mb-4 max-w-[72ch] text-xs text-muted"
            >
              {notice}
            </p>
          ) : null}
          <FormatToolbar
            editor={editor}
            onInsertImage={insertFigure}
            onInsertChart={openChart}
            onInsertDiagram={openDiagram}
          />
          <EditorContent editor={editor} />
          <div className="mx-auto mt-8 flex max-w-[72ch] flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-3 text-[11.5px] text-faint">
            {[
              ['Ctrl+/', 'suggestion'],
              ['Tab', 'accept'],
              ['Alt+→', 'a word'],
              ['Shift+→', 'guided'],
              ['Esc', 'dismiss'],
              ['Ctrl+S', 'snapshot'],
            ].map(([key, what]) => (
              <span key={key} className="flex items-center gap-1.5">
                <Kbd>{key}</Kbd>
                {what}
              </span>
            ))}
            <WordCount editor={editor} className="ml-auto" />
          </div>
        </main>

        <aside
          data-testid="tool-panel"
          className={`shrink-0 border-l border-line bg-sunk lg:static lg:z-auto lg:block lg:w-72 lg:overflow-visible lg:shadow-none ${
            drawer === 'panel'
              ? 'fixed inset-y-0 right-0 z-40 w-[min(24rem,92vw)] overflow-y-auto shadow-2xl'
              : 'hidden'
          }`}
        >
          <div className="flex items-center justify-between border-b border-line px-3 py-2 lg:hidden">
            <span className="eyebrow">Tools</span>
            <button
              type="button"
              className="text-xs text-muted underline"
              onClick={() => setDrawer(null)}
            >
              Close
            </button>
          </div>
          <div className="flex border-b border-line" role="tablist">
            {(['sources', 'citations', 'chat', 'flags', 'review'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`flex-1 border-b-2 px-2 py-2 text-[12px] capitalize transition-colors ${
                  tab === t
                    ? 'border-accent bg-surface font-semibold text-ink'
                    : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="p-3 text-[13px] text-muted">
            {tab === 'sources' ? (
              <SourcePins documentId={doc.id} chapterId={chapter.id} />
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
                onOpenPassage={(sourceId, chunkId) => {
                  window.open(
                    `/app/d/${doc.id}/sources#source-${sourceId}-${chunkId}`,
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
              </>
            )}
          </div>
        </aside>
      </div>

      {drawer ? (
        <button
          type="button"
          aria-label="Close"
          data-testid="drawer-backdrop"
          className={`fixed inset-0 z-30 bg-ink/30 ${drawer === 'chapters' ? 'md:hidden' : 'lg:hidden'}`}
          onClick={() => setDrawer(null)}
        />
      ) : null}

      {/* Where the side panels are, on a screen too narrow to show them beside the text. */}
      <nav
        aria-label="Chapter and tools"
        data-testid="mobile-bar"
        className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-line bg-surface lg:hidden"
      >
        <button
          type="button"
          className="shrink-0 px-2.5 py-3 text-[12px] font-semibold text-ink md:hidden"
          aria-expanded={drawer === 'chapters'}
          onClick={() => setDrawer((open) => (open === 'chapters' ? null : 'chapters'))}
        >
          Chapters
        </button>
        {(['sources', 'citations', 'chat', 'flags', 'review'] as const).map((t) => (
          <button
            key={t}
            type="button"
            data-testid={`mobile-${t}`}
            className={`flex-1 shrink-0 px-2 py-3 text-[12px] capitalize ${
              drawer === 'panel' && tab === t ? 'font-semibold text-accent' : 'text-muted'
            }`}
            onClick={() => {
              if (drawer === 'panel' && tab === t) {
                setDrawer(null);
                return;
              }
              setTab(t);
              setDrawer('panel');
            }}
          >
            {t}
          </button>
        ))}
      </nav>

      {guided.element}
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
                setNotice(
                  'Thanks — your note is on its way, with the ids of your last few suggestions.',
                );
              })
              .catch(() => setNotice('The note did not send. Try again in a minute.'))
              .finally(() => setFeedbackBusy(false));
          }}
        >
          <label className="text-xs text-muted" htmlFor="feedback-text">
            What happened? The admin gets this note, this document’s id and your last five
            suggestion events — not your text.
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
              Cancel
            </button>
            <button
              type="submit"
              disabled={feedbackBusy || !feedbackText.trim()}
              className="rounded-md px-3 py-1 disabled:opacity-50 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
            >
              {feedbackBusy ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      ) : null}

      <CommandToolbar
        editor={editor}
        chapterId={chapter.id}
        onUsageChange={onUsageChange}
        onNotice={setNotice}
      />

      <CiteSuggestions editor={editor} chapterId={chapter.id} onUsageChange={onUsageChange} />

      {/* Typing `@` cites deliberately; `CiteSuggestions` above offers one when a sentence ends.
          Both insert the same node — the difference is who started it. */}
      <CitePicker editor={editor} documentId={doc.id} />

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
