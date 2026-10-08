'use client';

/**
 * The student's theses, beside the open one (R32, ADR-0127) — Jenni keeps its documents in a
 * side panel next to the open document; ours were only on the `/app` list, a page away.
 *
 * At the top of the chapter rail: a "Theses" heading that folds open, with New ▾ beside it. Open,
 * it lists every thesis on the student's list (`GET /documents`, which leaves archived ones out,
 * ADR-0114), the open one marked, each a link into its writing — the chapter last open here for
 * it, else its first, as the list's Write goes. "All theses" goes to the list, where copy,
 * archive and delete stay. A filter appears once there are more than a handful.
 *
 * Folded by default, and remembered in this browser: a student with one thesis loses nothing of
 * the chapter list below it. The list is read when it is first unfolded, not on every chapter.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { NewMenu } from '@/components/NewMenu';
import { useT } from '@/i18n/react';
import { api } from '@/lib/api';
import { readLastChapter } from '@/lib/last-chapter';
import { thesisWriteHref } from '@/lib/thesis-href';

type Summary = {
  id: string;
  title: string;
  updatedAt: string;
  firstChapterId: string | null;
};

const OPEN_KEY = 'tc:rail-theses-open';
/** Above this many theses the filter box appears. */
const FILTER_FROM = 6;

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // Private windows: it simply starts folded next time.
  }
}

export function ThesisSwitcher({ documentId }: { documentId: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [theses, setTheses] = useState<Summary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => setOpen(readOpen()), []);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setTheses(await api<Summary[]>('/documents'));
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (open && theses === null && !failed) void load();
  }, [open, theses, failed, load]);

  const toggle = () => {
    setOpen((value) => {
      writeOpen(!value);
      return !value;
    });
  };

  const last = typeof window === 'undefined' ? null : readLastChapter();
  const needle = filter.trim().toLowerCase();
  const shown = theses?.filter((d) => !needle || d.title.toLowerCase().includes(needle)) ?? [];

  return (
    <section className="mb-4 border-b border-line pb-3" data-testid="thesis-switcher">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="thesis-switcher-list"
          onClick={toggle}
          data-testid="thesis-switcher-toggle"
          className="eyebrow flex min-w-0 items-center gap-1 hover:text-accent"
        >
          <span aria-hidden="true" className="inline-block w-2.5 text-center">
            {open ? '▾' : '▸'}
          </span>
          {theses && theses.length > 0
            ? t('switcher.headingCount', { count: theses.length })
            : t('switcher.heading')}
        </button>
        <NewMenu compact align="end" testId="rail-new-menu" />
      </div>

      {open ? (
        <div id="thesis-switcher-list" className="mt-2">
          {theses === null ? (
            failed ? (
              <p className="text-[12px] text-muted" role="alert">
                {t('switcher.error')}{' '}
                <button
                  type="button"
                  className="font-semibold underline"
                  onClick={() => void load()}
                >
                  {t('switcher.retry')}
                </button>
              </p>
            ) : (
              <p className="text-[12px] text-muted" role="status">
                {t('common.loading')}
              </p>
            )
          ) : (
            <>
              {theses.length >= FILTER_FROM ? (
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t('switcher.filter')}
                  aria-label={t('switcher.filter')}
                  data-testid="thesis-switcher-filter"
                  className="mb-1.5 h-7 w-full min-w-0 rounded-md border border-line bg-surface px-2 text-[12px]"
                />
              ) : null}
              {/* grid-cols-1 and min-w-0 rows, as the chapter list below: a long title truncates
                  inside the rail instead of widening it (the 2026-10-08 layout fault). */}
              <ul
                className="grid max-h-60 list-none grid-cols-1 gap-0.5 overflow-y-auto p-0"
                data-testid="thesis-switcher-list"
              >
                {shown.map((d) => {
                  const current = d.id === documentId;
                  return (
                    <li key={d.id} className="min-w-0">
                      <Link
                        href={thesisWriteHref(d, last)}
                        aria-current={current ? 'page' : undefined}
                        title={d.title}
                        data-testid="thesis-switcher-item"
                        className={`block min-w-0 rounded-md border-l-2 px-2 py-1 transition-colors ${
                          current
                            ? 'border-accent bg-surface text-ink'
                            : 'border-transparent text-muted hover:bg-surface hover:text-ink'
                        }`}
                      >
                        <span
                          className={`block truncate text-[12.5px] ${current ? 'font-semibold' : ''}`}
                        >
                          {d.title}
                        </span>
                        <span className="block truncate text-[11px] text-faint">
                          {current
                            ? t('switcher.open')
                            : t('list.updated', {
                                date: new Date(d.updatedAt).toLocaleDateString(undefined, {
                                  day: 'numeric',
                                  month: 'short',
                                }),
                              })}
                        </span>
                      </Link>
                    </li>
                  );
                })}
                {shown.length === 0 ? (
                  <li className="px-2 py-1 text-[12px] text-muted">{t('switcher.none')}</li>
                ) : null}
              </ul>
              <Link
                href="/app"
                className="mt-1.5 inline-block text-[11px] font-semibold text-muted hover:text-accent"
                data-testid="thesis-switcher-all"
              >
                {t('switcher.all')}
              </Link>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
