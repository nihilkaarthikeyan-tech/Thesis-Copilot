'use client';

/**
 * The library's details drawer (Jenni build plan R17, ADR-0104): one paper at a time beside the
 * list — its record and abstract — with ↑ ↓ to step through the papers the list is showing, and
 * what to do with it: **Cite in my chapter** (the reader's own hand-off: the chapter opens and asks
 * where the citation goes), **Ask AI** (the chapter's chat about this paper only, with questions to
 * start from), **Read**, **Edit details**. Esc closes it.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { EditDetails } from '@/components/sources/EditDetails';
import { api } from '@/lib/api';
import { readLastChapter } from '@/lib/last-chapter';
import { mentionLabel } from '@/lib/mentions';
import { readerHref, writeHandoff } from '@/lib/reader';

type DrawerSource = {
  id: string;
  title: string | null;
  authors: Array<{ family?: string; given?: string; literal?: string }> | null;
  year: number | null;
  venue: string | null;
  doi: string | null;
  groundingLevel: string;
  abstract: string | null;
  openAccess: boolean | null;
  hasFile: boolean;
};

/** Questions to start a chat about one paper from. */
const ASK = (label: string) => [
  `Summarize ${label} in five sentences.`,
  `What method and sample did ${label} use?`,
  `What are the limitations of ${label}?`,
];

export function LibraryDrawer(props: {
  documentId: string;
  /** The papers the list shows, in its order: ↑ ↓ step through these. */
  ids: string[];
  sourceId: string;
  onStep: (id: string) => void;
  onClose: () => void;
  onEdited: () => void;
}) {
  const router = useRouter();
  const [source, setSource] = useState<DrawerSource | null>(null);
  const [chapters, setChapters] = useState<Array<{ id: string }>>([]);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setSource(null);
    setEditing(false);
    api<DrawerSource>(`/sources/${props.sourceId}`)
      .then(setSource)
      .catch(() => setNotice('This paper could not be read.'));
  }, [props.sourceId]);

  useEffect(() => {
    api<{ chapters: Array<{ id: string }> }>(`/documents/${props.documentId}`)
      .then((d) => setChapters(d.chapters))
      .catch(() => undefined);
  }, [props.documentId]);

  const index = props.ids.indexOf(props.sourceId);
  const step = useCallback(
    (by: number) => {
      const next = props.ids[index + by];
      if (next) props.onStep(next);
    },
    [props, index],
  );

  // ↑ ↓ step, Esc closes — unless the student is typing in a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable=true]')
      ) {
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        step(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        step(-1);
      } else if (event.key === 'Escape') {
        props.onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, props]);

  /** The chapter the student was last writing in this thesis, else the first. */
  function chapterToOpen(): string | null {
    const last = readLastChapter();
    if (last?.documentId === props.documentId && chapters.some((c) => c.id === last.chapterId)) {
      return last.chapterId;
    }
    return chapters[0]?.id ?? null;
  }

  function toChapter(handoff: () => void) {
    const chapterId = chapterToOpen();
    if (!chapterId) {
      setNotice('This thesis has no chapter yet. Make the outline first.');
      return;
    }
    handoff();
    router.push(`/app/d/${props.documentId}/write/${chapterId}`);
  }

  const label = source ? mentionLabel(source) : 'this paper';
  const who = (source?.authors ?? [])
    .slice(0, 6)
    .map((a) => a.literal ?? [a.given, a.family].filter(Boolean).join(' '))
    .join(', ');

  return (
    <aside
      role="dialog"
      aria-label="Paper details"
      data-testid="library-drawer"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-2 text-sm">
        <span className="tnum text-muted">
          {index + 1} of {props.ids.length}
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous paper"
            disabled={index <= 0}
            onClick={() => step(-1)}
            className="rounded px-2 py-1 hover:bg-sunk disabled:opacity-40"
            data-testid="drawer-prev"
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Next paper"
            disabled={index < 0 || index >= props.ids.length - 1}
            onClick={() => step(1)}
            className="rounded px-2 py-1 hover:bg-sunk disabled:opacity-40"
            data-testid="drawer-next"
          >
            ↓
          </button>
          <button
            type="button"
            aria-label="Close"
            onClick={props.onClose}
            className="ml-2 rounded px-2 py-1 hover:bg-sunk"
          >
            ×
          </button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm">
        {!source ? (
          <p className="text-muted">{notice ?? 'Reading…'}</p>
        ) : (
          <>
            <h2
              className="text-[16px] font-semibold leading-snug text-ink"
              data-testid="drawer-title"
            >
              {source.title ?? 'Untitled source'}
            </h2>
            {who ? <p className="mt-1 text-muted">{who}</p> : null}
            <p className="mt-1 text-[13px] text-muted">
              {[source.year, source.venue].filter(Boolean).join(' · ')}
              {source.openAccess === true ? ' · Open access' : ''}
              {source.groundingLevel === 'FULL_TEXT'
                ? ' · Full text read'
                : source.groundingLevel === 'ABSTRACT'
                  ? ' · Abstract only'
                  : ''}
            </p>
            {source.doi ? (
              <a
                href={`https://doi.org/${source.doi}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-[13px] text-accent underline"
              >
                {source.doi} ↗
              </a>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-semibold text-accent-ink"
                data-testid="drawer-cite"
                onClick={() =>
                  toChapter(() =>
                    writeHandoff({
                      kind: 'cite',
                      documentId: props.documentId,
                      sourceId: source.id,
                      chunkId: null,
                      page: null,
                      label,
                      title: source.title,
                    }),
                  )
                }
              >
                Cite in my chapter
              </button>
              <button
                type="button"
                className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] font-semibold"
                data-testid="drawer-ask"
                onClick={() =>
                  toChapter(() =>
                    writeHandoff({
                      kind: 'ask',
                      documentId: props.documentId,
                      sourceId: source.id,
                      text: '',
                      label,
                      readable: source.groundingLevel !== 'NONE',
                      questions: ASK(label),
                    }),
                  )
                }
              >
                Ask AI
              </button>
              <Link
                href={readerHref(props.documentId, source.id)}
                className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] font-semibold"
              >
                Read
              </Link>
              <button
                type="button"
                className="rounded-md border border-line-strong px-3 py-1.5 text-[13px] font-semibold"
                aria-expanded={editing}
                onClick={() => setEditing((on) => !on)}
              >
                Edit details
              </button>
            </div>
            {editing ? (
              <EditDetails
                sourceId={source.id}
                onCancel={() => setEditing(false)}
                onSaved={() => {
                  setEditing(false);
                  props.onEdited();
                  api<DrawerSource>(`/sources/${source.id}`)
                    .then(setSource)
                    .catch(() => undefined);
                }}
              />
            ) : null}
            {notice ? <p className="mt-2 text-xs text-warn">{notice}</p> : null}
            <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Abstract
            </h3>
            <p
              className="mt-1 whitespace-pre-line leading-relaxed text-ink"
              data-testid="drawer-abstract"
            >
              {source.abstract ?? 'No abstract was found for this paper.'}
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
