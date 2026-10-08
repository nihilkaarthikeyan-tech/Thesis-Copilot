'use client';

/**
 * The export dialog's live preview (R27, ADR-0121): the first pages of the file, drawn in HTML from
 * the very numbers the file is built with (`resolveLayout` in `@tc/types`) — paper, margins, font,
 * size, line spacing, columns, title page, contents and page numbers. An approximation of Word's
 * typesetting, not a rendering of the PDF: it shows what a choice changes, at once and offline.
 */

import type { ResolvedLayout, TemplateSpec, ThesisDetails } from '@tc/types';
import { useEffect, useRef, useState } from 'react';
import { previewBlocks } from '@/lib/export-preview';
import { cn } from '@/lib/utils';

const PAPER_MM = { A4: [210, 297], Letter: [215.9, 279.4] } as const;
/** A point in millimetres. */
const PT_MM = 25.4 / 72;

const FONT_STACK: Record<string, string> = {
  'times new roman': '"Times New Roman", Times, "Liberation Serif", serif',
  arial: 'Arial, Helvetica, "Liberation Sans", sans-serif',
  calibri: 'Calibri, Carlito, "Segoe UI", sans-serif',
};
const fontStack = (font: string) => FONT_STACK[font.toLowerCase()] ?? `"${font}", serif`;

type Page = 'title' | 'contents' | 'body';

export function LayoutPreview({
  layout,
  spec,
  details,
  documentTitle,
  chapterTitle,
  chapterNumber,
  content,
  scope,
}: {
  layout: ResolvedLayout;
  /** The template, for the chapter label and heading sizes. */
  spec: TemplateSpec;
  details: ThesisDetails | null;
  documentTitle: string;
  chapterTitle: string;
  chapterNumber: number;
  content: unknown;
  scope: 'chapter' | 'thesis';
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(260);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(160, Math.min(320, Math.floor(entry.contentRect.width))));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const pages: Page[] = [
    ...(scope === 'thesis' && layout.titlePage ? (['title'] as const) : []),
    ...(scope === 'thesis' && layout.contents ? (['contents'] as const) : []),
    'body',
  ];
  const current = pages[Math.min(index, pages.length - 1)] ?? 'body';
  useEffect(() => {
    if (index >= pages.length) setIndex(pages.length - 1);
  }, [index, pages.length]);

  const [paperW, paperH] = PAPER_MM[layout.paper];
  const scale = width / paperW; // px per mm
  const px = (mm: number) => mm * scale;
  const fontPx = layout.sizePt * PT_MM * scale;
  const lineHeight = 1.15 * layout.lineSpacing;
  const sample = previewBlocks(content);
  const title = sample.title || chapterTitle;
  const label = spec.headings.chapter.label.replace(/\{n\}/g, String(chapterNumber));
  const caps = (text: string) => (spec.headings.chapter.caps ? text.toUpperCase() : text);
  const headingPx = (sizePt: number) => sizePt * PT_MM * scale;
  const numbered = layout.pageNumbers;

  return (
    <div className="min-w-0" data-testid="layout-preview">
      <div ref={boxRef} className="w-full min-w-0">
        <div
          data-testid={`preview-page-${current}`}
          data-paper={layout.paper}
          data-columns={layout.columns}
          className="relative mx-auto overflow-hidden rounded-sm border border-line-strong bg-white text-[#111] shadow-sm"
          style={{
            width,
            height: width * (paperH / paperW),
            paddingTop: px(layout.marginsMm.top),
            paddingBottom: px(layout.marginsMm.bottom),
            paddingLeft: px(layout.marginsMm.left),
            paddingRight: px(layout.marginsMm.right),
            fontFamily: fontStack(layout.font),
            fontSize: fontPx,
            lineHeight,
            overflowWrap: 'anywhere',
          }}
        >
          {/* The text block's edge, faintly, so the margins can be seen. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute border border-dashed border-[#cbd3de]"
            style={{
              top: px(layout.marginsMm.top),
              bottom: px(layout.marginsMm.bottom),
              left: px(layout.marginsMm.left),
              right: px(layout.marginsMm.right),
            }}
          />
          {current === 'title' ? (
            <div className="flex h-full flex-col items-center text-center">
              <p
                className="font-bold"
                style={{ fontSize: headingPx(spec.headings.chapter.sizePt) }}
              >
                {documentTitle.toUpperCase()}
              </p>
              <p className="mt-[1.5em]">
                A thesis submitted in partial fulfilment of the requirements for the degree of
              </p>
              <p className="font-bold">{details?.degree || 'Your degree'}</p>
              <p className="mt-[1em]">by</p>
              <p className="font-bold">{details?.studentName || 'Your name'}</p>
              <p className="mt-[1em]">under the guidance of</p>
              <p className="font-bold">{details?.guideName || 'Your guide'}</p>
              <p className="mt-auto">{(details?.institution || 'Your university').toUpperCase()}</p>
              <p>{details?.monthYear || 'Month year'}</p>
            </div>
          ) : current === 'contents' ? (
            <div>
              <p
                className="text-center font-bold"
                style={{ fontSize: headingPx(spec.headings.chapter.sizePt) }}
              >
                TABLE OF CONTENTS
              </p>
              <ol className="mt-[1em] list-none p-0">
                <li className="flex gap-[0.4em]">
                  <span className="min-w-0 truncate font-bold">
                    {label} {caps(title)}
                  </span>
                  <span className="flex-1 border-b border-dotted border-[#999]" />
                  <span>1</span>
                </li>
                {sample.blocks
                  .filter((b) => b.kind !== 'p' && b.kind !== 'rule')
                  .map((b, i) => (
                    <li
                      // biome-ignore lint/suspicious/noArrayIndexKey: headings in order.
                      key={i}
                      className="flex gap-[0.4em]"
                      style={{ paddingLeft: b.kind === 'h3' ? '2em' : '1em' }}
                    >
                      <span className="min-w-0 truncate">{b.text}</span>
                      <span className="flex-1 border-b border-dotted border-[#999]" />
                      <span>1</span>
                    </li>
                  ))}
              </ol>
            </div>
          ) : (
            <div
              style={{
                columnCount: layout.columns,
                columnGap: px(8),
                textAlign: layout.justify ? 'justify' : 'left',
              }}
            >
              {scope === 'thesis' ? (
                <p
                  className="text-center font-bold"
                  style={{ fontSize: headingPx(spec.headings.chapter.sizePt) }}
                >
                  {label}
                </p>
              ) : null}
              <p
                className="text-center font-bold"
                style={{
                  fontSize: headingPx(spec.headings.chapter.sizePt),
                  marginBottom: '0.6em',
                  lineHeight: 1.2,
                }}
              >
                {scope === 'thesis' ? caps(title) : title}
              </p>
              {sample.blocks.length === 0 ? (
                <p className="text-[#777]">Your chapter’s text appears here.</p>
              ) : (
                sample.blocks.map((block, i) =>
                  block.kind === 'rule' ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: blocks in order.
                    <hr key={i} className="my-[0.5em] border-[#999]" />
                  ) : (
                    <p
                      // biome-ignore lint/suspicious/noArrayIndexKey: blocks in order.
                      key={i}
                      className={cn(block.kind !== 'p' && 'font-bold')}
                      style={{
                        fontSize:
                          block.kind === 'h2'
                            ? headingPx(spec.headings.h2.sizePt)
                            : block.kind === 'h3'
                              ? headingPx(spec.headings.h3.sizePt)
                              : undefined,
                        marginTop: block.kind === 'p' ? 0 : '0.6em',
                        marginBottom: `${layout.paragraphSpacingPt * PT_MM * scale}px`,
                        breakInside: 'avoid-column',
                      }}
                    >
                      {block.text}
                    </p>
                  ),
                )
              )}
            </div>
          )}
          {numbered ? (
            <p
              className="absolute inset-x-0 text-center"
              style={{ bottom: px(layout.marginsMm.bottom) / 2, fontSize: fontPx * 0.9 }}
            >
              {current === 'body' ? '1' : current === 'title' ? 'i' : 'ii'}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-center gap-2 text-[12px] text-muted">
        <button
          type="button"
          aria-label="Previous page"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          className="rounded-md px-2 py-0.5 hover:bg-sunk disabled:opacity-40"
        >
          ‹
        </button>
        <span data-testid="preview-pager">
          Page {Math.min(index, pages.length - 1) + 1} of {pages.length}
        </span>
        <button
          type="button"
          aria-label="Next page"
          disabled={index >= pages.length - 1}
          onClick={() => setIndex((i) => Math.min(pages.length - 1, i + 1))}
          className="rounded-md px-2 py-0.5 hover:bg-sunk disabled:opacity-40"
        >
          ›
        </button>
      </div>
      <p className="mt-1 text-center text-[11px] text-faint">
        An approximate preview. Word lays out the real pages.
      </p>
    </div>
  );
}
