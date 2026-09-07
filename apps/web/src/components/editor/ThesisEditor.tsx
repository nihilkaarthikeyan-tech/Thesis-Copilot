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
  type Autosave,
  type AutosaveStatus,
  type CitationPassage,
  createAutosave,
  getGhostState,
  type LocalDraft,
  thesisExtensions,
} from '@tc/ui';
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL, ApiError, api } from '@/lib/api';
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
  source: { title: string | null; year: number | null; authors: unknown };
  pdfUrl: string | null;
};

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
import { ChatPanel } from './ChatPanel';
import { CitationList } from './CitationList';
import { CitationsPanel, type Rendered } from './CitationsPanel';
import { CiteSuggestions } from './CiteSuggestions';
import { CommandToolbar } from './CommandToolbar';
import { DraftMode } from './DraftMode';
import { type Flag, FlagsPanel } from './FlagsPanel';
import { useGuidedInput } from './GuidedInput';
import { ScaffoldPanel } from './ScaffoldPanel';
import { SourcePins } from './SourcePins';

type ExportResult = { url: string; filename: string; bytes: number };

type ChapterMeta = {
  id: string;
  title: string;
  order: number;
  outlineNodeId: string;
  wordCount: number;
};
type DocumentDetail = { id: string; title: string; chapters: ChapterMeta[] };
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

  if (!doc || !chapter) {
    return <p className="p-6 text-sm text-muted">Loading chapter…</p>;
  }

  return <ChapterEditor doc={doc} chapter={chapter} usage={usage} onUsageChange={refreshUsage} />;
}

function ChapterEditor({
  doc,
  chapter,
  usage,
  onUsageChange,
}: {
  doc: DocumentDetail;
  chapter: ChapterView;
  usage: Usage | null;
  onUsageChange: () => void;
}) {
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [conflict, setConflict] = useState(false);
  const [timing, setTiming] = useState<Timing | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [localDraft, setLocalDraft] = useState<LocalDraft | null>(null);
  const [tab, setTab] = useState<'sources' | 'citations' | 'chat' | 'flags'>('sources');
  const [autoSuggest, setAutoSuggest] = useState(false);

  // FR-4.6: automatic-suggest is per user and off by default (ADR-0006).
  useEffect(() => {
    api<{ automaticSuggest?: boolean }>('/settings')
      .then((s) => setAutoSuggest(s.automaticSuggest === true))
      .catch(() => undefined);
  }, []);
  const [howOpen, setHowOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
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
              const when = e.resetsAt ? formatResetsAt(e.resetsAt) : null;
              setNotice(
                `${e.message}${when ? ` It resets on ${when}.` : ''} Until then, keep writing — nothing you type is affected.`,
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
              };
            } catch {
              return null;
            }
          },
        },
        resizableTables: true,
      }),
    [chapter.id, reducedMotion, onUsageChange, guided.controller, autoSuggest],
  );

  const editor = useEditor({
    extensions,
    content: chapter.content as never,
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

  // Appendix B.7 autosave.
  useEffect(() => {
    if (!editor) return;
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
  }, [editor, chapter.id, chapter.version]);

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
    editorRef.current?.commands.setCitationStyle(rendered.style, rendered.labels);
  }, []);

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
      <header className="flex items-center justify-between gap-4 border-b border-line bg-white px-4 py-2 text-sm">
        <div className="flex min-w-0 items-baseline gap-3">
          <Link href="/app" className="text-muted hover:underline">
            Theses
          </Link>
          <span className="truncate font-medium">{doc.title}</span>
          <span className="text-muted">/</span>
          <span className="truncate">{chapter.title}</span>
        </div>
        <div className="flex items-center gap-4">
          <span
            data-testid="autosave-status"
            className={status === 'conflict' || status === 'error' ? 'text-warn' : 'text-muted'}
          >
            {STATUS_LABEL[status]}
          </span>
          <span data-testid="usage-meter" className="text-muted">
            Assist {assist ? `${assist.used}/${assist.cap}` : '–'} · Draft{' '}
            {draft ? `${draft.used}/${draft.cap}` : '–'}
          </span>
          <button
            type="button"
            className="text-xs text-muted underline"
            onClick={() => setHowOpen(true)}
          >
            How suggestions work
          </button>
          <button
            type="button"
            className="text-xs text-muted underline"
            onClick={() => setFeedbackOpen((open) => !open)}
          >
            Feedback
          </button>
          {exported ? (
            <a
              href={exported.url}
              download={exported.filename}
              data-testid="export-link"
              className="text-xs underline"
            >
              Download {exported.filename}
            </a>
          ) : (
            <button
              type="button"
              className="text-xs text-muted underline"
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
        <aside className="hidden w-56 shrink-0 border-r border-line bg-paper px-3 py-4 text-sm md:block">
          <p className="mb-2 flex items-baseline justify-between text-xs uppercase tracking-wide text-muted">
            <span>Chapters</span>
            <Link href={`/app/d/${doc.id}/outline`} className="normal-case underline">
              Outline
            </Link>
          </p>
          <ul className="space-y-1">
            {doc.chapters.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/app/d/${doc.id}/write/${c.id}`}
                  className={`block rounded px-2 py-1 ${c.id === chapter.id ? 'bg-white font-medium' : 'hover:bg-white'}`}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate">
                      {c.order}. {c.title}
                    </span>
                    <span className="shrink-0 text-xs text-muted">{c.wordCount}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </aside>

        <main className="flex-1 px-6 py-8">
          <ScaffoldPanel documentId={doc.id} outlineNodeId={chapter.outlineNodeId} />
          <FirstRunHint id="editor" className="mx-auto mb-4 max-w-[72ch]">
            This is your chapter. Write as you normally would; press <kbd>Ctrl+/</kbd> when you want
            a suggestion, and <kbd>Tab</kbd> to keep it. Pin the sources it may cite in the panel on
            the right.{' '}
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
          <EditorContent editor={editor} />
          <p className="mx-auto mt-6 max-w-[72ch] text-xs text-muted">
            Ctrl+/ suggestion · Tab accept · Alt+→ accept a word · Shift+→ guided · Esc dismiss ·
            Ctrl+S snapshot
          </p>
        </main>

        <aside className="hidden w-72 shrink-0 border-l border-line bg-paper text-sm lg:block">
          <div className="flex border-b border-line">
            {(['sources', 'citations', 'chat', 'flags'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex-1 px-3 py-2 capitalize ${tab === t ? 'bg-white font-medium' : 'text-muted'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="p-3 text-muted">
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
            ) : (
              <FlagsPanel
                documentId={doc.id}
                chapterId={chapter.id}
                editor={editor}
                onSuggestFix={suggestFix}
              />
            )}
          </div>
        </aside>
      </div>

      {guided.element}
      <HowSuggestionsWork open={howOpen} onClose={() => setHowOpen(false)} />

      {feedbackOpen ? (
        <form
          data-testid="feedback-form"
          className="fixed right-4 bottom-16 z-30 w-[24rem] rounded-lg border border-line bg-white p-3 shadow-lg"
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
            className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
          />
          <div className="mt-2 flex justify-end gap-3 text-xs">
            <button type="button" className="underline" onClick={() => setFeedbackOpen(false)}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={feedbackBusy || !feedbackText.trim()}
              className="rounded-md bg-ink px-3 py-1 text-white disabled:opacity-50"
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

      <DraftMode
        editor={editor}
        chapterId={chapter.id}
        outlineNodeId={chapter.outlineNodeId}
        onUsageChange={onUsageChange}
      />

      {process.env.NODE_ENV !== 'production' ? (
        <div
          data-testid="dev-timing"
          className="fixed bottom-3 right-3 rounded bg-ink/85 px-3 py-2 font-mono text-[11px] text-white"
        >
          ghost: {ghost?.status ?? 'idle'} · ttfb {timing ? `${timing.ttfbMs} ms` : '–'} · latency{' '}
          {timing ? `${timing.latencyMs} ms` : '–'}
        </div>
      ) : null}
    </div>
  );
}
