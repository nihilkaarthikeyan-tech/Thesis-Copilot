'use client';

/**
 * "Sources in this thesis" (Jenni build plan R19, ADR-0106): every paper the chapters cite, how
 * often and in which chapters, with what we hold of it (full text, abstract, open access), Read,
 * and — for papers that were found for the student rather than added by them — **Keep in my
 * library**, or **Keep all** at once. Opened from the Citations tab. Free.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { mentionLabel } from '@/lib/mentions';
import { readerHref } from '@/lib/reader';

type Cited = {
  id: string;
  title: string | null;
  authors: unknown;
  year: number | null;
  venue: string | null;
  groundingLevel: string;
  openAccess?: boolean | null;
  citations: number;
  chapters: string[];
  found: boolean;
};

export function CitedSources({ documentId }: { documentId: string }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Cited[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<Cited[]>(`/documents/${documentId}/cited-sources`)
        .then(setList)
        .catch(() => setList([])),
    [documentId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function keep(sourceIds?: string[]) {
    setBusy(true);
    try {
      const { kept } = await api<{ kept: number }>(`/documents/${documentId}/cited-sources/keep`, {
        method: 'POST',
        body: JSON.stringify(sourceIds ? { sourceIds } : {}),
      });
      setNotice(
        kept === 0
          ? 'Nothing to keep: every cited paper is already yours.'
          : `${kept} ${kept === 1 ? 'paper is' : 'papers are'} now in your own library.`,
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  const found = (list ?? []).filter((s) => s.found).length;

  return (
    <>
      <button
        type="button"
        className="mb-2 text-[12.5px] font-semibold text-accent underline"
        onClick={() => {
          setNotice(null);
          void load();
          setOpen(true);
        }}
        data-testid="cited-sources-open"
      >
        Sources in this thesis{list ? ` (${list.length})` : ''}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Sources in this thesis"
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-16"
          data-testid="cited-sources"
        >
          <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-md border border-line bg-surface p-4 text-sm shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[16px] font-semibold text-ink">Sources in this thesis</h2>
                <p className="mt-0.5 text-[12.5px] text-muted">
                  Every paper your chapters cite, most cited first.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                className="text-muted hover:text-ink"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            {found > 0 ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-sunk px-3 py-2 text-[12.5px]">
                <span>
                  {found} of these {found === 1 ? 'was' : 'were'} found for you. Keep{' '}
                  {found === 1 ? 'it' : 'them'} as your own, and "Cite from my library" counts{' '}
                  {found === 1 ? 'it' : 'them'} too.
                </span>
                <button
                  type="button"
                  className="font-semibold text-accent underline disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void keep()}
                  data-testid="cited-sources-keep-all"
                >
                  Keep all in my library
                </button>
              </div>
            ) : null}
            {notice ? (
              <p className="mt-2 text-[12.5px] text-muted" role="status">
                {notice}
              </p>
            ) : null}
            {list === null ? (
              <p className="mt-3 text-muted">Reading…</p>
            ) : list.length === 0 ? (
              <p className="mt-3 text-muted">No chapter cites a paper yet.</p>
            ) : (
              <ul className="mt-3 grid list-none gap-2 p-0">
                {list.map((s) => (
                  <li
                    key={s.id}
                    className="rounded-md border border-line px-3 py-2"
                    data-testid="cited-source"
                  >
                    <p className="font-medium text-ink">{s.title ?? 'Untitled source'}</p>
                    <p className="text-[12.5px] text-muted">
                      {[
                        mentionLabel(s),
                        s.venue,
                        s.groundingLevel === 'FULL_TEXT'
                          ? 'Full text'
                          : s.groundingLevel === 'ABSTRACT'
                            ? 'Abstract only'
                            : 'Nothing read',
                        s.openAccess ? 'Open access' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-muted">
                      Cited {s.citations} {s.citations === 1 ? 'time' : 'times'} —{' '}
                      {s.chapters.join(', ')}
                    </p>
                    <span className="mt-1 flex flex-wrap gap-3 text-[12.5px]">
                      <Link href={readerHref(documentId, s.id)} className="underline">
                        Read
                      </Link>
                      {s.found ? (
                        <button
                          type="button"
                          className="font-semibold text-accent underline disabled:opacity-50"
                          disabled={busy}
                          onClick={() => void keep([s.id])}
                        >
                          Keep in my library
                        </button>
                      ) : (
                        <span className="text-faint">In your library</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
