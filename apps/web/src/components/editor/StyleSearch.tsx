'use client';

/**
 * Finding a citation style among ten thousand.
 *
 * The dropdown above it holds the twenty the product ships — most students want one of those, and
 * a dropdown is the fastest way to pick from twenty. Everything else is a search: a supervisor
 * says "use the Journal of Cleaner Production style", and the student types "cleaner".
 *
 * A journal's style usually borrows another style's rules (that journal is Elsevier Harvard under
 * its own name). The result says so, because it is the rules — not the name — that decide how the
 * bibliography will look.
 *
 * Footnote styles can be chosen since the editor has footnotes (ADR-0029): each citation then
 * becomes a numbered note, in the editor and in every export.
 *
 * Under the search, a preview of the style the pointer or keyboard is on — or, with nothing
 * highlighted, the style in use — rendered from an example reference (2026-10-04).
 */

import { useEffect, useRef, useState } from 'react';
import { StylePreview } from '@/components/StylePreview';
import { ApiError, api } from '@/lib/api';

type StyleOption = {
  id: string;
  title: string;
  family: string;
  parent?: string;
  selectable: boolean;
  common: boolean;
};

type SearchResult = {
  results: StyleOption[];
  available: number;
  credit: { text: string; licence: string; commit: string };
};

/** Characters typed before a search runs — "ap" finds hundreds; "apa" finds what was meant. */
const MIN_QUERY = 2;

export function StyleSearch({
  current,
  locale,
  busy,
  onChoose,
}: {
  current: string;
  /** The citation locale the thesis renders in; the preview uses it too (ADR-0065). */
  locale?: string | null;
  busy: boolean;
  onChoose: (styleId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  /**
   * The query `result` answers. Without it the unfiltered first load showed as "results" for the
   * first 200 ms of typing, and a pointer resting there previewed a style the student never
   * searched for (2026-10-04).
   */
  const [resultQuery, setResultQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The result the pointer or keyboard is on: what the preview shows instead of `current`. */
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const latest = useRef(0);

  // The count for the placeholder, before anyone types.
  useEffect(() => {
    api<SearchResult>('/citation-styles')
      .then(setResult)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) return;
    const ticket = ++latest.current;
    setLoading(true);
    // A short pause so typing "journal of" is one search, not ten.
    const timer = window.setTimeout(() => {
      api<SearchResult>(`/citation-styles?q=${encodeURIComponent(q)}&limit=30`)
        .then((found) => {
          // Only the newest query's answer is shown; an older one arriving late is discarded.
          if (ticket === latest.current) {
            setResult(found);
            setResultQuery(q);
          }
        })
        .catch((e: unknown) => {
          if (ticket === latest.current)
            setError(e instanceof ApiError ? e.problem.title : 'Search failed.');
        })
        .finally(() => {
          if (ticket === latest.current) setLoading(false);
        });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  const searching = query.trim().length >= MIN_QUERY;
  const results = searching && resultQuery === query.trim() ? (result?.results ?? []) : [];

  return (
    <div className="mt-2" data-testid="style-search">
      <label className="sr-only" htmlFor="style-search-input">
        Search all citation styles
      </label>
      <input
        id="style-search-input"
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setError(null);
          setHighlighted(null);
        }}
        placeholder={
          result ? `Search all ${result.available.toLocaleString()} styles…` : 'Search all styles…'
        }
        className="w-full rounded-md border border-line bg-paper px-2 py-1 text-sm"
      />
      {searching ? (
        <div className="mt-1 max-h-72 overflow-y-auto rounded-md border border-line bg-surface">
          {loading && results.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted">
              No style matches “{query.trim()}”. Try the journal’s name, or its publisher.
            </p>
          ) : (
            <ul className="grid list-none p-0">
              {results.map((style) => (
                <li key={style.id} className="border-b border-line last:border-b-0">
                  <button
                    type="button"
                    data-testid="style-result"
                    disabled={!style.selectable || busy || style.id === current}
                    onMouseEnter={() => {
                      if (style.selectable) setHighlighted(style.id);
                    }}
                    onFocus={() => {
                      if (style.selectable) setHighlighted(style.id);
                    }}
                    onClick={() => {
                      onChoose(style.id);
                      setQuery('');
                      setHighlighted(null);
                    }}
                    className="w-full px-2 py-1.5 text-left hover:bg-sunk disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <span className="block text-[13px] text-ink">
                      {style.title}
                      {style.id === current ? (
                        <span className="ml-1 text-xs text-accent">· in use</span>
                      ) : null}
                    </span>
                    <span className="block text-[11px] text-muted">
                      {!style.selectable
                        ? 'Not available.'
                        : style.family === 'note'
                          ? 'Footnotes — each citation becomes a numbered note'
                          : style.parent
                            ? `${style.family === 'numeric' ? 'Numbered' : 'Author–date'} · uses the rules of ${style.parent}`
                            : style.family === 'numeric'
                              ? 'Numbered'
                              : 'Author–date'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-warn">
          {error}
        </p>
      ) : null}
      <StylePreview styleId={(searching && highlighted) || current} locale={locale} />
      {result ? (
        <p className="mt-1 text-[10.5px] text-faint">{result.credit.text} (CC BY-SA 3.0).</p>
      ) : null}
    </div>
  );
}
