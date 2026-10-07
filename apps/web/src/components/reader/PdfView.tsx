'use client';

/**
 * A source's PDF drawn on our own page with pdf.js (ADR-0068) — not the browser's viewer in a
 * frame. Production's host sends `X-Frame-Options: DENY` on storage links, which left "Read
 * beside" blank there; bytes fetched through the API and drawn onto a canvas are never framed.
 *
 * Pages are drawn only near the viewport (an IntersectionObserver with a margin of one and a half
 * screens) and cleared again when scrolled far away, so a 300-page thesis does not hold 300
 * canvases. Each drawn page gets pdf.js's text layer — transparent text positioned over the
 * canvas — which is what makes the PDF selectable, searchable and copyable.
 *
 * pdf.js and its worker are loaded on first use, from the package (`pdfjs-dist`, pinned): the
 * worker is emitted by webpack from `new URL(…, import.meta.url)` and served from this site, which
 * the CSP's `worker-src 'self'` already allows.
 */

import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_URL } from '@/lib/api';
import { countMatches, SearchIndex } from '@/lib/reader';
import { clearMatches, matchRanges, paintMatches, scrollRangeIntoView } from './highlight';

type PdfJs = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
    return pdfjs;
  });
  return pdfjsPromise;
}

/** What the reader's search bar and selection menu ask of a view. */
export type ReaderView = {
  /** How many matches the whole paper holds for `query`. */
  count: (query: string) => Promise<number>;
  /** Moves to the `index`-th match and marks it. */
  show: (query: string, index: number) => Promise<void>;
  clear: () => void;
};

export type PdfController = ReaderView & {
  goToPage: (page: number) => void;
  /** The index of the first match of `query` on or after `page`, or -1 when there is none. */
  firstFrom: (query: string, page: number) => Promise<number>;
};

export const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3] as const;

/** Space kept either side of the page, so a page fitted to the width still has a margin. */
const GUTTER = 16;

type Size = { width: number; height: number };

export function PdfView({
  sourceId,
  initialPage,
  controller,
  onState,
  zoom,
  onPageChange,
  className,
  boxMode = false,
  onBox,
}: {
  sourceId: string;
  initialPage?: number | null;
  controller?: MutableRefObject<PdfController | null>;
  /** Told when the document has loaded (with its page count) or failed. */
  onState?: (state: {
    status: 'loading' | 'ready' | 'error';
    pages?: number;
    error?: string;
  }) => void;
  /** `fit` fits the widest page to the width; a number is a fixed zoom. */
  zoom: 'fit' | number;
  onPageChange?: (page: number, scale: number) => void;
  className?: string;
  /**
   * Jenni build plan R13 (ADR-0100): while on, dragging on a page draws a box, and letting go
   * hands back that part of the page as a picture.
   */
  boxMode?: boolean;
  onBox?: (shot: { page: number; blob: Blob }) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [width, setWidth] = useState(0);
  const [near, setNear] = useState<Set<number>>(() => new Set([1]));
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  /** Resolvers for "page N's text layer is drawn at the current scale". */
  const textReady = useRef(new Map<number, { promise: Promise<void>; resolve: () => void }>());
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  // Load: the bytes through the API with the session cookie, then pdf.js.
  useEffect(() => {
    let live = true;
    let loaded: PDFDocumentProxy | null = null;
    onStateRef.current?.({ status: 'loading' });
    (async () => {
      const response = await fetch(`${API_URL}/api/v1/sources/${sourceId}/file/content`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? 'There is no PDF for this paper.'
            : 'The PDF could not be fetched.',
        );
      }
      const data = new Uint8Array(await response.arrayBuffer());
      const pdfjs = await loadPdfJs();
      const pdf = await pdfjs.getDocument({ data }).promise;
      loaded = pdf;
      const pages = await Promise.all(
        Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1)),
      );
      if (!live) return;
      setSizes(
        pages.map((p) => {
          const v = p.getViewport({ scale: 1 });
          return { width: v.width, height: v.height };
        }),
      );
      setDoc(pdf);
      onStateRef.current?.({ status: 'ready', pages: pdf.numPages });
    })().catch((error: unknown) => {
      if (!live) return;
      onStateRef.current?.({
        status: 'error',
        error:
          error instanceof Error && /no PDF|fetched/.test(error.message)
            ? error.message
            : 'This PDF could not be drawn. Its text is under Text.',
      });
    });
    return () => {
      live = false;
      // pdf.js 6 releases a document through its loading task (the proxy's own destroy is gone).
      void loaded?.loadingTask.destroy();
    };
  }, [sourceId]);

  // The scroller's width decides "fit width".
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  const widest = useMemo(() => Math.max(1, ...sizes.map((s) => s.width)), [sizes]);
  const scale = useMemo(() => {
    if (zoom !== 'fit') return zoom;
    if (width === 0) return 1;
    return Math.max(0.25, Math.min(4, (width - GUTTER * 2) / widest));
  }, [zoom, width, widest]);

  // A new scale invalidates every drawn text layer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset whenever the scale changes
  useEffect(() => {
    textReady.current.clear();
  }, [scale]);

  const readyFor = useCallback((page: number) => {
    let entry = textReady.current.get(page);
    if (!entry) {
      let resolve = () => {};
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      entry = { promise, resolve };
      textReady.current.set(page, entry);
    }
    return entry;
  }, []);

  // Which pages are near enough to draw.
  useEffect(() => {
    const root = scroller.current;
    if (!root || !doc) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setNear((current) => {
          const next = new Set(current);
          for (const entry of entries) {
            const page = Number((entry.target as HTMLElement).dataset.page);
            if (entry.isIntersecting) next.add(page);
            else next.delete(page);
          }
          return next;
        });
      },
      { root, rootMargin: '150% 0px' },
    );
    for (const el of pageEls.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [doc]);

  // The page being read, for "Page x of N".
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;
  const current = useRef(1);
  const reportPage = useCallback(() => {
    const root = scroller.current;
    if (!root) return;
    const line = root.scrollTop + root.clientHeight * 0.3;
    let page = 1;
    for (const [n, el] of pageEls.current) {
      if (el.offsetTop <= line && n > page) page = n;
    }
    current.current = page;
    onPageChangeRef.current?.(page, scale);
  }, [scale]);
  useEffect(() => {
    reportPage();
  }, [reportPage]);

  const goToPage = useCallback((page: number) => {
    const el = pageEls.current.get(page);
    const root = scroller.current;
    if (el && root) root.scrollTo({ top: el.offsetTop - GUTTER / 2 });
  }, []);

  // Open at the page asked for, once the pages have their sizes.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !doc || sizes.length === 0) return;
    opened.current = true;
    if (initialPage && initialPage > 1) requestAnimationFrame(() => goToPage(initialPage));
  }, [doc, sizes.length, initialPage, goToPage]);

  // Keep the same page in view through a zoom.
  const previousScale = useRef(scale);
  useEffect(() => {
    if (previousScale.current === scale) return;
    previousScale.current = scale;
    const page = current.current;
    requestAnimationFrame(() => goToPage(page));
  }, [scale, goToPage]);

  // Search: every page's text, read once per document.
  const pageTexts = useRef<Promise<string[]> | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new document needs new texts
  useEffect(() => {
    pageTexts.current = null;
  }, [doc]);
  const texts = useCallback(async (): Promise<string[]> => {
    if (!doc) return [];
    pageTexts.current ??= Promise.all(
      Array.from({ length: doc.numPages }, async (_, i) => {
        const page = await doc.getPage(i + 1);
        const content = await page.getTextContent();
        const index = new SearchIndex<null>();
        for (const item of content.items) {
          if (!('str' in item)) continue;
          index.push((item as TextItem).str, () => null);
          if ((item as TextItem).hasEOL) index.gap();
        }
        return index.text;
      }),
    );
    return pageTexts.current;
  }, [doc]);

  const matchesRef = useRef<{ query: string; list: Array<{ page: number; n: number }> }>({
    query: '',
    list: [],
  });

  const count = useCallback(
    async (query: string) => {
      const all = await texts();
      const list: Array<{ page: number; n: number }> = [];
      all.forEach((text, i) => {
        const found = countMatches(text, query);
        for (let n = 0; n < found; n++) list.push({ page: i + 1, n });
      });
      matchesRef.current = { query, list };
      return list.length;
    },
    [texts],
  );

  const firstFrom = useCallback(
    async (query: string, page: number) => {
      await count(query);
      const list = matchesRef.current.list;
      if (list.length === 0) return -1;
      const at = list.findIndex((m) => m.page >= page);
      return at === -1 ? 0 : at;
    },
    [count],
  );

  const show = useCallback(
    async (query: string, index: number) => {
      if (matchesRef.current.query !== query) await count(query);
      const match = matchesRef.current.list[index];
      if (!match) {
        clearMatches();
        return;
      }
      goToPage(match.page);
      setNear((s) => (s.has(match.page) ? s : new Set(s).add(match.page)));
      await Promise.race([readyFor(match.page).promise, new Promise((r) => setTimeout(r, 4_000))]);
      const layer = pageEls.current.get(match.page)?.querySelector('.textLayer');
      const root = scroller.current;
      if (!layer || !root) return;
      const ranges = matchRanges(layer, query);
      const range = ranges[match.n] ?? ranges[0] ?? null;
      paintMatches(ranges, range);
      if (range) scrollRangeIntoView(root, range);
    },
    [count, goToPage, readyFor],
  );

  useEffect(() => {
    if (!controller) return;
    controller.current = { count, show, clear: clearMatches, goToPage, firstFrom };
    return () => {
      controller.current = null;
    };
  }, [controller, count, show, goToPage, firstFrom]);

  return (
    <div
      ref={scroller}
      onScroll={reportPage}
      data-testid="pdf-view"
      className={`relative min-h-0 flex-1 overflow-auto bg-sunk ${className ?? ''}`}
    >
      <div
        className="flex min-w-fit flex-col items-center gap-4 py-4"
        style={{ paddingInline: GUTTER }}
      >
        {doc
          ? sizes.map((size, i) => {
              const page = i + 1;
              return (
                <div
                  key={page}
                  ref={(el) => {
                    if (el) pageEls.current.set(page, el);
                    else pageEls.current.delete(page);
                  }}
                  data-page={page}
                  data-testid="pdf-page"
                  className="reader-pdf-page relative shrink-0 bg-white shadow-sm ring-1 ring-line"
                  style={{
                    width: Math.floor(size.width * scale),
                    height: Math.floor(size.height * scale),
                  }}
                >
                  {near.has(page) ? (
                    <PdfPage
                      doc={doc}
                      page={page}
                      scale={scale}
                      onTextLayer={() => readyFor(page).resolve()}
                    />
                  ) : null}
                  {boxMode && onBox ? <BoxSelect onShot={(blob) => onBox({ page, blob })} /> : null}
                </div>
              );
            })
          : null}
      </div>
    </div>
  );
}

/** One page: the canvas, and the text layer over it. Drawn on mount, redrawn on a new scale. */
function PdfPage({
  doc,
  page,
  scale,
  onTextLayer,
}: {
  doc: PDFDocumentProxy;
  page: number;
  scale: number;
  onTextLayer: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const onTextLayerRef = useRef(onTextLayer);
  onTextLayerRef.current = onTextLayer;

  useEffect(() => {
    let live = true;
    let task: RenderTask | null = null;
    let textLayer: { cancel: () => void } | null = null;
    let proxy: PDFPageProxy | null = null;
    (async () => {
      const pdfjs = await loadPdfJs();
      proxy = await doc.getPage(page);
      if (!live) return;
      const viewport = proxy.getViewport({ scale });
      const canvas = canvasRef.current;
      const container = textRef.current;
      if (!canvas || !container) return;

      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      task = proxy.render({
        canvas,
        viewport,
        ...(ratio !== 1 ? { transform: [ratio, 0, 0, ratio, 0, 0] } : {}),
      });

      // The text layer sizes itself from these (pdf.js `setLayerDimensions`).
      const pageEl = container.parentElement;
      pageEl?.style.setProperty('--scale-factor', String(scale));
      pageEl?.style.setProperty('--total-scale-factor', String(scale));
      container.replaceChildren();
      const layer = new pdfjs.TextLayer({
        textContentSource: proxy.streamTextContent(),
        container,
        viewport,
      });
      textLayer = layer;
      await Promise.all([task.promise, layer.render()]);
      if (live) onTextLayerRef.current();
    })().catch(() => {
      // A cancelled render rejects; anything else leaves a blank page, which the Text view covers.
    });
    return () => {
      live = false;
      task?.cancel();
      textLayer?.cancel();
      const canvas = canvasRef.current;
      if (canvas) {
        // Frees the bitmap now rather than whenever the element is collected.
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, [doc, page, scale]);

  return (
    <>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div ref={textRef} className="textLayer" data-testid="pdf-text-layer" />
    </>
  );
}

/** A box smaller than this, in screen pixels, is a click, not a selection. */
const MIN_BOX = 12;

/**
 * R13: the box drawn over a page. The picture is cut from the page's own canvas at its drawn
 * resolution (the canvas is larger than it shows on a high-density screen), so a figure's small
 * print stays legible to the model.
 */
function BoxSelect({ onShot }: { onShot: (blob: Blob) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBoxState] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // Also kept in a ref: the release reads the box as it is, not as of the last render.
  const boxNow = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const setBox = (next: { x: number; y: number; w: number; h: number } | null) => {
    boxNow.current = next;
    setBoxState(next);
  };
  const start = useRef<{ x: number; y: number } | null>(null);

  const at = (event: React.PointerEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    return rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : { x: 0, y: 0 };
  };

  function cut(area: { x: number; y: number; w: number; h: number }) {
    const canvas = ref.current?.parentElement?.querySelector('canvas');
    if (!canvas || canvas.clientWidth === 0) return;
    const ratio = canvas.width / canvas.clientWidth;
    const out = document.createElement('canvas');
    out.width = Math.round(area.w * ratio);
    out.height = Math.round(area.h * ratio);
    const context = out.getContext('2d');
    if (!context) return;
    context.drawImage(
      canvas,
      Math.round(area.x * ratio),
      Math.round(area.y * ratio),
      out.width,
      out.height,
      0,
      0,
      out.width,
      out.height,
    );
    out.toBlob((blob) => {
      if (blob) onShot(blob);
    }, 'image/png');
  }

  return (
    <div
      ref={ref}
      data-testid="pdf-box-select"
      className="absolute inset-0 z-10 cursor-crosshair touch-none"
      onPointerDown={(event) => {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // A pointer the browser no longer tracks: the drag still works within the page.
        }
        start.current = at(event);
        setBox({ ...start.current, w: 0, h: 0 });
      }}
      onPointerMove={(event) => {
        if (!start.current) return;
        const now = at(event);
        setBox({
          x: Math.min(start.current.x, now.x),
          y: Math.min(start.current.y, now.y),
          w: Math.abs(now.x - start.current.x),
          h: Math.abs(now.y - start.current.y),
        });
      }}
      onPointerUp={() => {
        const area = boxNow.current;
        start.current = null;
        setBox(null);
        if (area && area.w >= MIN_BOX && area.h >= MIN_BOX) cut(area);
      }}
    >
      {box ? (
        <div
          className="pointer-events-none absolute border-2 border-accent bg-accent/10"
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        />
      ) : null}
    </div>
  );
}
