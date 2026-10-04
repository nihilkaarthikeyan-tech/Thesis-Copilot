/**
 * The pre-submission citation report (2026-09-25): every weak citation in the thesis on one page.
 *
 * Nothing here is a new check. Five already existed, each on its own panel, and a student had to
 * open all five the week before submission to know where they stood: the mechanical checks
 * (a citation to nothing, a citation typed as plain text, a source nothing cites), reference
 * health (retracted, unresolved, duplicated…), reading depth (cited, never read), and the
 * coherence run's support check and uncited claims. This gathers them, drops the overlap and
 * ranks them — what must be fixed before a reader sees it first.
 *
 * Pure: the service fetches, this decides. It never invents a problem — every item is one of
 * those checks' own findings, in that check's own words.
 */

import type { CitationFinding, ReferenceHealthFinding } from '@tc/citations';
import type { ReadingDepth } from '../chapters/reading-depth.js';
import type { FlagView } from '../coherence/coherence.service.js';

export type ReportSeverity = 'high' | 'medium' | 'low';

export type ReportItem = {
  key: string;
  severity: ReportSeverity;
  /** Which existing check found it. */
  check: 'citations' | 'references' | 'reading' | 'support' | 'density';
  kind: string;
  /** A few words naming the problem, for the list. */
  title: string;
  /** The check's own sentence, addressed to the student. */
  message: string;
  chapterId?: string;
  chapterTitle?: string;
  /** Where in the chapter — only when the position is still true of the saved text. */
  from?: number;
  to?: number;
  sourceId?: string;
  shortRef?: string;
};

export type CitationReport = {
  headline: string;
  counts: { high: number; medium: number; low: number; total: number };
  citations: number;
  sources: number;
  /**
   * The support check is the one part that costs a run. `lastRunAt` null means it has never run,
   * so the report cannot say whether the sources support the sentences — and says so.
   */
  supportCheck: { lastRunAt: string | null; outOfDate: boolean };
  items: ReportItem[];
};

export type ReportInput = {
  citations: { findings: CitationFinding[]; counts: { citations: number; sources: number } };
  health: ReferenceHealthFinding[];
  depth: Pick<ReadingDepth, 'atRisk' | 'unread'>;
  flags: { flags: FlagView[]; lastRunAt: string | null };
  /** Per-chapter paragraph counts for the citation-density check (2026-09-30). Optional. */
  chapters?: ChapterDensity[];
};

/**
 * How well a chapter that reviews prior work is cited (2026-09-30).
 *
 * A reviewer's comparison with Jenni found our Literature Review "describes the review without
 * reviewing anything": 300 words, no citation. In a review, a paragraph that cites nothing is
 * almost always a paragraph that says nothing checkable. Counted from the saved chapter; only
 * paragraphs of 40 words or more count, so headings and one-line links are left alone.
 */
export type ChapterDensity = {
  chapterId: string;
  chapterTitle: string;
  words: number;
  citations: number;
  paragraphs: number;
  uncitedParagraphs: number;
  /**
   * "Citation needed" markers (`needsSourceNote`) still in the chapter's own text — the ones the
   * student put in with the "/" menu, or kept from an accepted draft. Pending drafts are not
   * counted: they are not thesis text yet.
   */
  placeholders?: number;
};

const REVIEW_TITLE =
  /\b(literature|review|related work|state of the art|prior work|previous studies|theoretical (background|framework)|background)\b/i;

/** Whether a chapter's title says it reviews prior work. */
export function isReviewChapter(title: string): boolean {
  return REVIEW_TITLE.test(title);
}

type PmNode = { type?: string; text?: string; content?: PmNode[] };

/** Paragraph and citation counts for one chapter's saved content. */
export function chapterDensity(chapter: {
  id: string;
  title: string;
  content: unknown;
}): ChapterDensity {
  let words = 0;
  let citations = 0;
  let paragraphs = 0;
  let uncited = 0;
  const walk = (node: PmNode): void => {
    if (node.type === 'paragraph') {
      let text = '';
      let cites = 0;
      const inner = (n: PmNode): void => {
        if (n.type === 'text') text += n.text ?? '';
        if (n.type === 'citation') cites++;
        for (const c of n.content ?? []) inner(c);
      };
      inner(node);
      const count = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
      words += count;
      citations += cites;
      if (count >= 40) {
        paragraphs++;
        if (cites === 0) uncited++;
      }
      return;
    }
    for (const c of node.content ?? []) walk(c);
  };
  walk((chapter.content ?? {}) as PmNode);
  let placeholders = 0;
  const findMarkers = (node: PmNode): void => {
    if (node.type === 'draftBlock') return;
    if (node.type === 'needsSourceNote') placeholders++;
    for (const c of node.content ?? []) findMarkers(c);
  };
  findMarkers((chapter.content ?? {}) as PmNode);
  return {
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    words,
    citations,
    paragraphs,
    uncitedParagraphs: uncited,
    placeholders,
  };
}

/**
 * A review chapter with at least two substantial paragraphs, half or more of them uncited. Not a
 * rule about a number of citations per page: a review with one citation per paragraph is fine,
 * however short.
 */
export function thinlyCited(d: ChapterDensity): boolean {
  return (
    isReviewChapter(d.chapterTitle) &&
    d.paragraphs >= 2 &&
    d.uncitedParagraphs >= 2 &&
    d.uncitedParagraphs / d.paragraphs >= 0.5
  );
}

const MECHANICAL: Record<CitationFinding['kind'], { severity: ReportSeverity; title: string }> = {
  ORPHAN: { severity: 'high', title: 'Citation with no source' },
  UNTAGGED: { severity: 'medium', title: 'Citation typed as plain text' },
  UNUSED: { severity: 'low', title: 'In the library, never cited' },
};

const HEALTH_TITLE: Record<ReferenceHealthFinding['kind'], string> = {
  RETRACTED: 'Retracted paper',
  STALE_PREPRINT: 'Old preprint',
  DUPLICATE: 'Same reference twice',
  UNRESOLVED: 'Not found in any index',
  NO_IDENTIFIER: 'No DOI',
  VENUE_CONCENTRATION: 'One journal dominates',
};

const FLAG_SEVERITY: Record<string, ReportSeverity> = {
  ERROR: 'high',
  WARN: 'medium',
  INFO: 'low',
};

/** ADR-0023's verdicts arrive as severities: ERROR misrepresents, WARN overstates. */
/**
 * How the support check's DIFFERENT_SUBJECT flag begins (coherence-run.ts `supportFlagText`). The
 * flag keeps no verdict of its own, so its wording is how the report tells it apart.
 */
export const DIFFERENT_SUBJECT_TEXT = 'This source studies a different material or setting';

const SUPPORT_TITLE: Record<ReportSeverity, string> = {
  high: 'The source says something else',
  medium: 'Claims more than the source',
  low: 'Weakly supported',
};

const RANK: Record<ReportSeverity, number> = { high: 0, medium: 1, low: 2 };
const CHECK_RANK: Record<ReportItem['check'], number> = {
  citations: 0,
  support: 1,
  density: 2,
  references: 3,
  reading: 4,
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildCitationReport(input: ReportInput): CitationReport {
  const items: ReportItem[] = [];

  input.citations.findings.forEach((finding, i) => {
    const rule = MECHANICAL[finding.kind];
    items.push({
      key: `citations-${finding.kind}-${i}`,
      severity: rule.severity,
      check: 'citations',
      kind: finding.kind,
      title: rule.title,
      message: finding.message,
      ...(finding.chapterId ? { chapterId: finding.chapterId } : {}),
      ...(finding.chapterTitle ? { chapterTitle: finding.chapterTitle } : {}),
      ...(finding.from !== undefined && finding.to !== undefined
        ? { from: finding.from, to: finding.to }
        : {}),
      ...(finding.sourceId ? { sourceId: finding.sourceId } : {}),
    });
  });

  input.health.forEach((finding, i) => {
    items.push({
      key: `references-${finding.kind}-${i}`,
      severity: finding.severity,
      check: 'references',
      kind: finding.kind,
      title: HEALTH_TITLE[finding.kind],
      message: finding.message,
      sourceId: finding.sourceId,
      shortRef: finding.shortRef,
    });
  });

  // Reading depth names sources, not sentences: "cited, never read" is a risk to every claim
  // resting on it. Weighted below the checks that point at a definite fault.
  for (const source of input.depth.unread) {
    items.push({
      key: `reading-unread-${source.sourceId}`,
      severity: 'medium',
      check: 'reading',
      kind: 'UNREAD',
      title: 'Cited, never read',
      message: `You cite ${source.shortRef} ${plural(source.citeCount, 'time')}, and nothing of it — not even the abstract — was ever retrieved, so no check could compare your sentences with it. Add the PDF to your library.`,
      sourceId: source.sourceId,
      shortRef: source.shortRef,
    });
  }
  for (const source of input.depth.atRisk) {
    items.push({
      key: `reading-abstract-${source.sourceId}`,
      severity: 'low',
      check: 'reading',
      kind: 'ABSTRACT_ONLY',
      title: 'Cited often, read only in abstract',
      message: `You cite ${source.shortRef} ${plural(source.citeCount, 'time')}, and only its abstract has been read. Add the PDF so the claims resting on it can be checked against the paper itself.`,
      sourceId: source.sourceId,
      shortRef: source.shortRef,
    });
  }

  // From the coherence run, only what is about citations and is still open. Its
  // CITATION_INTEGRITY flags are left out on purpose: they are the mechanical checks above as of
  // the last run, and the ones above are as of now.
  for (const flag of input.flags.flags) {
    if (flag.status !== 'OPEN') continue;
    if (flag.type !== 'CITATION_SUPPORT' && flag.type !== 'UNSUPPORTED_CLAIM') continue;
    const severity = FLAG_SEVERITY[flag.severity] ?? 'low';
    items.push({
      key: `support-${flag.id}`,
      severity,
      check: 'support',
      kind: flag.type,
      title:
        flag.type !== 'CITATION_SUPPORT'
          ? 'A claim with no citation'
          : flag.description.startsWith(DIFFERENT_SUBJECT_TEXT)
            ? 'Different material or setting'
            : SUPPORT_TITLE[severity],
      message: flag.description,
      chapterId: flag.chapterId,
      chapterTitle: flag.chapterTitle,
      ...(flag.positionTrusted ? { from: flag.from, to: flag.to } : {}),
    });
  }

  // A place the student marked to come back to. High: it prints as "[NEEDS SOURCE: …]" in
  // every export, which is right — hiding a gap is worse — but nobody wants an examiner to see it.
  for (const chapter of input.chapters ?? []) {
    const n = chapter.placeholders ?? 0;
    if (n === 0) continue;
    items.push({
      key: `citations-placeholder-${chapter.chapterId}`,
      severity: 'high',
      check: 'citations',
      kind: 'CITATION_NEEDED',
      title: 'Citation still to add',
      message: `“${chapter.chapterTitle}” has ${plural(n, 'place')} marked “citation needed”. Cite a source there, or rewrite the sentence so it does not need one; until then the marker prints in the exported thesis.`,
      chapterId: chapter.chapterId,
      chapterTitle: chapter.chapterTitle,
    });
  }

  for (const chapter of input.chapters ?? []) {
    if (!thinlyCited(chapter)) continue;
    items.push({
      key: `density-${chapter.chapterId}`,
      severity: 'medium',
      check: 'density',
      kind: 'THIN_REVIEW',
      title: 'Review with few citations',
      message: `“${chapter.chapterTitle}” reviews prior work, but ${chapter.uncitedParagraphs} of its ${plural(chapter.paragraphs, 'paragraph')} cite nothing (${plural(chapter.citations, 'citation')} in ${chapter.words.toLocaleString('en-IN')} words). In a literature review, each paragraph should rest on the studies it discusses: add the sources, or cut what they cannot support.`,
      chapterId: chapter.chapterId,
      chapterTitle: chapter.chapterTitle,
    });
  }

  // Stable: within a severity, the order each check already reads in.
  items.sort(
    (a, b) => RANK[a.severity] - RANK[b.severity] || CHECK_RANK[a.check] - CHECK_RANK[b.check],
  );

  const counts = { high: 0, medium: 0, low: 0, total: items.length };
  for (const item of items) counts[item.severity] += 1;

  const parts = [
    counts.high ? `${counts.high} to fix before anyone reads it` : null,
    counts.medium ? `${counts.medium} worth fixing` : null,
    counts.low ? `${counts.low} minor` : null,
  ].filter(Boolean);

  return {
    headline: parts.length > 0 ? `${parts.join(', ')}.` : 'No citation problems found.',
    counts,
    citations: input.citations.counts.citations,
    sources: input.citations.counts.sources,
    supportCheck: {
      lastRunAt: input.flags.lastRunAt,
      outOfDate: input.flags.flags.some((flag) => flag.status === 'OPEN' && !flag.positionTrusted),
    },
    items,
  };
}
