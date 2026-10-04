/**
 * `/help` — the help index (2026-10-04, from the Jenni study). Public: a student deciding whether
 * to sign up reads it too. The articles are data in `@/content/help`.
 */

import Link from 'next/link';
import { HELP_ARTICLES } from '@/content/help';

export const metadata = {
  title: 'Help',
  description: 'Short, step-by-step help for writing your thesis in Thesis Copilot.',
};

export default function HelpIndexPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <nav className="text-xs text-muted">
        <Link href="/" className="hover:underline">
          Thesis Copilot
        </Link>{' '}
        / Help
      </nav>
      <h1 className="mt-2 text-balance text-[30px] font-bold leading-tight tracking-[-0.02em] text-ink">
        Help
      </h1>
      <p className="mt-2 text-muted">
        How to do each thing, in a few steps. Something missing or wrong?{' '}
        <Link href="/contact" className="underline">
          Tell us
        </Link>
        .
      </p>

      <ul className="mt-6 divide-y divide-line border-y border-line" data-testid="help-index">
        {HELP_ARTICLES.map((article) => (
          <li key={article.slug}>
            <Link href={`/help/${article.slug}`} className="block py-3 hover:bg-sunk">
              <span className="block font-semibold text-ink">{article.title}</span>
              <span className="mt-0.5 block text-sm text-muted">{article.summary}</span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-sm text-muted">
        What changed recently:{' '}
        <Link href="/changelog" className="underline">
          the changelog
        </Link>
        .
      </p>
    </main>
  );
}
