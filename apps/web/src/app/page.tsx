import Link from 'next/link';
import { ThemeToggle } from '@/components/theme';
import { Button } from '@/components/ui/button';
import { Badge, Kbd } from '@/components/ui/primitives';

/**
 * `/` — the marketing home (PRD §6.1, §12.3, PHASES v2 W11.3).
 *
 * The page has one job: make a student who is already anxious about their submission believe this
 * tool will not get them into trouble. So the integrity position is not a footer link — it is the
 * second thing on the page and it has its own panel (§12.3).
 *
 * The hero shows the product doing the one thing that distinguishes it: proposing a sentence in
 * grey that the student has not accepted yet, with the source it is grounded in sitting next to
 * it. Everything else on the page is subordinate to that demonstration.
 */

export const metadata = {
  title: 'An editor for university theses',
  description:
    'Thesis Copilot writes with you, cites only what it can show you, and logs every AI action so you can disclose it.',
};

const STAGES = [
  { n: 'Proposal', d: 'Start from a paper you have written, or from a topic. It finds the gap.' },
  {
    n: 'Sources',
    d: 'Your library, indexed to the paragraph. Full text where the licence allows.',
  },
  { n: 'Outline', d: 'A chapter tree you can edit, not a template you have to fight.' },
  { n: 'Write', d: 'Suggestions as you type, grounded in your own sources.' },
  { n: 'Citations', d: '22 styles. Switch APA to IEEE without touching the body text.' },
  { n: 'Submit', d: 'A .docx with numbered headings, a real contents page and a bibliography.' },
];

export default function HomePage() {
  return (
    <div className="min-h-dvh">
      {/* ------------------------------------------------------------ nav -- */}
      <header className="border-b border-line">
        <nav className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3.5">
          <span className="font-serif text-[17px] font-semibold tracking-tight">
            Thesis Copilot
          </span>
          <div className="flex items-center gap-1.5">
            <ThemeToggle className="mr-1 hidden sm:inline-flex" />
            <Button asChild variant="ghost" size="sm">
              <Link href="/pricing">Pricing</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6">
        {/* --------------------------------------------------------- hero -- */}
        <section className="grid gap-10 border-b border-line py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:gap-14">
          <div>
            <p className="eyebrow">For postgraduate and doctoral writing</p>
            <h1 className="mt-3 text-balance font-serif text-[40px] font-semibold leading-[1.08] tracking-tight sm:text-[46px]">
              It only cites what it can show you.
            </h1>
            <p className="mt-4 max-w-[52ch] text-[16px] leading-relaxed text-muted">
              An editor for university theses. It writes with you, grounds every citation in a
              passage from your own library, and keeps a log of everything it did — so you can
              disclose it.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/sign-in">Start writing</Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <Link href="/pricing">See what each plan allows</Link>
              </Button>
            </div>
            <p className="mt-4 text-[13px] text-muted">
              No credit card to start · sign in with a code, no password
            </p>
          </div>

          {/* A still of the editor, with the one behaviour that matters. */}
          <figure className="m-0">
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              <div className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-2 text-[11px] text-muted">
                <span className="truncate font-semibold text-ink">Chapter 1 · Introduction</span>
                <span className="tnum shrink-0">Saved · Assist 1/50</span>
              </div>
              <div className="px-5 py-5">
                <p className="font-serif text-[14.5px] leading-[1.75] text-ink">
                  Household adoption of rooftop solar in rural Karnataka remains low despite falling
                  panel prices <span className="font-semibold text-accent">(Kumar, 2021)</span>.{' '}
                  <span className="text-ghost">
                    This puzzle motivates the research: what barriers prevent rural households from
                    adopting the technology even as it becomes more affordable?
                  </span>
                  <span className="ml-px inline-block h-[13px] w-px translate-y-[2px] bg-accent" />
                </p>
                <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
                  <Kbd>Ctrl</Kbd>
                  <Kbd>/</Kbd>
                  <span>suggest</span>
                  <span aria-hidden="true">·</span>
                  <Kbd>Tab</Kbd>
                  <span>keep it</span>
                  <span aria-hidden="true">·</span>
                  <Kbd>Esc</Kbd>
                  <span>discard</span>
                </p>
              </div>
              <div className="border-t border-line bg-sunk px-3.5 py-2.5">
                <div className="flex items-start gap-2.5">
                  <Badge tone="ok">Full text</Badge>
                  <div className="min-w-0">
                    <p className="truncate text-[11.5px] font-semibold text-ink">
                      Solar adoption barriers in rural Karnataka
                    </p>
                    <p className="text-[10.5px] text-muted">Kumar et al. · 2021 · page 4</p>
                  </div>
                </div>
              </div>
            </div>
            <figcaption className="mt-2.5 text-[12px] text-faint">
              Grey is the model's suggestion. It is not in your thesis until you press Tab.
            </figcaption>
          </figure>
        </section>

        {/* ---------------------------------------------------- integrity -- */}
        <section className="border-b border-line py-12">
          <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div>
              <p className="eyebrow">Where we stand</p>
              <h2 className="mt-2.5 text-balance font-serif text-[25px] font-semibold leading-tight">
                No “humanise” button. Not now, not later.
              </h2>
            </div>
            <div className="grid gap-3 text-[14.5px] leading-relaxed text-muted sm:grid-cols-2">
              <p className="border-l-2 border-line pl-4">
                <strong className="font-semibold text-ink">Nothing writes itself in.</strong> Every
                suggestion arrives in grey and stays there until you accept it. Your thesis contains
                exactly what you decided to keep.
              </p>
              <p className="border-l-2 border-line pl-4">
                <strong className="font-semibold text-ink">It cannot invent a source.</strong> The
                model may only cite passages it was shown. Anything else is stripped before it
                reaches you and counted against us.
              </p>
              <p className="border-l-2 border-line pl-4">
                <strong className="font-semibold text-ink">Everything is logged.</strong> Which
                ranges came from AI, and how. Export it and hand it to your guide.
              </p>
              <p className="border-l-2 border-line pl-4">
                <strong className="font-semibold text-ink">No detector evasion.</strong> We will not
                build a feature whose purpose is to hide that you used a tool. Ever.
              </p>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- stages -- */}
        <section className="border-b border-line py-12">
          <p className="eyebrow">First page to submission</p>
          <h2 className="mt-2.5 text-balance font-serif text-[25px] font-semibold leading-tight">
            One place for the whole thesis.
          </h2>
          <ol className="mt-7 grid list-none gap-x-8 gap-y-6 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {STAGES.map((stage, i) => (
              <li key={stage.n} className="flex gap-3.5">
                <span className="tnum mt-0.5 shrink-0 font-mono text-[11px] font-medium text-faint">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div>
                  <h3 className="font-serif text-[16px] font-semibold text-ink">{stage.n}</h3>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{stage.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------------------------------------------------------- cta -- */}
        <section className="flex flex-wrap items-center justify-between gap-6 py-12">
          <div>
            <h2 className="text-balance font-serif text-[25px] font-semibold leading-tight">
              Start with the paper you already wrote.
            </h2>
            <p className="mt-1.5 max-w-[50ch] text-[14px] text-muted">
              Upload it and Thesis Copilot builds the proposal around it — or begin from a topic and
              let it find the gap.
            </p>
          </div>
          <Button asChild size="lg">
            <Link href="/sign-in">Start writing</Link>
          </Button>
        </section>
      </main>

      {/* --------------------------------------------------------- footer -- */}
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-6 text-[13px]">
          <p className="text-faint">© {new Date().getFullYear()} Thesis Copilot</p>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-muted">
            <Link href="/pricing" className="hover:text-ink">
              Pricing
            </Link>
            <Link href="/privacy" className="hover:text-ink">
              What we do with your text
            </Link>
            <Link href="/refunds" className="hover:text-ink">
              Refunds
            </Link>
            <Link href="/app" className="hover:text-ink">
              Your theses
            </Link>
          </nav>
          <ThemeToggle className="sm:hidden" />
        </div>
      </footer>
    </div>
  );
}
