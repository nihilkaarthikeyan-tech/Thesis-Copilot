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
};

/** One request per style per page load, however often the student moves between styles. */
const cache = new Map<string, Promise<StylePreviewData>>();

export function loadStylePreview(styleId: string): Promise<StylePreviewData> {
  const known = cache.get(styleId);
  if (known) return known;
  const pending = api<StylePreviewData>(
    `/citation-styles/${encodeURIComponent(styleId)}/preview`,
  ).catch((error: unknown) => {
    // A failure is not kept, so moving back to the style tries again.
    cache.delete(styleId);
    throw error;
  });
  cache.set(styleId, pending);
  return pending;
}

export function StylePreview({ styleId }: { styleId: string | null }) {
  const [state, setState] = useState<{
    styleId: string;
    data: StylePreviewData | null;
    failed: boolean;
  } | null>(null);

  useEffect(() => {
    if (!styleId) return;
    let live = true;
    // A short pause so moving the pointer down a list asks for the style it stops on, not every
    // style it crosses.
    const timer = window.setTimeout(() => {
      loadStylePreview(styleId)
        .then((data) => {
          if (live) setState({ styleId, data, failed: false });
        })
        .catch(() => {
          if (live) setState({ styleId, data: null, failed: true });
        });
    }, 120);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [styleId]);

  if (!styleId) return null;
  const current = state?.styleId === styleId ? state : null;

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
