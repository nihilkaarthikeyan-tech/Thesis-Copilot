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
  createAutosave,
  getGhostState,
  type LocalDraft,
  thesisExtensions,
} from '@tc/ui';
import { EditorContent, useEditor } from '@tiptap/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { assistRequest } from '@/lib/sse';

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
  const [tab, setTab] = useState<'sources' | 'citations'>('sources');
  const autosaveRef = useRef<Autosave | null>(null);

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
          onError: (e) => setNotice(e.message),
          promptForInstruction: () =>
            Promise.resolve(
              window.prompt('Guide the suggestion (e.g. "contrast with the 2019 study")'),
            ),
        },
        draft: {
          onBeforeAccept: async (draftId) => {
            await autosaveRef.current?.flush();
            await api(`/chapters/${chapter.id}/snapshot`, {
              method: 'POST',
              body: JSON.stringify({ reason: 'PRE_DRAFT_ACCEPT' }),
            }).catch(() => undefined);
            void draftId;
          },
        },
        resizableTables: true,
      }),
    [chapter.id, reducedMotion, onUsageChange],
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
          <span className="rounded-md border border-line px-2 py-0.5 text-xs">
            <strong>Assist</strong> <span className="text-muted">| Draft (week 4)</span>
          </span>
          <button
            type="button"
            className="text-xs text-muted"
            disabled
            title="Export arrives in week 4"
          >
            Export
          </button>
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
          <p className="mb-2 text-xs uppercase tracking-wide text-muted">Chapters</p>
          <ul className="space-y-1">
            {doc.chapters.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/app/d/${doc.id}/write/${c.id}`}
                  className={`block rounded px-2 py-1 ${c.id === chapter.id ? 'bg-white font-medium' : 'hover:bg-white'}`}
                >
                  {c.order}. {c.title}
                </Link>
              </li>
            ))}
          </ul>
        </aside>

        <main className="flex-1 px-6 py-8">
          {notice ? (
            <p role="status" className="mx-auto mb-4 max-w-[72ch] text-xs text-muted">
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
            {(['sources', 'citations'] as const).map((t) => (
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
              <p>
                Pin sources for this chapter to enable grounded suggestions. The library arrives in
                week 2.
              </p>
            ) : (
              <p>Citations in this chapter will be listed here (week 3).</p>
            )}
          </div>
        </aside>
      </div>

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
