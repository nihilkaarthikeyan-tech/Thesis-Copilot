'use client';

/**
 * How the thesis is going.
 *
 * The editor's meter counts the student's AI allowance; this counts their work, which is the
 * question a supervisor opens with and the one a chapter list cannot answer.
 *
 * The chapter table earns its place by putting four numbers next to each other that otherwise live
 * on four screens — words, sources pinned, sources actually cited, and days since the chapter was
 * touched. The gap between pinned and cited is the interesting one: reading done, not yet used.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Card, CardHeader } from './ui/primitives';

type WordCounts = {
  HUMAN: number;
  ASSIST: number;
  DRAFT: number;
  COMMAND: number;
  HUMAN_EDITED: number;
};

type ChapterProgress = {
  id: string;
  title: string;
  order: number;
  words: number;
  byProvenance: WordCounts | null;
  pinned: number;
  cited: number;
  unused: number;
  updatedAt: string;
  daysSinceEdit: number;
};

type DocumentProgress = {
  words: number;
  chapters: ChapterProgress[];
  byProvenance: WordCounts;
  humanPercent: number | null;
  sources: number;
  neverCited: number;
  lastWorked: { id: string; title: string; daysAgo: number } | null;
};

const nf = new Intl.NumberFormat();

/** "today" reads better than "0 days ago", and is what a person would say. */
function ago(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function Progress({ documentId, className }: { documentId: string; className?: string }) {
  const [data, setData] = useState<DocumentProgress | null>(null);

  useEffect(() => {
    let live = true;
    api<DocumentProgress>(`/documents/${documentId}/progress`)
      .then((p) => {
        if (live) setData(p);
      })
      .catch(() => {
        // Same as the next-action card: a panel that cannot load simply does not appear.
      });
    return () => {
      live = false;
    };
  }, [documentId]);

  if (!data || data.chapters.length === 0) return null;

  const longest = Math.max(...data.chapters.map((c) => c.words), 1);

  return (
    <Card className={className}>
      <CardHeader
        title="Progress"
        hint={
          data.lastWorked
            ? `Last worked on ${data.lastWorked.title}, ${ago(data.lastWorked.daysAgo)}.`
            : 'Nothing written yet.'
        }
      />

      <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
        <Stat label="Words" value={nf.format(data.words)} />
        <Stat label="Chapters" value={String(data.chapters.length)} />
        <Stat
          label="Written by you"
          value={data.humanPercent === null ? '—' : `${data.humanPercent}%`}
          hint={data.humanPercent === null ? 'not recorded yet' : 'the rest came from AI you kept'}
        />
        <Stat
          label="Sources unused"
          value={`${data.neverCited}/${data.sources}`}
          hint="in the library, cited nowhere"
          tone={data.sources > 0 && data.neverCited === data.sources ? 'warn' : 'plain'}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left">
              <Th className="pl-4">Chapter</Th>
              <Th align="right">Words</Th>
              <Th align="right">Pinned</Th>
              <Th align="right">Cited</Th>
              <Th align="right" className="pr-4">
                Last edit
              </Th>
            </tr>
          </thead>
          <tbody>
            {data.chapters.map((c) => (
              <tr key={c.id} className="border-b border-line last:border-b-0">
                <td className="max-w-[22ch] truncate py-2 pl-4">
                  <Link
                    href={`/app/d/${documentId}/write/${c.id}`}
                    className="font-medium text-ink hover:text-accent"
                  >
                    {c.order}. {c.title}
                  </Link>
                </td>
                <td className="py-2 pl-3 text-right align-middle">
                  <div className="flex items-center justify-end gap-2">
                    {/* The bar is relative to the longest chapter, not to a target: there are no
                        word targets in the outline, so a percentage would be invented. */}
                    <span
                      aria-hidden="true"
                      className="hidden h-1 rounded-sm bg-accent/35 sm:block"
                      style={{ width: `${Math.round((c.words / longest) * 44)}px` }}
                    />
                    <span className="tnum">{nf.format(c.words)}</span>
                  </div>
                </td>
                <td className="tnum py-2 pl-3 text-right text-muted">{c.pinned || '–'}</td>
                <td
                  className={cn(
                    'tnum py-2 pl-3 text-right',
                    c.unused > 0 ? 'text-warn' : 'text-muted',
                  )}
                  title={c.unused > 0 ? `${c.unused} pinned but not cited here` : undefined}
                >
                  {c.cited || '–'}
                </td>
                <td className="py-2 pl-3 pr-4 text-right text-muted">
                  {c.words > 0 ? ago(c.daysSinceEdit) : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = 'plain',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'plain' | 'warn';
}) {
  return (
    <div className="bg-surface px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div
        className={cn(
          'tnum mt-1 font-serif text-[21px] font-semibold leading-none',
          tone === 'warn' ? 'text-warn' : 'text-ink',
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-[11px] leading-snug text-faint">{hint}</div> : null}
    </div>
  );
}

function Th({
  children,
  align = 'left',
  className,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        'py-2 pl-3 font-semibold',
        align === 'right' ? 'text-right' : 'text-left',
        'eyebrow',
        className,
      )}
    >
      {children}
    </th>
  );
}
