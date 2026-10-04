'use client';

/**
 * The scaffold panel — PRD FR-4.2, PHASES v2 W8.4.
 *
 *   "On opening a chapter, its scope note and subheadings render as a collapsible scaffold panel
 *    (not inserted as text)."
 *
 * Shown, never inserted: the student writes the chapter, the scaffold says what it is for. The
 * subheadings are the outline node's children, so editing the outline changes this panel and the
 * prompt together (FR-3.4).
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { dismissHint, isHintDismissed } from '../onboarding/FirstRunHint';

type Node = {
  id: string;
  title: string;
  scopeNote: string;
  subTheme?: string;
  mappedFromPaperSection?: string;
  children: Node[];
};

function findNode(nodes: Node[], id: string): Node | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

export function ScaffoldPanel({
  documentId,
  outlineNodeId,
}: {
  documentId: string;
  outlineNodeId: string;
}) {
  const [node, setNode] = useState<Node | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    // Folded on a phone (2026-10-04): open, it and the first-run hint filled most of a 375 px
    // screen before the student's own text began. One tap opens it.
    const wide = typeof window === 'undefined' || window.matchMedia('(min-width: 640px)').matches;
    setOpen(wide && !isHintDismissed(`scaffold-${outlineNodeId}`));
    api<{ outline: Node[] }>(`/documents/${documentId}/outline`)
      .then((view) => setNode(findNode(view.outline, outlineNodeId)))
      .catch(() => undefined);
  }, [documentId, outlineNodeId]);

  if (!node) return null;

  return (
    <section
      data-testid="scaffold"
      className="mx-auto mb-4 max-w-[72ch] rounded-md border border-line bg-paper px-4 py-3 text-sm"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xs uppercase tracking-wide text-muted">What this chapter is for</h2>
        <button
          type="button"
          className="text-xs text-muted underline"
          aria-expanded={open}
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (!next) dismissHint(`scaffold-${outlineNodeId}`);
          }}
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open ? (
        <>
          <p className="mt-2">{node.scopeNote}</p>
          {node.mappedFromPaperSection ? (
            <p className="mt-1 text-xs text-muted">
              Mapped from your paper’s “{node.mappedFromPaperSection}”.
            </p>
          ) : null}
          {node.children.length > 0 ? (
            <>
              <h3 className="mt-3 text-xs uppercase tracking-wide text-muted">Sections</h3>
              <ul className="mt-1 space-y-1" data-testid="scaffold-sections">
                {node.children.map((child) => (
                  <li key={child.id}>
                    <span className="font-medium">{child.title}</span>
                    {child.scopeNote ? (
                      <span className="text-muted"> — {child.scopeNote}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="mt-3 text-xs text-muted">
            Nothing here is inserted into your chapter.{' '}
            <Link href={`/app/d/${documentId}/outline`} className="underline">
              Edit the outline
            </Link>{' '}
            to change it.
          </p>
        </>
      ) : null}
    </section>
  );
}
