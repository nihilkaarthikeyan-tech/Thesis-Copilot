'use client';

/**
 * `/app/d/:id/submit` — PRD §5.8, Appendix D.3, PHASES v2 B3.2–B3.4.
 *
 * The screen a student opens the week before submission. Three things in one place: the details
 * that go on the title page and the certificate, the formatting template, and the checklist that
 * says whether the file will be accepted.
 *
 * The `.docx` button is never disabled. A student must always be able to get their own words out,
 * whatever the checklist says; it is the PDF — the artefact they hand in — that waits for the
 * checks, and even then an override with a reason is offered rather than a wall.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ExportDialog } from '@/components/export/ExportDialog';
import { ApiError, api } from '@/lib/api';
import { templateName } from '@/lib/template-name';
import { LifecycleBar } from './LifecycleBar';
import { ReadinessBanner } from './ReadinessBanner';

type Details = {
  studentName: string;
  rollNo: string;
  degree: string;
  department: string;
  institution: string;
  guideName: string;
  guideDesignation: string;
  hodName: string;
  monthYear: string;
  abstract: string;
  acknowledgements: string;
  abbreviations: Record<string, string>;
  declarationDate: string;
};

type Template = { id: string; name: string; isExample: boolean };

type DetailsResponse = { details: Details; template: Template; templates: Template[] };

type Compliance = {
  passed: boolean;
  templateName: string;
  isExample: boolean;
  checks: Array<{
    check: string;
    label: string;
    passed: boolean;
    findings: Array<{ message: string; chapterTitle?: string }>;
  }>;
  findings: Array<{ check: string; message: string; chapterTitle?: string }>;
};

const FIELDS: Array<{ key: keyof Details; label: string; hint?: string }> = [
  { key: 'studentName', label: 'Your name, as it should appear on the title page' },
  { key: 'rollNo', label: 'Roll or registration number' },
  { key: 'degree', label: 'Degree', hint: 'e.g. Master of Technology in Energy Systems' },
  { key: 'department', label: 'Department' },
  { key: 'institution', label: 'University or institution' },
  { key: 'guideName', label: 'Guide’s name' },
  { key: 'guideDesignation', label: 'Guide’s designation', hint: 'e.g. Associate Professor' },
  { key: 'hodName', label: 'Head of department' },
  { key: 'monthYear', label: 'Month and year of submission', hint: 'e.g. June 2027' },
  { key: 'declarationDate', label: 'Date on the declaration' },
];

export function SubmitScreen({ documentId }: { documentId: string }) {
  const [data, setData] = useState<DetailsResponse | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [compliance, setCompliance] = useState<Compliance | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [response, checks] = await Promise.all([
        api<DetailsResponse>(`/documents/${documentId}/thesis-details`),
        api<Compliance>(`/documents/${documentId}/compliance`),
      ]);
      setData(response);
      setDetails(response.details);
      setCompliance(checks);
    } catch (e) {
      setError(e instanceof ApiError ? e.problem.title : 'Could not load this screen.');
    }
  }, [documentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveDetails() {
    if (!details) return;
    setBusy('details');
    setError(null);
    try {
      await api(`/documents/${documentId}/thesis-details`, {
        method: 'PUT',
        body: JSON.stringify(details),
      });
      setNotice('Saved. These appear on the title page, the certificate and the declaration.');
      setCompliance(await api<Compliance>(`/documents/${documentId}/compliance`));
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not save.');
    } finally {
      setBusy(null);
    }
  }

  async function chooseTemplate(templateId: string) {
    setBusy('template');
    try {
      await api(`/documents/${documentId}/institution-template`, {
        method: 'PUT',
        body: JSON.stringify({ templateId }),
      });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.problem.detail ?? e.problem.title) : 'Could not switch.');
    } finally {
      setBusy(null);
    }
  }

  if (!data || !details) {
    return <p className="p-6 text-sm text-muted">{error ?? 'Loading…'}</p>;
  }

  const failing = compliance?.checks.filter((c) => !c.passed) ?? [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <nav className="text-xs text-muted">
        <Link href="/app" className="hover:underline">
          Theses
        </Link>{' '}
        / Submit
      </nav>
      <h1 className="mt-2 text-balance text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">
        Prepare for submission
      </h1>

      <ReadinessBanner
        documentId={documentId}
        refreshKey={compliance ? compliance.checks.length + (compliance.passed ? 1 : 0) : 0}
      />

      <div className="mt-4">
        <LifecycleBar documentId={documentId} />
      </div>

      {data.template.isExample ? (
        <p
          role="status"
          data-testid="example-template-banner"
          className="mt-4 rounded-md border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn"
        >
          <strong>Template: EXAMPLE.</strong> These margins, fonts and front-matter rules are common
          Indian university conventions, not your university’s. Check them against your own
          guideline before you submit, and ask us to add your university’s template.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 text-sm text-warn">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" data-testid="submit-notice" className="mt-4 text-sm">
          {notice}
        </p>
      ) : null}

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <h2 className="eyebrow">Formatting template</h2>
        <select
          value={data.template.id}
          disabled={busy !== null}
          onChange={(e) => void chooseTemplate(e.target.value)}
          data-testid="template-picker"
          className="mt-2 w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
        >
          {data.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {templateName(t)}
            </option>
          ))}
        </select>
      </section>

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <h2 className="eyebrow">Thesis details</h2>
        <p className="mt-1 text-xs text-muted">
          Filled once. They appear on the title page, the certificate and the declaration.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {FIELDS.map((field) => (
            <div key={field.key}>
              <label className="text-xs text-muted" htmlFor={field.key}>
                {field.label}
              </label>
              <input
                id={field.key}
                value={String(details[field.key] ?? '')}
                onChange={(e) => setDetails({ ...details, [field.key]: e.target.value })}
                className="mt-1 w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
              />
              {field.hint ? <p className="mt-0.5 text-xs text-muted">{field.hint}</p> : null}
            </div>
          ))}
        </div>

        <label className="mt-4 block text-xs text-muted" htmlFor="abstract">
          Abstract
        </label>
        <textarea
          id="abstract"
          rows={5}
          value={details.abstract}
          onChange={(e) => setDetails({ ...details, abstract: e.target.value })}
          className="mt-1 w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
        />
        <p className="mt-0.5 text-xs text-muted">
          {details.abstract.trim().split(/\s+/).filter(Boolean).length} words. The abstract is front
          matter, not a chapter, so it is not numbered.
        </p>

        <label className="mt-4 block text-xs text-muted" htmlFor="acknowledgements">
          Acknowledgements (optional)
        </label>
        <textarea
          id="acknowledgements"
          rows={3}
          value={details.acknowledgements}
          onChange={(e) => setDetails({ ...details, acknowledgements: e.target.value })}
          className="mt-1 w-full rounded-md border border-line-strong bg-surface px-2 py-1 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
        />

        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void saveDetails()}
          data-testid="save-details"
          className="mt-3 rounded-md px-4 py-2 text-sm disabled:opacity-50 bg-accent text-accent-ink hover:bg-accent-hover font-semibold transition-colors"
        >
          {busy === 'details' ? 'Saving…' : 'Save details'}
        </button>
      </section>

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <h2 className="eyebrow">Citations and the viva</h2>
        <p className="mt-1 text-sm">
          Every weak citation in the thesis on one page — retracted papers, sources that do not say
          what the sentence claims, citations typed as plain text.{' '}
          <Link
            href={`/app/d/${documentId}/citations`}
            className="font-semibold text-accent hover:underline"
            data-testid="open-citation-report"
          >
            Open the citation report →
          </Link>
        </p>
        <p className="mt-2 text-sm">
          And an originality check: paste a paragraph to see where it runs too close to the wording
          of a source you cite, so you can quote it or put it in your own words.{' '}
          <Link
            href={`/app/d/${documentId}/originality`}
            className="font-semibold text-accent hover:underline"
            data-testid="open-originality"
          >
            Open the originality check →
          </Link>
        </p>
        <p className="mt-2 text-sm">
          Then the defence: questions an examiner could ask about your thesis, with feedback on your
          answers.{' '}
          <Link
            href={`/app/d/${documentId}/viva`}
            className="font-semibold text-accent hover:underline"
            data-testid="open-viva"
          >
            Prepare for your viva →
          </Link>
        </p>
      </section>

      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <h2 className="eyebrow">
          Formatting checks{' '}
          {compliance ? (
            <span className={compliance.passed ? 'text-muted' : 'text-warn'}>
              · {compliance.passed ? 'all pass' : `${failing.length} to fix`}
            </span>
          ) : null}
        </h2>
        <p className="mt-1 text-xs text-muted">
          Checked against {compliance?.templateName ?? 'the template'}. No AI is involved: each one
          names exactly what is wrong.
        </p>
        <ul className="mt-3 space-y-2 text-sm" data-testid="compliance-checks">
          {(compliance?.checks ?? []).map((check) => (
            <li key={check.check}>
              <p className={check.passed ? 'text-muted' : ''}>
                <span aria-hidden className="mr-2">
                  {check.passed ? '✓' : '✕'}
                </span>
                {check.label}
              </p>
              {check.findings.length > 0 ? (
                <ul className="mt-1 ml-6 space-y-1 text-xs text-warn">
                  {check.findings.map((finding) => (
                    <li key={`${check.check}-${finding.message}`}>
                      {finding.message}
                      {finding.chapterTitle ? ` (${finding.chapterTitle})` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {/* R27 (ADR-0121): one export dialog — the format, citations, a layout preset, the
          advanced options and a live preview. The .docx is always available; the PDF waits for
          the checks above, or a reason. */}
      <section className="mt-6 rounded-md border border-line bg-surface p-4">
        <h2 className="eyebrow">Build the thesis</h2>
        <p className="mt-1 text-sm">
          Word, PDF, LaTeX or a web page, in your template or another layout, with a preview of the
          pages before you build them. The reference list is always in the file.
        </p>
        <button
          type="button"
          onClick={() => setExportOpen(true)}
          data-testid="open-export"
          className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
        >
          Export…
        </button>
        <p className="mt-2 text-xs text-muted">
          The .docx is always available, whatever the checks say — it is your writing. The PDF waits
          for the checks, because it is what you hand in.
        </p>
        {exportOpen ? (
          <ExportDialog
            open
            onClose={() => {
              setExportOpen(false);
              void load();
            }}
            documentId={documentId}
            initialScope="thesis"
          />
        ) : null}
      </section>
    </main>
  );
}
