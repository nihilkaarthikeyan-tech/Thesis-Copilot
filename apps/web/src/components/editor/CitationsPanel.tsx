'use client';

/**
 * The Citations tab — PRD FR-5.2–5.5, §6.2 right panel, PHASES v2 W10.2–W10.4.
 *
 * Three things a student needs in one place: the style everything renders in, the bibliography as
 * it will be printed, and the mechanical problems (FR-5.4). The per-citation list with its
 * passages stays where it was, above these; this component adds the document-wide half.
 *
 * A style switch touches no chapter — it changes one column on the document and re-renders every
 * label from the returned map, which is what FR-5.2's "no body edits" means.
 */

import type { Editor } from '@tiptap/core';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { automaticLocaleLabel } from '@/lib/citation-locale';
import { ReadingDepth } from './ReadingDepth';
import { ReferenceHealth } from './ReferenceHealth';
import { StyleSearch } from './StyleSearch';

export type Rendered = {
  style: string;
  styleLabel: string;
  styleFamily: 'numeric' | 'author-date' | 'note';
  styles: Array<{ id: string; label: string; family: string; note?: string }>;
  labels: Record<string, string>;
  /** ADR-0029: citations are footnotes in this style. */
  noteStyle?: boolean;
  bibliography: Array<{ sourceId: string; text: string }>;
  /** Sources cited somewhere that are no longer in the library (ADR-0045). */
  missingSourceIds?: string[];
  findings: Array<{
    kind: 'ORPHAN' | 'UNUSED' | 'UNTAGGED';
    message: string;
    chapterId?: string;
    chapterTitle?: string;
    from?: number;
    to?: number;
    text?: string;
  }>;
  counts: { citations: number; sources: number; orphans: number; unused: number; untagged: number };
  /** ADR-0065: the student's locale choice (null: automatic). */
  citationLocale?: string | null;
  /** What the thesis asks citeproc for; null means the style's own locale. */
  localeOverride?: string | null;
  /** The locale the labels and bibliography were actually rendered in. */
  locale?: string;
  locales?: Array<{ id: string; label: string }>;
};

const KIND_LABEL: Record<string, string> = {
  ORPHAN: 'Citation without a source',
  UNUSED: 'Source nothing cites',
  UNTAGGED: 'Citation typed as plain text',
};

export function CitationsPanel({
  documentId,
  chapterId,
  editor,
  onRendered,
}: {
  documentId: string;
  chapterId: string;
  editor: Editor | null;
  /** Lets the editor apply the labels the moment they change. */
  onRendered: (rendered: Rendered) => void;
}) {
  const [data, setData] = useState<Rendered | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'bibliography' | 'checks' | 'paste'>('bibliography');

  const load = useCallback(async () => {
    try {
      const rendered = await api<Rendered>(`/documents/${documentId}/citations`);
      setData(rendered);
      onRendered(rendered);
    } catch (e) {
      setError(e instanceof ApiError ? e.problem.title : 'Could not render the citations.');
    }
  }, [documentId, onRendered]);

  useEffect(() => {
    void load();
  }, [load]);

  async function switchLocale(locale: string | null) {
    setBusy(true);
    setError(null);
    try {
      const rendered = await api<Rendered>(`/documents/${documentId}/citation-locale`, {
        method: 'PUT',
        body: JSON.stringify({ locale }),
      });
      setData(rendered);
      onRendered(rendered);
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not switch.');
    } finally {
      setBusy(false);
    }
  }

  async function switchStyle(style: string) {
    setBusy(true);
    setError(null);
    try {
      const rendered = await api<Rendered>(`/documents/${documentId}/citation-style`, {
        method: 'PUT',
        body: JSON.stringify({ style }),
      });
      setData(rendered);
      onRendered(rendered);
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not switch.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="mt-4 border-t border-line pt-3" data-testid="citations-panel">
        <label className="text-xs text-muted" htmlFor="citation-style">
          Citation style
        </label>
        <select
          id="citation-style"
          data-testid="style-switcher"
          disabled={busy || !data}
          value={data?.style ?? ''}
          onChange={(e) => void switchStyle(e.target.value)}
          className="mt-1 w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
        >
          {/* A style chosen from the search is not one of the twenty; without its own option the
              dropdown would show the first entry instead of what is actually in use. */}
          {data && !data.styles.some((s) => s.id === data.style) ? (
            <option value={data.style}>{data.styleLabel}</option>
          ) : null}
          {(data?.styles ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        {data?.locales && data.locales.length > 0 ? (
          <div className="mt-2">
            <label className="text-xs text-muted" htmlFor="citation-locale">
              Language of the citations
            </label>
            <select
              id="citation-locale"
              data-testid="locale-switcher"
              disabled={busy}
              value={data.citationLocale ?? ''}
              onChange={(e) => void switchLocale(e.target.value || null)}
              className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
            >
              <option value="">{automaticLocaleLabel(data)}</option>
              {data.locales.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted">
              The words and dates in each citation: “and” or “&amp;”, “edn” or “ed.”, “2 January
              2024” or “January 2, 2024”.
            </p>
          </div>
        ) : null}
        {data ? (
          <StyleSearch
            current={data.style}
            locale={data.localeOverride ?? null}
            busy={busy}
            onChoose={(id) => void switchStyle(id)}
          />
        ) : null}
        {data?.styles.find((s) => s.id === data.style)?.note ? (
          <p className="mt-1 text-xs text-muted">
            {data.styles.find((s) => s.id === data.style)?.note}
          </p>
        ) : null}
        {data ? (
          <p className="mt-1 text-xs text-muted">
            {data.styleFamily === 'numeric'
              ? 'Numbered in the order your chapters cite them, across the whole thesis.'
              : 'Author–date; the bibliography is alphabetical.'}
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="mt-2 text-xs text-warn">
            {error}
          </p>
        ) : null}

        <div className="mt-3 flex gap-1 text-xs">
          {(
            [
              ['bibliography', `Bibliography ${data ? data.bibliography.length : ''}`],
              ['checks', `Checks ${data ? data.findings.length : ''}`],
              ['paste', 'Paste a reference'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded px-2 py-1 ${tab === key ? 'bg-accent text-accent-ink font-semibold' : 'border border-line text-muted hover:border-line-strong hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'bibliography' ? (
          data && data.bibliography.length > 0 ? (
            <ol className="mt-3 space-y-2 text-xs" data-testid="bibliography">
              {data.bibliography.map((entry) => (
                <li key={entry.sourceId} className="text-ink">
                  {entry.text}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-xs text-muted">
              Nothing is cited yet. The bibliography lists what your chapters actually cite, never
              the whole library.
            </p>
          )
        ) : null}

        {tab === 'checks' ? (
          data && data.findings.length > 0 ? (
            <ul className="mt-3 space-y-2 text-xs" data-testid="citation-checks">
              {data.findings.map((finding) => (
                <li
                  key={`${finding.kind}-${finding.chapterId ?? ''}-${finding.from ?? finding.text ?? finding.message}`}
                  className="rounded-md border border-line bg-surface p-2"
                >
                  <p className="font-medium">{KIND_LABEL[finding.kind] ?? finding.kind}</p>
                  <p className="mt-1 text-muted">{finding.message}</p>
                  {finding.chapterTitle ? (
                    <p className="mt-1 text-muted">In {finding.chapterTitle}</p>
                  ) : null}
                  {finding.chapterId === chapterId && finding.from !== undefined && editor ? (
                    <button
                      type="button"
                      className="mt-1 underline"
                      onClick={() =>
                        editor
                          .chain()
                          .focus()
                          .setTextSelection({ from: finding.from ?? 0, to: finding.to ?? 0 })
                          .run()
                      }
                    >
                      Show me
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-muted">
              Nothing mechanical to fix: every citation has its source, every source is cited, and
              nothing that looks like a citation is sitting in the text untagged.
            </p>
          )
        ) : null}

        {tab === 'paste' ? <PasteParse documentId={documentId} onAdded={load} /> : null}
      </section>
      {/* Below the bibliography on purpose: it is about the sources just listed, and it renders
        nothing at all when there is nothing worth saying. */}
      <ReadingDepth documentId={documentId} />
      {/* Both are about whether the bibliography is sound, so they sit together. */}
      <ReferenceHealth documentId={documentId} />
      <Link
        href={`/app/d/${documentId}/citations`}
        className="mt-3 block px-1 text-xs text-accent hover:underline"
        data-testid="citations-open-report"
      >
        Every citation problem in the thesis, on one page →
      </Link>
    </>
  );
}

type Outcome = {
  raw: string;
  verified: boolean;
  note: string | null;
  match: {
    doi: string | null;
    title: string | null;
    authors: Array<{ family?: string; given?: string }>;
    year: number | null;
    venue: string | null;
  } | null;
};

/**
 * FR-5.5. The model parses, Crossref verifies, and only a verified match offers a button — an
 * unverified one says so and stays out of the library, which is the whole point of the feature.
 */
function PasteParse({ documentId, onAdded }: { documentId: string; onAdded: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function parse() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ outcomes: Outcome[] }>(
        `/documents/${documentId}/citations/parse`,
        { method: 'POST', body: JSON.stringify({ text }) },
      );
      setOutcomes(result.outcomes);
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not parse.');
    } finally {
      setBusy(false);
    }
  }

  async function accept(outcome: Outcome) {
    setBusy(true);
    try {
      await api(`/documents/${documentId}/citations/accept`, {
        method: 'POST',
        body: JSON.stringify({ reference: outcome.raw, doi: outcome.match?.doi ?? null }),
      });
      setAdded((prev) => new Set(prev).add(outcome.raw));
      onAdded();
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not add it.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3" data-testid="paste-parse">
      <label className="text-xs text-muted" htmlFor="paste-reference">
        Paste a reference — or a whole reference list from a draft. Each one is looked up in
        Crossref before it can be added.
      </label>
      <textarea
        id="paste-reference"
        rows={3}
        value={text}
        maxLength={20_000}
        onChange={(e) => setText(e.target.value)}
        placeholder="LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521, 436–444."
        className="mt-1 w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-xs font-semibold text-ink transition-colors hover:bg-sunk"
      />
      <button
        type="button"
        disabled={busy || text.trim().length < 4}
        onClick={() => void parse()}
        className="mt-1 rounded-md px-3 py-1 text-xs disabled:opacity-50 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
      >
        {busy ? 'Checking…' : 'Check'}
      </button>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-warn">
          {error}
        </p>
      ) : null}

      {outcomes ? (
        <ul className="mt-3 space-y-2 text-xs">
          {outcomes.map((outcome) => (
            <li
              key={outcome.raw}
              className={`rounded-md border p-2 ${outcome.verified ? 'border-line bg-surface' : 'border-warn/50 bg-warn/5'}`}
            >
              <p className="text-muted">{outcome.raw}</p>
              {outcome.verified && outcome.match ? (
                <>
                  <p className="mt-1">
                    {outcome.match.title}
                    {outcome.match.year ? ` (${outcome.match.year})` : ''}
                    {outcome.match.venue ? ` · ${outcome.match.venue}` : ''}
                  </p>
                  {added.has(outcome.raw) ? (
                    <p className="mt-1 text-muted">Added — it is being fetched and indexed.</p>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void accept(outcome)}
                      className="mt-1 rounded-md border border-line-strong bg-surface px-2 py-1 font-semibold text-ink transition-colors hover:bg-sunk"
                    >
                      Add to my library
                    </button>
                  )}
                </>
              ) : (
                <p className="mt-1 text-warn">Unverified — check manually. {outcome.note ?? ''}</p>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
