/**
 * `/privacy` — PRD §12.2, §12.3, PHASES v2 W11.3.
 *
 * Written to be read by a student deciding whether to put an unpublished thesis into it. Every
 * claim here is one the code actually keeps.
 */

import Link from 'next/link';

export const metadata = { title: 'Privacy — Thesis Copilot' };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <nav className="text-xs text-muted">
        <Link href="/" className="hover:underline">
          Thesis Copilot
        </Link>{' '}
        / Privacy
      </nav>
      <h1 className="mt-2 text-balance text-[30px] font-bold leading-tight tracking-[-0.02em] text-ink">
        What we do with your text
      </h1>

      <h2 className="mt-8 text-balance text-[17px] font-bold leading-snug text-ink">
        We do not train on it
      </h2>
      <p className="mt-2 text-muted">
        Your thesis, your sources and your prompts are never used to train a model — not ours, not
        anyone&rsquo;s. We send text to our AI provider only to answer the request you made, under
        an agreement that forbids them training on it.
      </p>
      <p className="mt-2 text-muted">
        We also ask the provider not to keep it. Every request we make is marked zero-retention, so
        the provider does not store your text or its own reply once the answer has been returned —
        not for their dashboard, not for review, not for thirty days. There is nothing on their side
        for us, or anyone else, to go back and read.
      </p>

      <h2 className="mt-8 text-balance text-[17px] font-bold leading-snug text-ink">
        What is sent, and when
      </h2>
      <p className="mt-2 text-muted">
        Only when you ask for something. A suggestion sends the paragraph you are in, your outline
        and glossary, and passages from the sources you pinned. A draft sends the section&rsquo;s
        scope note and its passages. Nothing is sent while you type, unless you switch on
        suggest-without-asking, and then only after you pause.
      </p>

      <h2 className="mt-8 text-balance text-[17px] font-bold leading-snug text-ink">
        The Chrome add-on
      </h2>
      <p className="mt-2 text-muted">
        It reads a page only when you click its button, and then only the page&rsquo;s address and
        the tags publishers put on it to describe the article — its title, authors, journal, year
        and DOI. Never the page&rsquo;s text, never another tab, never your browsing history. When
        you choose <em>Add to library</em>, it sends that reference to your thesis, using the
        sign-in you already have on this site. The one thing it keeps in your browser is which
        thesis you added to last.
      </p>

      <h2 className="mt-8 text-balance text-[17px] font-bold leading-snug text-ink">What we log</h2>
      <p className="mt-2 text-muted">
        Every AI call is recorded with its model, its token counts, its cost and how long it took —
        this is how the monthly allowance is counted and how we keep the price honest. The request
        and response bodies are <strong>not</strong> logged. Our application logs never contain your
        thesis text.
      </p>

      <h2 className="mt-8 text-balance text-[17px] font-bold leading-snug text-ink">
        Who can see it
      </h2>
      <p className="mt-2 text-muted">
        You. A supervisor only if you share a document with them, and then only that document, in
        read-and-comment mode. Our administrators can see your email, your plan, your usage and your
        document titles — the things needed to run the service and answer support — and not your
        chapters.
      </p>

      <h2 className="mt-8 text-balance text-[17px] font-bold leading-snug text-ink">
        Where it lives
      </h2>
      <p className="mt-2 text-muted">
        On our own server, in a Postgres database and an object store we run. Files are encrypted in
        transit. Backups are taken nightly and kept for 30 days.
      </p>

      <h2 className="mt-8 text-balance text-[17px] font-bold leading-snug text-ink">Leaving</h2>
      <p className="mt-2 text-muted">
        Export any chapter as .docx or PDF at any time, with or without a subscription — do that
        first, because the rest of this is final.
      </p>
      <p className="mt-2 text-muted">
        Delete your account from the{' '}
        <Link href="/app/account" className="underline">
          account page
        </Link>
        . You are signed out everywhere immediately, and seven days later your theses, chapters,
        sources, uploaded files, exports and comments are erased outright — not hidden, not
        archived. The seven days are yours to change your mind in; nothing has happened until they
        are up. Backups age out within thirty days of that.
      </p>
      <p className="mt-2 text-muted">
        Two things survive: your payment records, which we are required to keep, and a note that the
        deletion was asked for and carried out. Neither contains anything you wrote.
      </p>

      <h2 className="mt-8 text-balance text-[17px] font-bold leading-snug text-ink">Integrity</h2>
      <p className="mt-2 text-muted">
        We do not build “humanising” or detector-evasion features and we will not. What the AI wrote
        stays marked as such in your document, and the AI-usage log is yours to export and disclose.
        See{' '}
        <Link href="/pricing" className="underline">
          the pricing page
        </Link>{' '}
        for the full position.
      </p>
    </main>
  );
}
