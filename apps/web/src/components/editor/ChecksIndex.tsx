'use client';

/**
 * Every check in one list (2026-10-04, from the Jenni study).
 *
 * Jenni keeps its five checks on one Review panel, one button each. Ours were spread over seven
 * places — this tab's coherence run, proofreading and paraphrase check, the citation report, the
 * originality check, the Submit page, viva practice and the guide's comments — and a student had to
 * know each existed to find it. This list names them all where the student already looks.
 */

import Link from 'next/link';

export function ChecksIndex({
  documentId,
  onOpenReview,
}: {
  documentId: string;
  /** Switches the tool panel to the guide's comments. */
  onOpenReview: () => void;
}) {
  const here = 'text-[12px] text-muted';
  const link = 'text-[12px] font-semibold text-accent underline';
  const rows: Array<{ name: string; what: string; action: React.ReactNode }> = [
    {
      name: 'Coherence and claim support',
      what: 'Contradictions, undefined terms, and claims your sources do not support.',
      action: <span className={here}>Below — “Check coherence”</span>,
    },
    {
      name: 'Proofreading',
      what: 'Spelling, grammar and punctuation, without changing your words.',
      action: <span className={here}>Below</span>,
    },
    {
      name: 'Too close to a source',
      what: 'Sentences that run near-verbatim to a paper you cite.',
      action: <span className={here}>Below</span>,
    },
    {
      name: 'Citation report',
      what: 'Retracted papers, weak or unsupported citations, sources never cited.',
      action: (
        <Link href={`/app/d/${documentId}/citations`} className={link}>
          Open
        </Link>
      ),
    },
    {
      name: 'Originality',
      what: 'Paste a paragraph to see where it follows a source too closely.',
      action: (
        <Link href={`/app/d/${documentId}/originality`} className={link}>
          Open
        </Link>
      ),
    },
    {
      name: 'Formatting and front matter',
      what: 'Ten checks against your university template before you submit.',
      action: (
        <Link href={`/app/d/${documentId}/submit`} className={link}>
          Open
        </Link>
      ),
    },
    {
      name: 'Viva practice',
      what: 'Questions an examiner could ask about what you wrote, with feedback.',
      action: (
        <Link href={`/app/d/${documentId}/viva`} className={link}>
          Open
        </Link>
      ),
    },
    {
      name: "Your guide's comments",
      what: 'Comments and suggested revisions from your guide or committee.',
      action: (
        <button type="button" onClick={onOpenReview} className={link}>
          Open
        </button>
      ),
    },
  ];

  return (
    <details data-testid="checks-index" className="mb-4 rounded-md border border-line bg-paper p-3">
      <summary className="cursor-pointer text-[12px] font-semibold uppercase tracking-wide text-ink">
        Every check, in one list
      </summary>
      <ul className="mt-2 grid gap-2">
        {rows.map((row) => (
          <li key={row.name} className="flex items-start justify-between gap-3">
            <span>
              <span className="block text-[13px] font-medium text-ink">{row.name}</span>
              <span className="block text-[12px] text-muted">{row.what}</span>
            </span>
            <span className="shrink-0">{row.action}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
