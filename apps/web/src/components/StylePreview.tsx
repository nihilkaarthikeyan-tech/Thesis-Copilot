'use client';

/**
 * How a citation style looks, before it is chosen (2026-10-04, from the Jenni study).
 *
 * One in-text citation and one bibliography entry, rendered on the server by the same citation
 * engine the thesis uses (`GET /citation-styles/:id/preview`), from a fixed example reference.
 * The reference is invented and is labelled so here: a preview must never read as a real paper.
 * Shown under the editor's style search and the start-of-thesis style choice.
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export type StylePreviewData = {
  styleId: string;
  label: string;
  family: 'numeric' | 'author-date' | 'note';
  noteStyle: boolean;
  inText: string;
  bibliography: string;
  sampleLabel: string;
  /** The CSL locale it was rendered in (ADR-0065). */
  locale?: string;
};

/** One request per style and locale per page load, however often the student moves between them. */
const cache = new Map<string, Promise<StylePreviewData>>();

/**
 * `locale` (ADR-0065) is the citation locale the thesis renders in, so the preview shows the
 * student's own "and" or "&"; absent, the style's own locale.
 */
export function loadStylePreview(
  styleId: string,
  locale?: string | null,
): Promise<StylePreviewData> {
  const key = `${styleId}|${locale ?? ''}`;
  const known = cache.get(key);
  if (known) return known;
  const query = locale ? `?locale=${encodeURIComponent(locale)}` : '';
  const pending = api<StylePreviewData>(
    `/citation-styles/${encodeURIComponent(styleId)}/preview${query}`,
  ).catch((error: unknown) => {
    // A failure is not kept, so moving back to the style tries again.
    cache.delete(key);
    throw error;
  });
  cache.set(key, pending);
  return pending;
}

export function StylePreview({
  styleId,
  locale,
}: {
  styleId: string | null;
  locale?: string | null;
}) {
  const [state, setState] = useState<{
    key: string;
    data: StylePreviewData | null;
    failed: boolean;
  } | null>(null);

  const key = `${styleId ?? ''}|${locale ?? ''}`;

  useEffect(() => {
    if (!styleId) return;
    const wanted = `${styleId}|${locale ?? ''}`;
    let live = true;
    // A short pause so moving the pointer down a list asks for the style it stops on, not every
    // style it crosses.
    const timer = window.setTimeout(() => {
      loadStylePreview(styleId, locale)
        .then((data) => {
          if (live) setState({ key: wanted, data, failed: false });
        })
        .catch(() => {
          if (live) setState({ key: wanted, data: null, failed: true });
        });
    }, 120);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [styleId, locale]);

  if (!styleId) return null;
  const current = state?.key === key ? state : null;

  return (
    <div
      data-testid="style-preview"
      aria-live="polite"
      className="mt-2 rounded-md border border-line bg-sunk px-3 py-2 text-[12.5px]"
    >
      {current?.data ? (
        <>
          <p className="text-[11px] text-muted">
            {current.data.label} · {current.data.sampleLabel}
          </p>
          <p className="mt-1 text-ink">
            <span className="text-muted">
              {current.data.noteStyle ? 'Footnote: ' : 'In the text: '}
            </span>
            <span data-testid="style-preview-intext">{current.data.inText}</span>
          </p>
          <p className="mt-1 text-ink">
            <span className="text-muted">In the bibliography: </span>
            <span data-testid="style-preview-bibliography">{current.data.bibliography}</span>
          </p>
        </>
      ) : current?.failed ? (
        <p className="text-muted">The preview for this style could not be loaded.</p>
      ) : (
        <p className="text-muted">Loading a preview…</p>
      )}
    </div>
  );
}
