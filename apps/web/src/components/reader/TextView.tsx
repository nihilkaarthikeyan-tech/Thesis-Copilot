'use client';

/**
 * The paper as text (ADR-0068): every passage we hold, in order, set like the thesis itself
 * (Spectral, the 72ch measure). This is all an abstract-only paper has, and the fallback when a
 * PDF cannot be drawn. Page markers come from the passages' own page numbers; section headings
 * from the section each passage was read under.
 *
 * Each passage carries `data-chunk-id` and `data-page`, so a selection knows which passage — and
 * which page — it came from when it is cited.
 */

import { type MutableRefObject, useCallback, useEffect, useRef } from 'react';
import { clearMatches, matchRanges, paintMatches, scrollRangeIntoView } from './highlight';
import type { ReaderView } from './PdfView';

export type Passage = { id: string; page: number | null; section: string | null; text: string };

export function TextView({
  passages,
  controller,
  initialPage,
  initialChunk,
}: {
  passages: readonly Passage[];
  controller?: MutableRefObject<ReaderView | null>;
  initialPage?: number | null;
  /** A passage to open at and mark — one a chat answer or a citation pointed to. */
  initialChunk?: string | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  const count = useCallback(async (query: string) => {
    const root = body.current;
    return root ? matchRanges(root, query).length : 0;
  }, []);

  const show = useCallback(async (query: string, index: number) => {
    const root = body.current;
    const frame = scroller.current;
    if (!root || !frame) return;
    const ranges = matchRanges(root, query);
    const range = ranges[index] ?? null;
    paintMatches(ranges, range);
    if (range) scrollRangeIntoView(frame, range);
  }, []);

  useEffect(() => {
    if (!controller) return;
    controller.current = { count, show, clear: clearMatches };
    return () => {
      controller.current = null;
    };
  }, [controller, count, show]);

  // Open at the passage, or the first passage on the page, asked for.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || (!initialPage && !initialChunk) || passages.length === 0) return;
    opened.current = true;
    const target = initialChunk
      ? body.current?.querySelector(`[data-chunk-id="${CSS.escape(initialChunk)}"]`)
      : body.current?.querySelector(`[data-page="${initialPage}"]`);
    if (!(target instanceof HTMLElement) || !scroller.current) return;
    scroller.current.scrollTo({ top: target.offsetTop - 24 });
    if (initialChunk) target.setAttribute('data-pointed', '');
  }, [initialPage, initialChunk, passages.length]);

  let lastPage: number | null = null;
  let lastSection: string | null = null;

  return (
    <div
      ref={scroller}
      data-testid="text-view"
      className="relative min-h-0 flex-1 overflow-auto bg-paper"
    >
      <div
        ref={body}
        className="mx-auto max-w-[72ch] px-4 py-6 font-serif text-[17px] leading-[1.7] text-ink sm:px-6"
      >
        {passages.map((passage) => {
          const newPage = passage.page !== null && passage.page !== lastPage;
          const newSection = passage.section && passage.section !== lastSection;
          lastPage = passage.page ?? lastPage;
          lastSection = passage.section ?? lastSection;
          return (
            <section key={passage.id}>
              {newPage ? (
                <p
                  data-search-skip=""
                  className="mt-6 mb-2 select-none border-t border-line pt-1 font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-faint"
                >
                  Page {passage.page}
                </p>
              ) : null}
              {newSection ? (
                <h2 data-gap="" className="mt-6 mb-2 font-sans text-[15px] font-bold text-ink">
                  {passage.section}
                </h2>
              ) : null}
              <p
                data-gap=""
                data-passage=""
                data-chunk-id={passage.id}
                data-page={passage.page ?? undefined}
                className="mb-4 whitespace-pre-line data-[pointed]:-mx-3 data-[pointed]:rounded-md data-[pointed]:bg-accent-soft data-[pointed]:px-3"
              >
                {passage.text}
              </p>
            </section>
          );
        })}
      </div>
    </div>
  );
}
