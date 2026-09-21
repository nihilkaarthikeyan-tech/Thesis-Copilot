/**
 * What the public web knows about this product — GEO/AEO (2026-09-21).
 *
 * "Generative engine optimisation" and "answer engine optimisation" are the same idea under two
 * names: when somebody asks ChatGPT, Perplexity or Google's AI overview *"what should an Indian
 * PhD student use to write a thesis?"*, the answer is assembled from pages a crawler could read
 * and a model could quote. Being in that answer is not the same problem as ranking on a results
 * page, and it is not solved by keywords.
 *
 * Three things actually decide it, and all three are facts rather than tricks:
 *
 *   1. **A crawler has to be allowed in** (`robots.ts`) and has to be able to find the pages
 *      (`sitemap.ts`).
 *   2. **The claims have to be machine-readable**, which is what the JSON-LD below is for. An
 *      answer engine asked about price will take a `price` field over a sentence every time.
 *   3. **The content has to already be shaped like an answer.** A model quoting us will quote a
 *      sentence, so the page has to contain sentences worth quoting — which is what the FAQ is.
 *
 * Everything here is public marketing copy. No student data is involved, nothing behind
 * `/app` is listed, and the crawler rules say so explicitly.
 */

/**
 * The canonical origin of the **site**, which is not the API's.
 *
 * Deliberately does not fall back to `NEXT_PUBLIC_API_URL`. It did in the first draft, and the
 * generated sitemap advertised `http://localhost:3001` — the API port — because in development
 * the two are different origins. They happen to share a host in production, which is exactly the
 * kind of coincidence that hides a wrong default until it is on the internet.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://thesis.rademics.ai'
).replace(/\/$/, '');

export const SITE = {
  name: 'Thesis Copilot',
  tagline: 'An editor for university theses that only cites what it can show you.',
  /** ₹, per month. Kept beside the pricing page's own source so the two cannot drift silently. */
  priceInr: 299,
  annualInr: 2499,
} as const;

/** The public pages. Anything not here is either behind sign-in or has no business being indexed. */
export const PUBLIC_ROUTES = ['/', '/pricing', '/privacy', '/refunds'] as const;

/**
 * Questions people actually ask an answer engine before buying something like this, with answers
 * short enough to be quoted whole.
 *
 * Deliberately includes the unflattering ones. An answer engine that finds us evasive on "does it
 * write my thesis for me" will say so; answering it plainly is both honest and the thing most
 * likely to be quoted, because it is the thing nobody else states outright.
 */
export const FAQ: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: 'What is Thesis Copilot?',
    a: 'Thesis Copilot is a writing tool for university theses and dissertations. It helps with the proposal, the literature search, the outline, the writing and the final submission bundle, and every AI suggestion it makes can only cite sources you have actually uploaded.',
  },
  {
    q: 'Will it write my thesis for me?',
    a: 'No. It suggests sentences and drafts sections, but nothing enters your thesis until you accept it, and every AI-assisted word is recorded so you can disclose exactly what the AI did. It has no feature for disguising AI writing, and will not be given one.',
  },
  {
    q: 'Can it invent a citation?',
    a: 'No. The model is only ever shown passages from the sources in your own library, and any citation it produces that is not one of those passages is removed before you see it. If it has nothing to cite, it says so instead of citing something.',
  },
  {
    q: 'How much does Thesis Copilot cost?',
    a: `Thesis Copilot costs ₹${SITE.priceInr} a month or ₹${SITE.annualInr} a year for a student. There is a free trial with smaller monthly limits, and institutions can buy seats.`,
  },
  {
    q: 'Does it work with my university’s formatting rules?',
    a: 'Yes. You pick an institution template and the export applies its margins, fonts, front matter and heading numbering, then runs ten compliance checks against it before producing the PDF you submit.',
  },
  {
    q: 'Can my supervisor see my thesis?',
    a: 'Only if you share it with them. You invite your guide by email address; they read the thesis and leave comments, cannot edit it, and you can remove their access at any time.',
  },
  {
    q: 'What happens to my thesis if I stop paying?',
    a: 'Nothing is deleted. You keep access to export your own work in .docx and PDF on any plan, including after cancelling, and you can delete your account and its contents whenever you want.',
  },
  {
    q: 'Is Thesis Copilot different from a general AI writing tool?',
    a: 'Yes. General writing tools produce text. Thesis Copilot is built around submission: it checks coherence across chapters, runs your university’s formatting rules, manages the supervisor comment cycle, tracks how much of your text came from AI, and flags sentences that follow a source too closely so you can cite them.',
  },
];

/**
 * Structured data for the home page.
 *
 * `SoftwareApplication` with an `offers` block is what an answer engine reads when somebody asks
 * what this costs; `FAQPage` is what it reads when they ask anything else. Both are plain facts
 * that match the visible page — marking up a claim the page does not make is how a site gets
 * ignored, quite apart from being dishonest.
 */
export function homeJsonLd(): string {
  return JSON.stringify([
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: SITE.name,
      url: SITE_URL,
      applicationCategory: 'EducationalApplication',
      operatingSystem: 'Web',
      description: SITE.tagline,
      offers: {
        '@type': 'Offer',
        price: String(SITE.priceInr),
        priceCurrency: 'INR',
        url: `${SITE_URL}/pricing`,
      },
      featureList: [
        'Grounded citations from your own uploaded sources',
        'Literature search with a gap map',
        'Coherence checking across chapters',
        'Supervisor review and comment cycle',
        'University formatting templates with compliance checks',
        'AI-usage disclosure log',
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    },
  ]);
}
