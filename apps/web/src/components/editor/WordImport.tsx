'use client';

/**
 * "Import from Word" (2026-10-04, from the Jenni study): a student with a half-written thesis in a
 * `.docx` brings it in as chapters instead of pasting it a chapter at a time.
 *
 * Three steps in one dialog: pick the file, look at what it found (every chapter with its length,
 * what will not come across) and choose where it goes, then a summary. The server does the work
 * (`POST /documents/:id/import-docx`); the preview is the same call with `mode=preview`, which
 * writes nothing. No model is involved, so it costs nothing from the allowance.
 *
 * Opened from the chapter list, or straight away when the page is reached with `?import=word`
 * (the "Create and import from Word" button on the new-thesis screen).
 *
 * R34 (ADR-0113): the preview and the summary both say why the file's citations were not linked —
 * no references section, or, with one, that an import adds no papers — and where the list went.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ApiError, api } from '@/lib/api';
import { citationNotice, type ReferencesFound } from '@/lib/word-import-notice';

export const IMPORT_PARAM = 'import';

type Summary = {
  chapters: Array<{ title: string; words: number; sections: number; preamble: boolean }>;
  words: number;
  images: number;
  footnotes: number;
  tables: number;
  citationLike: number;
  /** References sections found in the file (ADR-0113); their entries are not counted as citations. */
  references: ReferencesFound[];
  splitAtHeadings: boolean;
};
type Preview = Summary & {
  existing: { chapters: number; withText: number };
  canReplace: boolean;
};
type Result = Summary & {
  mode: Mode;
  created: Array<{ id: string; title: string; words: number }>;
  replaced: number;
};
type Mode = 'append' | 'replace';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function problemText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? (error.problem.detail ?? error.problem.title) : fallback;
}

/** R34 (ADR-0113): why the citations were not linked, said before and after the import. */
function CitationNotice({ summary }: { summary: Summary }) {
  const notice = citationNotice({
    citationLike: summary.citationLike,
    references: summary.references ?? [],
  });
  return (
    <div
      role="note"
      data-testid="word-import-citations"
      data-tone={notice.tone}
      className={`min-w-0 break-words rounded-md border p-3 text-[13px] ${
        notice.tone === 'warn' ? 'border-warn/40 bg-warn-soft' : 'border-line bg-sunk'
      }`}
    >
      <p className="font-semibold text-ink">{notice.title}</p>
      {notice.lines.map((line) => (
        <p key={line} className="mt-1 text-muted">
          {line}
        </p>
      ))}
    </div>
  );
}

export function WordImport({ documentId }: { documentId: string }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<Mode>('append');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The button lives in the chapter list, which is hidden on a phone until its drawer opens; the
  // dialog is drawn at the top of the page so `?import=word` shows it there too.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.body), []);

  // `?import=word` opens the dialog on arrival, and is taken off the address so a reload does not.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get(IMPORT_PARAM) !== 'word') return;
    setOpen(true);
    url.searchParams.delete(IMPORT_PARAM);
    window.history.replaceState(null, '', url.toString());
  }, []);

  function reset() {
    setFile(null);
    setPreview(null);
    setMode('append');
    setResult(null);
    setError(null);
  }

  function close() {
    // After an import the chapter list (and, after a replace, this chapter) is out of date.
    if (result) {
      window.location.reload();
      return;
    }
    setOpen(false);
    reset();
  }

  async function send(chosen: File, as: 'preview' | Mode) {
    const form = new FormData();
    form.append('file', chosen);
    return api<Preview | Result>(`/documents/${documentId}/import-docx?mode=${as}`, {
      method: 'POST',
      body: form,
    });
  }

  async function choose(chosen: File) {
    reset();
    if (!chosen.name.toLowerCase().endsWith('.docx')) {
      setError(
        'Choose a Word document saved as .docx. In Word, use File → Save As → Word Document (.docx).',
      );
      return;
    }
    setFile(chosen);
    setBusy(true);
    try {
      const found = (await send(chosen, 'preview')) as Preview;
      setPreview(found);
      setMode('append');
    } catch (e) {
      setFile(null);
      setError(problemText(e, 'That file could not be read.'));
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setResult((await send(file, mode)) as Result);
    } catch (e) {
      setError(problemText(e, 'The import did not finish. Nothing was changed.'));
    } finally {
      setBusy(false);
    }
  }

  const first = result?.created[0];

  const dialog = (
    <Dialog open={open} title="Import from Word" onClose={close} testId="word-import">
      {result ? (
        <div className="space-y-3" data-testid="word-import-summary">
          <p role="status">
            {result.mode === 'replace' ? 'Your thesis is now ' : 'Added '}
            {plural(result.created.length, 'chapter')}, {plural(result.words, 'word')}.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            {result.images > 0 ? (
              <li>
                {result.images === 1
                  ? '1 image was not imported'
                  : `${result.images} images were not imported`}{' '}
                — insert {result.images === 1 ? 'it as a figure' : 'them as figures'}.
              </li>
            ) : null}
            {result.footnotes > 0 ? <li>{plural(result.footnotes, 'footnote')} kept.</li> : null}
          </ul>
          <CitationNotice summary={result} />
          <div className="flex flex-wrap gap-2 pt-1">
            {first ? (
              <Button
                onClick={() => window.location.assign(`/app/d/${documentId}/write/${first.id}`)}
              >
                Open “{first.title}”
              </Button>
            ) : null}
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
          </div>
        </div>
      ) : preview && file ? (
        <div className="space-y-3">
          <p className="text-muted">
            {preview.splitAtHeadings
              ? `${file.name} has ${plural(preview.chapters.length, 'chapter')}, split at each Heading 1.`
              : `${file.name} has no Heading 1, so it comes in as one chapter.`}
          </p>
          <ol
            className="max-h-56 list-decimal space-y-1 overflow-y-auto pl-5"
            data-testid="word-import-chapters"
          >
            {preview.chapters.map((chapter, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: two chapters may share a title.
              <li key={index}>
                <span className="font-semibold">{chapter.title}</span>{' '}
                <span className="tnum text-muted">· {plural(chapter.words, 'word')}</span>
                {chapter.preamble ? (
                  <span className="text-muted"> (the text before the first heading)</span>
                ) : null}
              </li>
            ))}
          </ol>
          <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted">
            {preview.images > 0 ? (
              <li>
                {plural(preview.images, 'image')} will not come across — insert{' '}
                {preview.images === 1 ? 'it as a figure' : 'them as figures'} afterwards.
              </li>
            ) : null}
            {preview.tables > 0 || preview.footnotes > 0 ? (
              <li>
                {[
                  preview.tables > 0 ? plural(preview.tables, 'table') : '',
                  preview.footnotes > 0 ? plural(preview.footnotes, 'footnote') : '',
                ]
                  .filter(Boolean)
                  .join(' and ')}{' '}
                will come across.
              </li>
            ) : null}
          </ul>
          <CitationNotice summary={preview} />

          <fieldset className="space-y-2 rounded-md border border-line p-3">
            <legend className="px-1 text-[12px] font-semibold">Where the chapters go</legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="word-import-mode"
                checked={mode === 'append'}
                onChange={() => setMode('append')}
                className="mt-1"
              />
              <span>Add as new chapters after the existing ones</span>
            </label>
            <label className={`flex items-start gap-2 ${preview.canReplace ? '' : 'text-faint'}`}>
              <input
                type="radio"
                name="word-import-mode"
                checked={mode === 'replace'}
                disabled={!preview.canReplace}
                onChange={() => setMode('replace')}
                className="mt-1"
              />
              <span>
                Replace this empty thesis
                <span className="block text-[12px] text-muted">
                  {preview.canReplace
                    ? 'Your chapters have no text yet; each is kept in its history first.'
                    : `Not available: ${plural(preview.existing.withText, 'chapter')} already ${preview.existing.withText === 1 ? 'has' : 'have'} text, and an import never writes over it.`}
                </span>
              </span>
            </label>
          </fieldset>

          {error ? (
            <p role="alert" className="text-warn">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void runImport()} disabled={busy}>
              {busy ? 'Importing…' : `Import ${plural(preview.chapters.length, 'chapter')}`}
            </Button>
            <Button variant="ghost" onClick={reset} disabled={busy}>
              Choose another file
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-muted">
            Each Heading 1 becomes a chapter; Heading 2 and 3 stay headings. Paragraphs, lists,
            tables, footnotes, bold and italic come across as you wrote them. Pictures do not — you
            insert those as figures. Citations typed as text stay as text.
          </p>
          <input
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            aria-label="Word document to import"
            data-testid="word-import-file"
            disabled={busy}
            className="block w-full text-[13px]"
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              e.target.value = '';
              if (chosen) void choose(chosen);
            }}
          />
          {busy ? <p className="text-muted">Reading the file…</p> : null}
          {error ? (
            <p role="alert" className="text-warn">
              {error}
            </p>
          ) : null}
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
        </div>
      )}
    </Dialog>
  );

  return (
    <>
      <button
        type="button"
        className="mt-3 text-[12px] font-semibold text-muted hover:text-accent"
        data-testid="word-import-open"
        onClick={() => setOpen(true)}
      >
        Import from Word
      </button>
      {host ? createPortal(dialog, host) : null}
    </>
  );
}
