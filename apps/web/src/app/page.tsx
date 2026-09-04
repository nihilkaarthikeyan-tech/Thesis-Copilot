import Link from 'next/link';
import { Button } from '@/components/ui/button';

/**
 * `/` — marketing placeholder (PRD §6.1). The real marketing site is Phase 2 week 11.
 * PRD §12.3 asks the marketing site to state the academic-integrity position plainly; that line
 * is here from day one.
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
      <div className="mt-8 flex gap-3">
        <Button asChild>
          <Link href="/sign-in">Sign in</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/app">Your theses</Link>
        </Button>
      </div>
    </main>
  );
}
