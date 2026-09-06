import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * `/` — the marketing home (PRD §6.1, §12.3, PHASES v2 W11.3).
 *
 * §12.3 asks the marketing site to state the academic-integrity position plainly. It is the second
 * paragraph, not a link in a footer.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-16">
      <h1 className="font-serif text-4xl leading-tight">Thesis Copilot</h1>
      <p className="mt-4 text-lg text-muted">
        An editor for university theses. It writes with you, cites only what it can show you, and
        keeps a log of everything it did so you can disclose it.
      </p>
      <p className="mt-2 text-sm text-muted">No “humanise” features. No detector evasion. Ever.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/sign-in">Sign in</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/app">Your theses</Link>
        </Button>
      </div>
      <p className="mt-10 text-sm text-muted">
        <Link href="/pricing" className="underline">
          Pricing and what each plan allows
        </Link>{' '}
        ·{' '}
        <Link href="/privacy" className="underline">
          What we do with your text
        </Link>{' '}
        ·{' '}
        <Link href="/refunds" className="underline">
          Refunds
        </Link>
      </p>
    </main>
  );
}
