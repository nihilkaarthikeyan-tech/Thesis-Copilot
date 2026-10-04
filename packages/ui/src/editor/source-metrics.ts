/**
 * The small facts shown beside a source — on a library row, on the citation hover card and on the
 * evidence card under a suggestion (coverage map rows 21, 32, 46: Jenni shows cited-by, impact
 * factor and an open-access badge).
 *
 * One wording for all three places. Every badge is a fact something actually fetched: a figure
 * that is null or absent gets no badge at all, never a "0" or a "Closed", because "not looked up"
 * and "none" are different things (CLAUDE.md: never assert a fact the code has not observed).
 *
 * "Journal citedness" is OpenAlex's 2-year mean citedness (ADR-0022), named as OpenAlex's and never
 * as an impact factor, which is Clarivate's figure from Clarivate's data.
 */

export type SourceMetricFacts = {
  /** Times cited, as counted by OpenAlex (or Crossref, when OpenAlex did not have the paper). */
  citedByCount?: number | null;
  /** True free to read, false closed, null or absent not known. Only `true` shows a badge. */
  openAccess?: boolean | null;
  /** The open-access route (`gold`, `green` …), for the tooltip. */
  oaStatus?: string | null;
  /** The journal's 2-year mean citedness from OpenAlex. */
  journalCitedness?: number | null;
};

export type SourceMetricBadge = {
  kind: 'cited' | 'open-access' | 'citedness';
  /** What the badge says: "Cited by 1,234", "Open access", "Journal citedness 3.1". */
  label: string;
  /** The plain explanation, for a `title` tooltip. */
  title: string;
};

export const CITEDNESS_EXPLAINED =
  'Mean citations per paper for this journal over two years, from OpenAlex. A guide to how much the journal is cited — not the Clarivate Journal Impact Factor.';

const ROUTE: Record<string, string> = {
  gold: 'published open access',
  diamond: 'published open access, free to publish too',
  hybrid: 'made open in a subscription journal',
  bronze: 'free to read on the publisher’s site',
  green: 'a free copy in a repository',
};

const count = new Intl.NumberFormat('en-US');

export function sourceMetricBadges(facts: SourceMetricFacts): SourceMetricBadge[] {
  const out: SourceMetricBadge[] = [];
  const cited = facts.citedByCount;
  if (typeof cited === 'number' && Number.isFinite(cited) && cited >= 0) {
    out.push({
      kind: 'cited',
      label: `Cited by ${count.format(cited)}`,
      title:
        'How many other works cite this paper, as counted by OpenAlex (or Crossref) when it was looked up.',
    });
  }
  if (facts.openAccess === true) {
    const route = ROUTE[(facts.oaStatus ?? '').toLowerCase()];
    out.push({
      kind: 'open-access',
      label: 'Open access',
      title: route ? `Free to read: ${route}.` : 'Free to read.',
    });
  }
  const citedness = facts.journalCitedness;
  if (typeof citedness === 'number' && Number.isFinite(citedness)) {
    out.push({
      kind: 'citedness',
      label: `Journal citedness ${citedness.toFixed(1)}`,
      title: CITEDNESS_EXPLAINED,
    });
  }
  return out;
}
