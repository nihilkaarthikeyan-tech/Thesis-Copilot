'use client';

/**
 * "Possible duplicates" on the Library tab (2026-10-04, from the Jenni study's "Library Issues").
 *
 * The server finds the pairs (`GET /documents/:id/sources/duplicates`) and suggests which record
 * to keep: the one the AI can read more of, then the one the thesis uses more. "Merge" keeps that
 * one and moves the other's citations, chapter pins and PDF onto it before removing it, so nothing
 * the student wrote loses its reference. The student can keep the other record instead.
 *
 * Nothing is merged on its own: two records that look alike can be two papers, and the student is
 * the one who knows.
 */

import type { CslAuthor } from '@tc/retrieval';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';
import { type MergeResult, mergeSummary, plural } from '@/lib/library-issues';

export type DuplicateSide = {
  id: string;
  title: string | null;
  authors: CslAuthor[] | null;
  year: number | null;
  venue: string | null;
  doi: string | null;
  groundingLevel: string;
  hasFile: boolean;
  citeCount: number;
  pinCount: number;
};

export type DuplicatePair = {
  reason: 'SAME_DOI' | 'SAME_TITLE';
  keep: DuplicateSide;
  drop: DuplicateSide;
};

function usage(side: DuplicateSide): string {
  const parts = [
    side.citeCount > 0 ? `cited ${plural(side.citeCount, 'time', 'times')}` : 'not cited',
    side.pinCount > 0 ? `pinned to ${plural(side.pinCount, 'chapter', 'chapters')}` : null,
  ];
  return parts.filter(Boolean).join(', ');
}

function Side({ side, label }: { side: DuplicateSide; label: string }) {
  const authors = (side.authors ?? [])
    .map((a) => a.family ?? a.literal ?? '')
    .filter(Boolean)
    .slice(0, 3)
    .join(', ');
  const meta = [authors, side.year ? String(side.year) : null, side.venue]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[11px] font-bold uppercase tracking-[0.05em] text-muted">{label}</p>
      <p className="font-medium">{side.title ?? 'Untitled source'}</p>
      {meta ? <p className="text-xs text-muted">{meta}</p> : null}
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
        <Badge tone={side.groundingLevel === 'FULL_TEXT' ? 'ok' : 'neutral'}>
          {side.groundingLevel === 'FULL_TEXT' ? 'Full text' : 'Abstract only'}
        </Badge>
        {side.hasFile ? <span>has a PDF</span> : null}
        <span>{usage(side)}</span>
        {side.doi ? <span className="truncate">{side.doi}</span> : null}
      </div>
    </div>
  );
}

function PairRow({ pair, onMerged }: { pair: DuplicatePair; onMerged: (message: string) => void }) {
  const [swapped, setSwapped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keep = swapped ? pair.drop : pair.keep;
  const drop = swapped ? pair.keep : pair.drop;

  async function merge() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<MergeResult>(`/sources/${keep.id}/merge`, {
        method: 'POST',
        body: JSON.stringify({ duplicateId: drop.id }),
      });
      onMerged(mergeSummary(result));
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'That merge did not work.',
      );
      setBusy(false);
    }
  }

  return (
    <li className="px-4 py-3" data-testid="duplicate-pair">
      <p className="mb-2 text-xs text-muted">
        {pair.reason === 'SAME_DOI'
          ? 'Same DOI — these are one paper listed twice.'
          : 'Same title, year and first author, and no DOI to tell them apart. Check they are one paper before merging.'}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Side side={keep} label="Keep" />
        <Side side={drop} label="Remove" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => void merge()}
          disabled={busy}
          data-testid="merge-duplicate"
        >
          {busy ? 'Merging…' : 'Merge'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSwapped((v) => !v)} disabled={busy}>
          Keep the other one instead
        </Button>
        {drop.citeCount + drop.pinCount > 0 ? (
          <span className="text-xs text-muted">
            Its citations and pins move to the kept copy; nothing in your chapters loses its
            reference.
          </span>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-warn">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function DuplicatesPanel({
  pairs,
  onMerged,
}: {
  pairs: DuplicatePair[];
  onMerged: (message: string) => void;
}) {
  if (pairs.length === 0) return null;
  return (
    <Card className="mt-6" data-testid="possible-duplicates">
      <CardHeader
        title={`Possible duplicates (${pairs.length})`}
        hint="The same work in your library twice. Your bibliography would list it twice too."
      />
      <ul className="divide-y divide-line">
        {pairs.map((pair) => (
          <PairRow key={`${pair.keep.id}-${pair.drop.id}`} pair={pair} onMerged={onMerged} />
        ))}
      </ul>
    </Card>
  );
}
