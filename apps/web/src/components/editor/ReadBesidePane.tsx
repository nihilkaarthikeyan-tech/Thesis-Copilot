'use client';

/**
 * "Read beside" — a source's PDF in a resizable pane to the right of the chapter (2026-10-04,
 * from the Jenni study). Opened by `requestReadBeside` (`lib/read-beside.ts`) from the citation
 * hover card or the Sources tab; mounted once by the editor screen.
 *
 * Since ADR-0068 the PDF is drawn by the paper reader's own pdf.js view (`PdfView`), from bytes
 * the API streams to the owner — not the browser's viewer in an iframe on a storage link. In
 * production the host sends `X-Frame-Options: DENY` on storage links, so the frame was blank
 * there; a canvas on our own page is never framed. The view is keyed on the source and page, so
 * a second citation to the same paper moves it.
 *
 * Desktop only: below `READ_BESIDE_MIN_VIEWPORT` nobody asks for it, and the callers open the
 * paper reader in a new tab instead. "Open in reader" is in the pane's header too.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { PdfView } from '@/components/reader/PdfView';
import {
  clampPaneWidth,
  PANE_DEFAULT_WIDTH,
  PANE_MIN_WIDTH,
  READ_BESIDE,
  type ReadBesideTarget,
} from '@/lib/read-beside';
import { readerHref } from '@/lib/reader';

const WIDTH_KEY = 'tc:read-beside-width';

function storedWidth(): number {
  try {
    const raw = Number(window.localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(raw) && raw >= PANE_MIN_WIDTH ? raw : PANE_DEFAULT_WIDTH;
  } catch {
    return PANE_DEFAULT_WIDTH;
  }
}

export function ReadBesidePane({ documentId }: { documentId: string }) {
  const [target, setTarget] = useState<ReadBesideTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(PANE_DEFAULT_WIDTH);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    setWidth(clampPaneWidth(storedWidth(), window.innerWidth));
  }, []);

  // One listener for every way of asking: the hover card, the Sources tab.
  useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<ReadBesideTarget>).detail;
      if (detail?.sourceId) setTarget(detail);
    };
    window.addEventListener(READ_BESIDE, onRequest);
    return () => window.removeEventListener(READ_BESIDE, onRequest);
  }, []);

  const sourceId = target?.sourceId ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new source starts without an error
  useEffect(() => {
    setError(null);
  }, [sourceId]);

  const close = useCallback(() => setTarget(null), []);

  const commitWidth = useCallback((next: number) => {
    const clamped = clampPaneWidth(next, window.innerWidth);
    setWidth(clamped);
    try {
      window.localStorage.setItem(WIDTH_KEY, String(clamped));
    } catch {
      // A private window: the width is simply not remembered.
    }
  }, []);

  // A window made narrower keeps the chapter readable.
  useEffect(() => {
    if (!target) return;
    const onResize = () => setWidth((w) => clampPaneWidth(w, window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [target]);

  if (!target) return null;

  const page = target.page;

  return (
    <aside
      data-testid="read-beside"
      aria-label="PDF beside the chapter"
      className="sticky top-0 hidden h-dvh shrink-0 self-start border-l border-line bg-surface xl:flex"
      style={{ width }}
    >
      {/* The drag handle: the pane's left edge. Arrow keys resize it too. */}
      {/* biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be dragged or focused. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the PDF pane"
        aria-valuenow={width}
        aria-valuemin={PANE_MIN_WIDTH}
        tabIndex={0}
        data-testid="read-beside-resize"
        className="w-1.5 shrink-0 cursor-col-resize bg-line/60 hover:bg-accent/50 focus:bg-accent/50 focus:outline-none"
        onPointerDown={(e) => {
          e.preventDefault();
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { startX: e.clientX, startWidth: width };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setWidth(
            clampPaneWidth(
              drag.current.startWidth + (drag.current.startX - e.clientX),
              window.innerWidth,
            ),
          );
        }}
        onPointerUp={(e) => {
          if (!drag.current) return;
          const next = drag.current.startWidth + (drag.current.startX - e.clientX);
          drag.current = null;
          commitWidth(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') commitWidth(width + 40);
          else if (e.key === 'ArrowRight') commitWidth(width - 40);
          else if (e.key === 'Escape') close();
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-line px-3 py-2 text-[13px]">
          <span
            className="min-w-0 flex-1 truncate font-semibold text-ink"
            title={target.label ?? ''}
          >
            {target.label || 'Source'}
            {page !== null ? <span className="font-normal text-muted"> · p. {page}</span> : null}
          </span>
          <a
            href={readerHref(documentId, target.sourceId, page)}
            target="_blank"
            rel="noopener"
            className="shrink-0 text-xs text-muted underline hover:text-ink"
            data-testid="read-beside-new-tab"
          >
            Open in reader
          </a>
          <button
            type="button"
            className="shrink-0 text-xs text-muted underline hover:text-ink"
            data-testid="read-beside-close"
            onClick={close}
          >
            Close
          </button>
        </div>
        {error ? (
          <p role="alert" className="p-4 text-sm text-warn">
            {error}
          </p>
        ) : (
          <PdfView
            key={`${target.sourceId}:${page ?? ''}`}
            sourceId={target.sourceId}
            initialPage={page}
            zoom="fit"
            onState={(state) => {
              if (state.status === 'error') {
                setError(
                  state.error === 'There is no PDF for this paper.'
                    ? 'There is no PDF for this source. Add one on the Sources page.'
                    : (state.error ?? 'The PDF could not be opened.'),
                );
              }
            }}
          />
        )}
      </div>
    </aside>
  );
}
