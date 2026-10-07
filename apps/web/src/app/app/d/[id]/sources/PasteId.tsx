'use client';

/**
 * Paste an ID (Jenni build plan R16, ADR-0103): a DOI, an arXiv id, a PubMed id or an ISBN, looked
 * up — "Metadata found": title, authors, year, journal — then imported into the library. Free.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';

type Preview = {
  kind: 'doi' | 'arxiv' | 'pmid' | 'isbn';
  id: string;
  title: string;
  authors: Array<{ family?: string; given?: string; literal?: string }>;
  year: number | null;
  venue: string | null;
  doi: string | null;
};

const KIND: Record<Preview['kind'], string> = {
  doi: 'DOI',
  arxiv: 'arXiv',
  pmid: 'PubMed',
  isbn: 'ISBN',
};

const nameOf = (a: Preview['authors'][number]) =>
  a.literal ?? [a.given, a.family].filter(Boolean).join(' ');

export function PasteId(props: {
  documentId: string;
  onImported: (message: string, sourceId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<'lookup' | 'import' | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const problem = (e: unknown, fallback: string) =>
    e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : fallback;

  async function lookup() {
    setBusy('lookup');
    setError(null);
    setPreview(null);
    try {
      setPreview(
        await api<Preview>(
          `/documents/${props.documentId}/sources/lookup-id?q=${encodeURIComponent(q.trim())}`,
        ),
      );
    } catch (e) {
      setError(problem(e, 'The lookup did not work. Try again in a moment.'));
    } finally {
      setBusy(null);
    }
  }

  async function importIt() {
    setBusy('import');
    setError(null);
    try {
      const result = await api<{ sourceId: string; alreadyPresent: boolean; preview: Preview }>(
        `/documents/${props.documentId}/sources/import-id`,
        { method: 'POST', body: JSON.stringify({ q: q.trim() }) },
      );
      props.onImported(
        result.alreadyPresent
          ? `"${result.preview.title}" is already in your library.`
          : result.preview.kind === 'isbn'
            ? `"${result.preview.title}" added. A book comes with no abstract: add its PDF (or the chapter you use) to quote from it.`
            : `"${result.preview.title}" added. It is being read now.`,
        result.sourceId,
      );
      setQ('');
      setPreview(null);
      setOpen(false);
    } catch (e) {
      setError(problem(e, 'The paper could not be added.'));
    } finally {
      setBusy(null);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="rounded-md border border-line px-3 py-2 text-sm hover:bg-paper"
        onClick={() => setOpen(true)}
        data-testid="paste-id-open"
      >
        Paste an ID
      </button>
    );
  }

  return (
    <div
      className="w-full rounded-md border border-line bg-paper p-3 text-sm"
      data-testid="paste-id"
    >
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) void lookup();
        }}
      >
        <label className="sr-only" htmlFor="paste-id-input">
          DOI, arXiv id, PubMed id or ISBN
        </label>
        <Input
          id="paste-id-input"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPreview(null);
          }}
          placeholder="10.1016/j.enpol.2021.112345 · arXiv:2410.08098 · PMID 31452104 · ISBN"
          className="min-w-0 flex-1"
          data-testid="paste-id-input"
        />
        <Button type="submit" disabled={!q.trim() || busy !== null} data-testid="paste-id-lookup">
          {busy === 'lookup' ? 'Looking…' : 'Look up'}
        </Button>
        <button
          type="button"
          className="text-xs text-muted underline"
          onClick={() => {
            setOpen(false);
            setPreview(null);
            setError(null);
          }}
        >
          Close
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-warn">
          {error}
        </p>
      ) : null}
      {preview ? (
        <div
          className="mt-3 rounded-md border border-line bg-surface p-3"
          data-testid="paste-id-preview"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Found · {KIND[preview.kind]} {preview.id}
          </p>
          <p className="mt-1 font-medium text-ink">{preview.title}</p>
          <p className="mt-0.5 text-[13px] text-muted">
            {[
              preview.authors.slice(0, 4).map(nameOf).join(', ') +
                (preview.authors.length > 4 ? ` and ${preview.authors.length - 4} more` : ''),
              preview.year ? String(preview.year) : null,
              preview.venue,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setPreview(null);
                setQ('');
              }}
            >
              Reset
            </Button>
            <Button
              type="button"
              disabled={busy !== null}
              onClick={() => void importIt()}
              data-testid="paste-id-import"
            >
              {busy === 'import' ? 'Adding…' : 'Add to library'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
