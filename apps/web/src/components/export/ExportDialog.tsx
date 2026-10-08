'use client';

/**
 * One export dialog (Jenni build plan R27, ADR-0121), for the chapter (from the editor) and the
 * whole thesis (from the editor or the submission page).
 *
 * What to export, the format, how citations are written (ADR-0055), a layout preset, the advanced
 * options, and a live preview drawn from the same numbers the file is built with
 * (`resolveLayout`). It keeps everything the submission page promised: the university template is
 * the Thesis preset; the ten checks still run, and the PDF still waits for them — a layout that
 * departs from the template is itself a PAGE_SETUP finding, so the PDF then asks for a reason; and
 * the reference list is always in the file.
 */

import {
  type CitationMode,
  type ExportLayout,
  type FontStyle,
  LAYOUT_FONTS,
  LAYOUT_MARGINS,
  LAYOUT_PRESETS,
  LAYOUT_SIZES,
  LAYOUT_SPACINGS,
  type LayoutPreset,
  readFontStyle,
  readTemplateSpec,
  resolveLayout,
  type TemplateSpec,
  type ThesisDetails,
} from '@tc/types';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { LayoutPreview } from './LayoutPreview';

export type ExportScope = 'chapter' | 'thesis';
type Format = 'docx' | 'pdf' | 'latex' | 'html';

const FORMATS: ReadonlyArray<{ id: Format; label: string; thesisOnly?: boolean }> = [
  { id: 'docx', label: 'Word (.docx)' },
  { id: 'pdf', label: 'PDF' },
  { id: 'latex', label: 'LaTeX (.zip)', thesisOnly: true },
  { id: 'html', label: 'Web page (.html)', thesisOnly: true },
];

const PRESET_LABEL: Record<LayoutPreset, { label: string; hint: string }> = {
  thesis: { label: 'Thesis', hint: 'Your university template: title page, contents, its fonts.' },
  default: { label: 'Plain', hint: '11 pt in your font style, 1.15 lines, 1-inch margins.' },
  double: { label: 'Double-spaced', hint: '12 pt Times New Roman, double spaced, 1-inch margins.' },
  'two-column': { label: 'Two-column', hint: '10 pt, two columns, narrow margins.' },
};

const MARGIN_LABEL = {
  narrow: 'Narrow (0.75 in)',
  moderate: 'Moderate (1 in)',
  wide: 'Wide (1.5 in)',
};

const CITATION_CHOICES: Array<{ mode: CitationMode; label: string; hint: string }> = [
  { mode: 'plain', label: 'Plain text', hint: 'As they appear in the editor.' },
  {
    mode: 'linked',
    label: 'Linked to the references',
    hint: 'Each citation links to its entry in the reference list. Word, LibreOffice and Google Docs.',
  },
  {
    mode: 'word',
    label: 'Word citations',
    hint: 'Your sources go into Word’s Manage Sources; restyle or update them there. Microsoft Word only.',
  },
];

const NOTICE: Record<Format, string> = {
  docx: 'Built. Word will offer to update the contents when you open it — say yes.',
  pdf: 'Built. The contents pages were filled in during the conversion.',
  latex:
    'Built. Upload the .zip to Overleaf as a new project. biblatex formats its reference list, so it will not match the editor exactly — README.txt explains.',
  html: 'Built. One file, figures included: open it in any browser, or send it on.',
};

type DetailsResponse = {
  details: ThesisDetails;
  template: { id: string; name: string; isExample: boolean; spec: unknown };
};
type Compliance = {
  passed: boolean;
  checks: Array<{ check: string; label: string; passed: boolean }>;
};
type Download = { filename: string; url: string; sha256?: string };

/** The layout the student chose: the preset and only what they changed. */
type Choice = ExportLayout;

export function ExportDialog({
  open,
  onClose,
  documentId,
  documentTitle,
  chapter,
  initialScope,
}: {
  open: boolean;
  onClose: () => void;
  documentId: string;
  /** Known in the editor; fetched otherwise. */
  documentTitle?: string;
  /** The chapter open in the editor; absent on the submission page (whole thesis only). */
  chapter?: { id: string; title: string; order: number; content: () => unknown };
  initialScope: ExportScope;
}) {
  const [scope, setScope] = useState<ExportScope>(initialScope);
  const [format, setFormat] = useState<Format>('docx');
  const [citations, setCitations] = useState<CitationMode>('plain');
  const [choice, setChoice] = useState<Choice>({
    preset: initialScope === 'chapter' ? 'default' : 'thesis',
  });
  const [presetTouched, setPresetTouched] = useState(false);
  const [data, setData] = useState<DetailsResponse | null>(null);
  const [fontStyle, setFontStyle] = useState<FontStyle>('default');
  const [sample, setSample] = useState<{ title: string; order: number; content: unknown } | null>(
    null,
  );
  const [compliance, setCompliance] = useState<Compliance | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [override, setOverride] = useState('');
  const [needsReason, setNeedsReason] = useState(false);
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [title, setTitle] = useState(documentTitle ?? '');

  // What the dialog needs, once it opens: the template, the font style, and a page of text.
  useEffect(() => {
    if (!open) return;
    api<DetailsResponse>(`/documents/${documentId}/thesis-details`)
      .then(setData)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.problem.title : 'Could not load the template.'),
      );
    api<{ fontStyle?: unknown }>('/settings')
      .then((s) => setFontStyle(readFontStyle(s.fontStyle)))
      .catch(() => undefined);
    if (chapter) {
      setSample({ title: chapter.title, order: chapter.order, content: chapter.content() });
    } else {
      api<{ title: string; chapters: Array<{ id: string; title: string; order: number }> }>(
        `/documents/${documentId}`,
      )
        .then(async (doc) => {
          setTitle(doc.title);
          const first = doc.chapters[0];
          if (!first) return;
          const loaded = await api<{ content: unknown }>(`/chapters/${first.id}`);
          setSample({ title: first.title, order: first.order, content: loaded.content });
        })
        .catch(() => undefined);
    }
  }, [open, documentId, chapter]);

  // The checks are the thesis's; they decide whether its PDF is built.
  useEffect(() => {
    if (!open || scope !== 'thesis') return;
    api<Compliance>(`/documents/${documentId}/compliance`)
      .then(setCompliance)
      .catch(() => undefined);
  }, [open, scope, documentId]);

  const spec: TemplateSpec | null = useMemo(
    () => (data ? readTemplateSpec(data.template.spec) : null),
    [data],
  );
  const contentsBlock = useMemo(
    () => JSON.stringify(sample?.content ?? '').includes('"tableOfContents"'),
    [sample],
  );
  const layout = useMemo(
    () => (spec ? resolveLayout(spec, choice, { fontStyle, contentsBlock }) : null),
    [spec, choice, fontStyle, contentsBlock],
  );

  const setScopeTo = (next: ExportScope) => {
    setScope(next);
    if (!presetTouched)
      setChoice((c) => ({ ...c, preset: next === 'chapter' ? 'default' : 'thesis' }));
    if (next === 'chapter' && (format === 'latex' || format === 'html')) setFormat('docx');
    setNeedsReason(false);
  };
  const set = (patch: Partial<Choice>) => setChoice((c) => ({ ...c, ...patch }));

  async function build() {
    if (!layout) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body = {
        format,
        layout: choice,
        ...(format === 'docx' ? { citations } : {}),
      };
      const result =
        scope === 'chapter' && chapter
          ? await api<Download>(`/documents/${documentId}/export`, {
              method: 'POST',
              body: JSON.stringify({ ...body, chapterId: chapter.id }),
            })
          : await api<Download>(`/documents/${documentId}/export/thesis`, {
              method: 'POST',
              body: JSON.stringify({
                ...body,
                ...(format === 'pdf' && override.trim() ? { overrideReason: override.trim() } : {}),
              }),
            });
      setDownloads((prev) => [result, ...prev].slice(0, 5));
      setNotice(NOTICE[format]);
      setNeedsReason(false);
      setOverride('');
    } catch (e) {
      const problem = e instanceof ApiError ? e.problem : null;
      setError(problem ? (problem.detail ?? problem.title) : 'The export did not finish.');
      if (format === 'pdf' && scope === 'thesis' && problem?.status === 400) setNeedsReason(true);
    } finally {
      setBusy(false);
    }
  }

  const failing = compliance?.checks.filter((c) => !c.passed) ?? [];
  const select =
    'w-full min-w-0 rounded-md border border-line-strong bg-surface px-2 py-1 text-[13px] text-ink';

  return (
    <Dialog open={open} onClose={onClose} title="Export" testId="export-dialog" size="wide">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
        <div className="min-w-0 space-y-4">
          {chapter ? (
            <fieldset className="min-w-0">
              <legend className="eyebrow">What</legend>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {(
                  [
                    ['chapter', 'This chapter'],
                    ['thesis', 'The whole thesis'],
                  ] as const
                ).map(([id, label]) => (
                  <label
                    key={id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-[13px]',
                      scope === id
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-line text-ink',
                    )}
                  >
                    <input
                      type="radio"
                      name="export-scope"
                      value={id}
                      checked={scope === id}
                      onChange={() => setScopeTo(id)}
                      data-testid={`export-scope-${id}`}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <fieldset className="min-w-0">
            <legend className="eyebrow">Format</legend>
            <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FORMATS.filter((f) => scope === 'thesis' || !f.thesisOnly).map((f) => (
                <label
                  key={f.id}
                  className={cn(
                    'flex min-w-0 cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-[13px]',
                    format === f.id
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-line text-ink',
                  )}
                >
                  <input
                    type="radio"
                    name="export-format"
                    value={f.id}
                    checked={format === f.id}
                    onChange={() => {
                      setFormat(f.id);
                      setNeedsReason(false);
                    }}
                    data-testid={`export-format-${f.id}`}
                  />
                  <span className="min-w-0">{f.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {format === 'docx' ? (
            <fieldset className="min-w-0" data-testid="citation-mode">
              <legend className="eyebrow">Citations in the .docx</legend>
              <div className="mt-1 space-y-1">
                {CITATION_CHOICES.map((c) => (
                  <label key={c.mode} className="flex items-start gap-2 text-xs text-muted">
                    <input
                      type="radio"
                      name="citation-mode"
                      value={c.mode}
                      checked={citations === c.mode}
                      onChange={() => setCitations(c.mode)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="font-semibold text-ink">{c.label}.</span> {c.hint}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <fieldset className="min-w-0">
            <legend className="eyebrow">Layout</legend>
            <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {LAYOUT_PRESETS.map((preset) => (
                <label
                  key={preset}
                  className={cn(
                    'flex min-w-0 cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-[13px]',
                    choice.preset === preset
                      ? 'border-accent bg-accent-soft'
                      : 'border-line hover:bg-sunk',
                  )}
                >
                  <input
                    type="radio"
                    name="export-preset"
                    value={preset}
                    checked={choice.preset === preset}
                    onChange={() => {
                      setPresetTouched(true);
                      // A new preset starts clean: the advanced options were the old one's.
                      setChoice({ preset });
                    }}
                    data-testid={`export-preset-${preset}`}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink">
                      {PRESET_LABEL[preset].label}
                    </span>
                    <span className="block text-xs text-muted">
                      {preset === 'thesis' && data
                        ? `${data.template.name}${data.template.isExample ? ' (example)' : ''}: title page, contents, its fonts.`
                        : PRESET_LABEL[preset].hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <details className="min-w-0 rounded-md border border-line" data-testid="export-advanced">
            <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold text-ink">
              Advanced options
            </summary>
            {layout ? (
              <div className="grid grid-cols-1 gap-3 border-t border-line p-3 sm:grid-cols-2">
                <label className="min-w-0 text-xs text-muted">
                  Paper
                  <select
                    className={select}
                    data-testid="export-paper"
                    value={layout.paper}
                    onChange={(e) => set({ paper: e.target.value as 'A4' | 'Letter' })}
                  >
                    <option value="A4">A4</option>
                    <option value="Letter">Letter</option>
                  </select>
                </label>
                <label className="min-w-0 text-xs text-muted">
                  Font
                  <select
                    className={select}
                    data-testid="export-font"
                    value={layout.font}
                    onChange={(e) => {
                      // The template's own font is the preset's, not an option to send.
                      set({ font: LAYOUT_FONTS.find((f) => f === e.target.value) });
                    }}
                  >
                    {(LAYOUT_FONTS as readonly string[]).includes(layout.font) ? null : (
                      <option value={layout.font}>{layout.font} (template)</option>
                    )}
                    {LAYOUT_FONTS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="min-w-0 text-xs text-muted">
                  Size
                  <select
                    className={select}
                    data-testid="export-size"
                    value={layout.sizePt}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      set({
                        sizePt: (LAYOUT_SIZES as readonly number[]).includes(n) ? n : undefined,
                      });
                    }}
                  >
                    {(LAYOUT_SIZES as readonly number[]).includes(layout.sizePt) ? null : (
                      <option value={layout.sizePt}>{layout.sizePt} pt (template)</option>
                    )}
                    {LAYOUT_SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n} pt
                      </option>
                    ))}
                  </select>
                </label>
                <label className="min-w-0 text-xs text-muted">
                  Line spacing
                  <select
                    className={select}
                    data-testid="export-spacing"
                    value={layout.lineSpacing}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      set({
                        lineSpacing: (LAYOUT_SPACINGS as readonly number[]).includes(n)
                          ? n
                          : undefined,
                      });
                    }}
                  >
                    {(LAYOUT_SPACINGS as readonly number[]).includes(layout.lineSpacing) ? null : (
                      <option value={layout.lineSpacing}>{layout.lineSpacing} (template)</option>
                    )}
                    {LAYOUT_SPACINGS.map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? 'Single' : n === 2 ? 'Double' : n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="min-w-0 text-xs text-muted sm:col-span-2">
                  Margins
                  <select
                    className={select}
                    data-testid="export-margins"
                    value={choice.margins ?? ''}
                    onChange={(e) =>
                      set({
                        margins: (e.target.value || undefined) as
                          | (typeof LAYOUT_MARGINS)[number]
                          | undefined,
                      })
                    }
                  >
                    <option value="">
                      As the layout has them ({Math.round(layout.marginsMm.left)} mm left,{' '}
                      {Math.round(layout.marginsMm.right)} mm right)
                    </option>
                    {LAYOUT_MARGINS.map((m) => (
                      <option key={m} value={m}>
                        {MARGIN_LABEL[m]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid min-w-0 grid-cols-1 gap-1.5 text-[13px] sm:col-span-2 sm:grid-cols-2">
                  <Check
                    label="Title page"
                    testId="export-title-page"
                    checked={layout.titlePage}
                    disabled={scope === 'chapter'}
                    onChange={(v) => set({ titlePage: v })}
                  />
                  <Check
                    label={
                      layout.contentsForced
                        ? 'Table of contents (your chapter has one)'
                        : 'Table of contents'
                    }
                    testId="export-contents"
                    checked={layout.contents}
                    disabled={scope === 'chapter' || layout.contentsForced}
                    onChange={(v) => set({ contents: v })}
                  />
                  <Check
                    label="Page numbers"
                    testId="export-page-numbers"
                    checked={layout.pageNumbers}
                    onChange={(v) => set({ pageNumbers: v })}
                  />
                  <Check
                    label="Your guide’s open comments (Word)"
                    testId="export-comments"
                    checked={layout.comments}
                    disabled={format !== 'docx' && format !== 'pdf'}
                    onChange={(v) => set({ comments: v })}
                  />
                </div>
                {scope === 'chapter' ? (
                  <p className="text-xs text-muted sm:col-span-2">
                    A title page and contents page belong to the whole thesis.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="border-t border-line p-3 text-xs text-muted">Loading…</p>
            )}
          </details>

          {scope === 'thesis' && layout ? (
            <div className="space-y-1 text-xs text-muted" data-testid="export-checks">
              <p>
                The reference list is always in the file.{' '}
                {compliance
                  ? compliance.passed
                    ? 'All ten formatting checks pass on your template.'
                    : `${failing.length} formatting check${failing.length === 1 ? '' : 's'} to fix before the PDF.`
                  : null}{' '}
                <Link
                  href={`/app/d/${documentId}/submit`}
                  className="font-semibold text-accent hover:underline"
                >
                  Details and the title page →
                </Link>
              </p>
              {!layout.matchesTemplate ? (
                <p className="text-warn" data-testid="export-not-template">
                  This layout is not your university template. The .docx is yours to use; the PDF
                  asks for a reason, kept with the export.
                </p>
              ) : null}
            </div>
          ) : null}

          {needsReason ? (
            <div className="rounded-md border border-warn/40 bg-warn/5 p-3 text-sm">
              <label className="text-xs text-muted" htmlFor="export-override">
                If your university’s rule differs from what we checked, or you want this layout, say
                so and the PDF will be built anyway. The reason is kept with the export.
              </label>
              <textarea
                id="export-override"
                rows={2}
                value={override}
                onChange={(e) => setOverride(e.target.value)}
                className="mt-1 w-full min-w-0 rounded-md border border-line-strong bg-surface px-2 py-1 text-ink"
              />
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-warn">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" data-testid="submit-notice" className="text-sm">
              {notice}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="export-download"
              disabled={busy || !layout || (needsReason && override.trim().length < 10)}
              onClick={() => void build()}
              className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? 'Building…' : needsReason ? 'Build the PDF anyway' : 'Build the file'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line-strong px-3 py-2 text-sm text-ink hover:bg-sunk"
            >
              Close
            </button>
          </div>

          {downloads.length > 0 ? (
            <ul className="grid grid-cols-1 gap-2 text-xs" data-testid="downloads">
              {downloads.map((file) => (
                <li key={file.url} className="min-w-0">
                  <a
                    href={file.url}
                    download={file.filename}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="export-link"
                    className="block break-all font-semibold text-accent underline"
                  >
                    {file.filename}
                  </a>
                  {file.sha256 ? (
                    <span
                      className="mt-0.5 block select-all break-all font-mono text-[10.5px] text-muted"
                      title="SHA-256 fingerprint — verify your file with: sha256sum (Linux) or Get-FileHash (Windows)"
                      data-testid="export-sha256"
                    >
                      SHA-256 {file.sha256}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="min-w-0 md:border-l md:border-line md:pl-5">
          <p className="eyebrow mb-2">Preview</p>
          {layout && spec ? (
            <LayoutPreview
              layout={layout}
              spec={spec}
              details={data?.details ?? null}
              documentTitle={title}
              chapterTitle={sample?.title ?? title}
              chapterNumber={sample?.order ?? 1}
              content={sample?.content}
              scope={scope}
            />
          ) : (
            <p className="text-xs text-muted">Loading…</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function Check({
  label,
  testId,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  testId: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={cn('flex min-w-0 items-start gap-2', disabled && 'opacity-60')}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
        className="mt-0.5"
      />
      <span className="min-w-0">{label}</span>
    </label>
  );
}
