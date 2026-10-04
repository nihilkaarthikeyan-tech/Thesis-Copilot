/**
 * `/help/:slug` — one help article (2026-10-04). Rendered at build time from `@/content/help`; an
 * unknown slug is a 404.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HELP_ARTICLES, helpArticle } from '@/content/help';

export function generateStaticParams() {
  return HELP_ARTICLES.map((article) => ({ slug: article.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const article = helpArticle((await params).slug);
  return article ? { title: `${article.title} · Help`, description: article.summary } : {};
}

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const article = helpArticle((await params).slug);
  if (!article) notFound();
  const index = HELP_ARTICLES.indexOf(article);
  const next = HELP_ARTICLES[index + 1];

  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <nav className="text-xs text-muted">
        <Link href="/" className="hover:underline">
          Thesis Copilot
        </Link>{' '}
        /{' '}
        <Link href="/help" className="hover:underline">
          Help
        </Link>
      </nav>
      <h1 className="mt-2 text-balance text-[30px] font-bold leading-tight tracking-[-0.02em] text-ink">
        {article.title}
      </h1>
      <article data-testid="help-article">{article.body()}</article>

      <div className="mt-10 flex flex-wrap justify-between gap-3 border-t border-line pt-4 text-sm">
        <Link href="/help" className="underline">
          All help
        </Link>
        {next ? (
          <Link href={`/help/${next.slug}`} className="underline">
            Next: {next.title}
          </Link>
        ) : null}
      </div>
    </main>
  );
}
