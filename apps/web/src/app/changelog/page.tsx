/**
 * `/changelog` — what changed for students, newest first (2026-10-04, from the Jenni study). The
 * entries are data in `@/content/changelog`; adding a release is one edit there.
 */

import Link from 'next/link';
import { CHANGELOG, formatChangelogDate } from '@/content/changelog';

export const metadata = {
  title: 'What changed',
  description: 'What changed in Thesis Copilot for students, release by release.',
};

export default function ChangelogPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <nav className="text-xs text-muted">
        <Link href="/" className="hover:underline">
          Thesis Copilot
        </Link>{' '}
        / What changed
      </nav>
      <h1 className="mt-2 text-balance text-[30px] font-bold leading-tight tracking-[-0.02em] text-ink">
        What changed
      </h1>
      <p className="mt-2 text-muted">
        Changes you would notice, newest first. How to use them is in{' '}
        <Link href="/help" className="underline">
          Help
        </Link>
        .
      </p>

      {CHANGELOG.map((entry) => (
        <section
          key={entry.version ?? 'unreleased'}
          className="mt-8 border-t border-line pt-4"
          data-testid="changelog-entry"
        >
          <p className="text-xs text-muted">
            {entry.version ? (
              <>
                <span className="font-mono">{entry.version}</span> ·{' '}
                {formatChangelogDate(entry.date)}
              </>
            ) : (
              <>Coming in the next release · built {formatChangelogDate(entry.date)}</>
            )}
          </p>
          <h2 className="mt-1 text-balance text-[17px] font-bold leading-snug text-ink">
            {entry.title}
          </h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted">
            {entry.changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
