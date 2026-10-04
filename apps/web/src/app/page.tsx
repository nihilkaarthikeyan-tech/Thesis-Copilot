import { PLAN_LIMITS, PRICING } from '@tc/config';
import {
  ArrowRight,
  Ban,
  BookOpen,
  Check,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  FileDown,
  FileText,
  Hand,
  Lightbulb,
  MessageSquareText,
  Play,
  Plus,
  Quote,
  Search,
  Table,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { Brand } from '@/components/marketing/Brand';
import { satoshi } from '@/components/marketing/fonts';
import { HeroDemo } from '@/components/marketing/HeroDemo';
import { ProductTour } from '@/components/marketing/ProductTour';
import { SiteHeader } from '@/components/marketing/SiteHeader';
import '@/components/marketing/marketing.css';
import { COMPANY } from '@/lib/company';
import { FAQ, homeJsonLd } from '@/lib/site';
import { cn } from '@/lib/utils';

/**
 * `/` — the marketing home (PRD §6.1, §12.3), redesigned as landing round 7 and approved by the
 * owner on 2026-09-28.
 *
 * Product first: the hero is a real photograph of a student at a desk with the product's two
 * defining moments laid over it — a grey suggestion that is not in the thesis until Tab, and a
 * citation opened to the passage that supports it. Everything below is a real screen, a real rule
 * the code enforces, or a number read from `@tc/config`, so the page cannot promise what the
 * product does not do. The integrity position (§12.3) has its own section, not a footer link.
 *
 * Photographs are from Unsplash, self-hosted under `public/landing/`. The Unsplash licence needs
 * no attribution, and the owner did not want one on the page (2026-09-28). For the record:
 * Sweet Life (4NRgZmVb7bc), Dollar Gill (Kyoshy7BJIQ), litoon dev (9LwA7kToz9g), Sanket Mishra
 * (9i2t23J7HnE); sign-in Shantanu Kumar (NaVcHdClY7A), sign-up Praveen Gupta (YhfxJpa_Ch0).
 */

export const metadata = {
  title: 'A thesis editor that only cites papers you have read',
  description:
    'Write your thesis with suggestions drawn from your own library, check every citation against its source, and show your guide exactly where AI helped.',
};

const TRIAL = PLAN_LIMITS.FREE_TRIAL;
const STUDENT = PLAN_LIMITS.STUDENT_MONTHLY;
const TRIAL_DAYS = TRIAL.trialDays ?? 14;

const PLAN_ROWS: ReadonlyArray<{ label: string; free: string; student: string }> = [
  {
    label: 'Writing suggestions',
    free: `${TRIAL.caps.ASSIST} / month`,
    student: `${STUDENT.caps.ASSIST} / month`,
  },
  {
    label: 'Drafted sections',
    free: `${TRIAL.caps.DRAFT} / month`,
    student: `${STUDENT.caps.DRAFT} / month`,
  },
  {
    label: 'Citation lookups',
    free: `${TRIAL.caps.CITE} / month`,
    student: `${STUDENT.caps.CITE} / month`,
  },
  {
    label: 'Questions to your papers',
    free: `${TRIAL.caps.CHAT} / month`,
    student: `${STUDENT.caps.CHAT} / month`,
  },
  {
    label: 'Viva practice',
    free: `${TRIAL.caps.VIVA} / month`,
    student: `${STUDENT.caps.VIVA} / month`,
  },
  {
    label: 'Whole-thesis consistency check',
    free: TRIAL.caps.COHERENCE > 0 ? `${TRIAL.caps.COHERENCE} / month` : 'Not included',
    student: STUDENT.caps.COHERENCE > 0 ? `${STUDENT.caps.COHERENCE} / month` : 'Not included',
  },
  {
    label: 'Word export',
    free: TRIAL.export === 'FULL' ? 'Complete' : 'Chapters only',
    student: STUDENT.export === 'FULL' ? 'Complete' : 'Chapters only',
  },
];

export default function HomePage() {
  const annualMonthly = Math.round(PRICING.STUDENT_ANNUAL.priceInr / 12);

  return (
    <div className={cn('mk', satoshi.variable)}>
      <SiteHeader />

      <main>
        {/* ------------------------------------------------------------- hero -- */}
        <section className="mk-hero">
          <div className="mk-wrap mk-hero-grid">
            <div>
              <span className="mk-pill">
                <b>New</b> Viva practice from your own chapters
              </span>
              <h1>A thesis editor that only cites papers you've read.</h1>
              <p className="mk-hero-sub">
                Write your chapters with suggestions drawn from your own library, check each
                citation against its source, and show your guide exactly where AI helped. Made for
                master's and PhD students in India.
              </p>
              <div className="mk-acts">
                <Link href="/sign-up" className="mk-btn mk-btn-primary">
                  Start writing free <ArrowRight aria-hidden="true" strokeWidth={2.25} />
                </Link>
                <a href="#tour" className="mk-btn mk-btn-quiet">
                  <Play aria-hidden="true" strokeWidth={2.25} /> See how it works
                </a>
              </div>
              <p className="mk-fine">
                <span>
                  <Check aria-hidden="true" strokeWidth={2.5} />
                  {TRIAL_DAYS}-day free trial, no card
                </span>
                <span>
                  <Check aria-hidden="true" strokeWidth={2.5} />
                  Nothing deleted if you stop paying
                </span>
              </p>
            </div>

            <div className="mk-stage">
              <div className="mk-stage-photo">
                {/* biome-ignore lint/performance/noImgElement: pre-sized WebP in public/; the standalone image runs no image optimiser. */}
                <img
                  src="/landing/student-desk.webp"
                  alt="A postgraduate student writing notes at her desk beside her laptop"
                  width={1400}
                  height={933}
                  fetchPriority="high"
                />
              </div>

              <div className="mk-frag mk-frag-check" aria-hidden="true">
                <div className="mk-frag-k">
                  <i>
                    <Check strokeWidth={3} />
                  </i>
                  Citation supports the sentence
                </div>
                <div className="mk-frag-t">
                  Solar PV adoption at household level: a systematic literature review
                </div>
                <div className="mk-frag-m">Shakeel et al. · Energy Strategy Reviews · 2023</div>
                <div className="mk-frag-q">
                  “…127 factors grouped into eight categories, from economic and technical to
                  regulatory…”
                </div>
              </div>

              <HeroDemo />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ strip -- */}
        <section className="mk-strip" aria-label="What it works with">
          <div className="mk-wrap mk-strip-row">
            <div className="mk-strip-cell">
              <Search aria-hidden="true" strokeWidth={1.75} />
              <div>
                <b>Finds papers</b>
                <span>OpenAlex, Crossref, arXiv, PubMed and CORE</span>
              </div>
            </div>
            <div className="mk-strip-cell">
              <Quote aria-hidden="true" strokeWidth={1.75} />
              <div>
                <b>Formats references</b>
                <span>APA, IEEE, Vancouver, Chicago and every CSL style</span>
              </div>
            </div>
            <div className="mk-strip-cell">
              <FileText aria-hidden="true" strokeWidth={1.75} />
              <div>
                <b>Hands in cleanly</b>
                <span>Word, PDF and LaTeX, with a real contents page</span>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------- tour -- */}
        <section className="mk-sec" id="tour">
          <div className="mk-wrap">
            <div className="mk-sec-head">
              <h2 className="mk-h2">From the first paper to the viva, in one place.</h2>
              <p>
                Each step below is a real screen from the product, using a sample thesis on rooftop
                solar adoption in Karnataka.
              </p>
            </div>
            <ProductTour />
          </div>
        </section>

        {/* ------------------------------------------------------------ rules --
            PRD §12.3: the integrity position, stated on the page itself. */}
        <section className="mk-sec mk-sec-tight">
          <div className="mk-wrap mk-rules">
            <figure className="mk-rules-photo">
              {/* biome-ignore lint/performance/noImgElement: pre-sized WebP in public/; the standalone image runs no image optimiser. */}
              <img
                src="/landing/library-stacks.webp"
                alt="A student reading between library shelves"
                width={1100}
                height={1650}
                loading="lazy"
              />
              <figcaption>Your library is the only place it cites from.</figcaption>
            </figure>
            <div>
              <h2 className="mk-h2">Four rules it follows every time.</h2>
              <p className="mk-lede">
                These aren't settings you can forget to turn on. They're how the product is built,
                so they hold on every chapter and every plan.
              </p>
              <ul className="mk-rulelist">
                <li className="mk-rule">
                  <span className="mk-icon">
                    <BookOpen aria-hidden="true" strokeWidth={1.75} />
                  </span>
                  <div>
                    <h3>It cites only your library.</h3>
                    <p>
                      If the model names a paper you haven't added, that citation is removed before
                      you ever see the suggestion.
                    </p>
                  </div>
                </li>
                <li className="mk-rule">
                  <span className="mk-icon">
                    <Hand aria-hidden="true" strokeWidth={1.75} />
                  </span>
                  <div>
                    <h3>Nothing goes in until you press Tab.</h3>
                    <p>
                      Suggestions stay grey. Drafted sections stay in a marked block until you
                      accept them.
                    </p>
                  </div>
                </li>
                <li className="mk-rule">
                  <span className="mk-icon">
                    <ClipboardList aria-hidden="true" strokeWidth={1.75} />
                  </span>
                  <div>
                    <h3>Every accepted line is on record.</h3>
                    <p>
                      A disclosure log you can hand to your guide or attach to your university's AI
                      declaration.
                    </p>
                  </div>
                </li>
                <li className="mk-rule">
                  <span className="mk-icon">
                    <Ban aria-hidden="true" strokeWidth={1.75} />
                  </span>
                  <div>
                    <h3>No detector evasion, ever.</h3>
                    <p>
                      There is no “humanise” button. It won't rewrite text to slip past AI
                      detectors, and it never will.
                    </p>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------------- guides -- */}
        <section className="mk-sec mk-sec-tight" id="guides">
          <div className="mk-wrap">
            <div className="mk-band">
              <div className="mk-band-txt">
                <p className="mk-band-tag">For guides and committee members</p>
                <h2 className="mk-h2">Read the thesis where it's being written.</h2>
                <p>
                  Your student invites you by email. You read the latest chapter, comment on the
                  exact sentence, and see how much of it they wrote themselves.
                </p>
                <ul>
                  <li>
                    <MessageSquareText aria-hidden="true" strokeWidth={1.75} />
                    Comments pinned to the passage, not to a page number
                  </li>
                  <li>
                    <TrendingUp aria-hidden="true" strokeWidth={1.75} />
                    Live progress: words, chapters, sources still unused
                  </li>
                  <li>
                    <Table aria-hidden="true" strokeWidth={1.75} />A response-to-committee table the
                    student fills in
                  </li>
                  <li>
                    <FileDown aria-hidden="true" strokeWidth={1.75} />
                    Comments from a marked-up .docx come in too
                  </li>
                </ul>
              </div>
              <div className="mk-band-vis">
                {/* biome-ignore lint/performance/noImgElement: pre-sized WebP in public/; the standalone image runs no image optimiser. */}
                <img
                  src="/landing/guide-reading.webp"
                  alt="A senior academic reading on a laptop"
                  width={1400}
                  height={933}
                  loading="lazy"
                />
                <div className="mk-note" aria-hidden="true">
                  <div className="mk-note-who">
                    <span className="mk-av">RK</span>
                    <span>
                      <b>Dr. Ravi Kumar</b> commented on Chapter 1
                    </span>
                  </div>
                  <div className="mk-note-anchor">
                    …
                    <mark>
                      households that could afford a rooftop system still delay the decision
                    </mark>
                    .
                  </div>
                  <div className="mk-note-c">
                    Say which districts. “Rural Karnataka” is too wide for a sample of 212.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------------- finish -- */}
        <section className="mk-sec mk-sec-tight">
          <div className="mk-wrap">
            <div className="mk-sec-head">
              <h2 className="mk-h2">The last month, handled.</h2>
              <p>
                Formatting and the viva are where most theses lose weeks. Both are built in, and
                both use the chapters you've already written.
              </p>
            </div>
            <div className="mk-finish">
              <div className="mk-card">
                <h3>Checked against your template</h3>
                <p>
                  Front matter, headings, the contents page and every reference, checked before you
                  export. The biggest fix is listed first.
                </p>
                <div className="mk-shot" aria-hidden="true">
                  <div className="mk-checks-head">
                    <b>7 of 10 checks pass</b>
                    <span>Submission in 23 days</span>
                  </div>
                  <div className="mk-meter">
                    {Array.from({ length: 10 }, (_, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: a fixed ten-segment meter.
                      <span key={i} data-ok={i < 7} />
                    ))}
                  </div>
                  <ul className="mk-clist">
                    <li>
                      <CircleAlert className="mk-n" strokeWidth={2.25} />
                      Every front-matter field is filled<em>4 to fix</em>
                    </li>
                    <li>
                      <CircleAlert className="mk-n" strokeWidth={2.25} />
                      Required front matter is present<em>2 to fix</em>
                    </li>
                    <li>
                      <CircleAlert className="mk-n" strokeWidth={2.25} />
                      Each chapter starts with one level-1 heading<em>1 to fix</em>
                    </li>
                    <li>
                      <CircleCheck className="mk-y" strokeWidth={2.25} />
                      Citations resolve and the bibliography is not empty<em>Passed</em>
                    </li>
                    <li>
                      <CircleCheck className="mk-y" strokeWidth={2.25} />
                      The contents list matches the headings<em>Passed</em>
                    </li>
                  </ul>
                </div>
              </div>
              <div className="mk-card">
                <h3>Practise the viva</h3>
                <p>
                  Questions an examiner could fairly ask about a paragraph you wrote. You answer; it
                  never answers for you.
                </p>
                <div className="mk-shot" aria-hidden="true">
                  <span className="mk-qtag">IMPLICATIONS · CHAPTER 1</span>
                  <p className="mk-q">
                    How would your household-level findings translate into policy for the 40 GW
                    rooftop target?
                  </p>
                  <p className="mk-ans">
                    I'd argue the subsidy works for the first step, but the delay comes from
                    installer trust, so the policy lever is…
                  </p>
                  <p className="mk-fb">
                    <Lightbulb strokeWidth={2} />
                    <span>
                      Good start. An examiner would ask for evidence on installer trust. Which of
                      your sources supports it?
                    </span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- pricing -- */}
        <section className="mk-sec mk-sec-tight" id="pricing">
          <div className="mk-wrap">
            <div className="mk-sec-head">
              <h2 className="mk-h2">Priced for students.</h2>
              <p>
                Try everything free for {TRIAL_DAYS} days. Upgrade when you're writing every day,
                and cancel whenever you like.
              </p>
            </div>
            <div className="mk-plans">
              <div className="mk-plan">
                <p className="mk-plan-name">Free trial</p>
                <p className="mk-price">
                  <b>₹0</b>
                  <span>for {TRIAL_DAYS} days</span>
                </p>
                <p className="mk-plan-alt">No card. Everything works, in smaller amounts.</p>
                <Link href="/sign-up" className="mk-btn mk-btn-quiet">
                  Start the free trial
                </Link>
                <ul>
                  {PLAN_ROWS.map((row) => (
                    <li key={row.label}>
                      <span>{row.label}</span>
                      <span>{row.free}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mk-plan" data-highlight="true">
                <p className="mk-plan-name">Student</p>
                <p className="mk-price">
                  <b>₹{PRICING.STUDENT_MONTHLY.priceInr}</b>
                  <span>a month</span>
                </p>
                <p className="mk-plan-alt">
                  or ₹{PRICING.STUDENT_ANNUAL.priceInr.toLocaleString('en-IN')} a year, about ₹
                  {annualMonthly} a month
                </p>
                <Link href="/pricing" className="mk-btn mk-btn-primary">
                  Choose Student
                </Link>
                <ul>
                  {PLAN_ROWS.map((row) => (
                    <li key={row.label}>
                      <span>{row.label}</span>
                      <span>{row.student}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mk-dept">
              <p>
                <b>For departments.</b> Buy seats for a batch, with your own thesis template and one
                invoice.
              </p>
              <Link href="/contact" className="mk-btn mk-btn-quiet mk-btn-sm">
                Talk to us
              </Link>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------- faq --
            The same questions are emitted as FAQPage JSON-LD below, from the same constant,
            so the page and the structured data cannot disagree (lib/site.ts). */}
        <section className="mk-sec mk-sec-tight" id="faq">
          <div className="mk-wrap mk-faq">
            <div>
              <h2 className="mk-h2">Before you start.</h2>
              <p className="mk-faq-aside">
                Something else? <Link href="/contact">Write to us</Link> and a person will answer.
              </p>
            </div>
            <div>
              {FAQ.map((item, i) => (
                <details key={item.q} open={i === 0}>
                  <summary>
                    {item.q}
                    <Plus aria-hidden="true" strokeWidth={2} />
                  </summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ close -- */}
        <section className="mk-sec mk-sec-tight">
          <div className="mk-wrap">
            <div className="mk-close">
              <div className="mk-close-txt">
                <h2 className="mk-h2">Start with the paper you already wrote.</h2>
                <p>
                  Upload it and the proposal is built around it. Or begin from a topic and find the
                  gap first.
                </p>
                <div className="mk-acts">
                  <Link href="/sign-up" className="mk-btn mk-btn-primary">
                    Start writing free <ArrowRight aria-hidden="true" strokeWidth={2.25} />
                  </Link>
                  <Link href="/sign-in" className="mk-btn mk-btn-quiet">
                    Sign in
                  </Link>
                </div>
              </div>
              <div className="mk-close-photo">
                {/* biome-ignore lint/performance/noImgElement: pre-sized WebP in public/; the standalone image runs no image optimiser. */}
                <img
                  src="/landing/campus-bench.webp"
                  alt="A student working on a laptop on a campus bench"
                  width={1400}
                  height={934}
                  loading="lazy"
                />
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Structured data, last, so it can never delay the page rendering. */}
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: JSON.stringify of our own constants. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: homeJsonLd() }} />

      {/* ----------------------------------------------------------- footer -- */}
      <footer className="mk-foot">
        <div className="mk-wrap">
          <div className="mk-foot-top">
            <div>
              <Brand />
              <p>
                A thesis editor for master's and PhD students, with a record your guide can read.
              </p>
            </div>
            <div>
              <h4>Product</h4>
              <ul>
                <li>
                  <a href="#tour">How it works</a>
                </li>
                <li>
                  <Link href="/pricing">Pricing</Link>
                </li>
                <li>
                  <a href="#guides">For guides</a>
                </li>
                <li>
                  <Link href="/app">Your theses</Link>
                </li>
              </ul>
            </div>
            <div>
              <h4>Help</h4>
              <ul>
                <li>
                  <Link href="/help">Help</Link>
                </li>
                <li>
                  <a href="#faq">Questions</a>
                </li>
                <li>
                  <Link href="/changelog">What changed</Link>
                </li>
                <li>
                  <Link href="/contact">Contact</Link>
                </li>
              </ul>
            </div>
            <div>
              <h4>Legal</h4>
              <ul>
                <li>
                  <Link href="/privacy">What we do with your text</Link>
                </li>
                <li>
                  <Link href="/terms">Terms</Link>
                </li>
                <li>
                  <Link href="/refunds">Refunds</Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="mk-foot-bot">
            <span>
              © {new Date().getFullYear()} {COMPANY.legalName ?? 'Thesis Copilot'}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
