/**
 * Evidence checks — spec §7.1 E1, E2, E7, E8, E9. E3 (references exist) is read off the `Source`
 * rows by the worker; E4 and E5 are the examiner's and the citation-support check's.
 */

import { isUncitedAttribution } from '../builder/quality.js';
import {
  HAS_CITE,
  measurementsIn,
  normalise,
  numbersIn,
  proseParagraphs,
  sentencesOf,
  stripCites,
  wordCount,
} from './text.js';
import {
  CHAPTER_LEVEL,
  type CheckContext,
  type CheckPassage,
  type CheckSection,
  type RawIssue,
} from './types.js';

const skipForEvidence = (s: CheckSection): boolean =>
  s.isObjectives || s.organisation || s.summary || s.dataOnly;

/**
 * E1: no uncited factual paragraph. Blocking in a literature review, or when the paragraph
 * credits research with a finding or gives a figure; a warning otherwise.
 */
export function checkUncitedParagraphs(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('E1')) return [];
  const issues: RawIssue[] = [];
  const minCites = Math.max(1, ctx.discipline.minCitationsPerFactualParagraph);
  for (const section of ctx.sections) {
    if (skipForEvidence(section)) continue;
    for (const paragraph of proseParagraphs(section.markdown)) {
      if (wordCount(paragraph) < 40) continue;
      const cites = (paragraph.match(/\{\{cite:[^}]+\}\}/g) ?? []).length;
      if (cites >= minCites) continue;
      const signalled =
        isUncitedAttribution(paragraph) || measurementsIn(stripCites(paragraph)).length > 0;
      const blocking = ctx.chapterRole === 'LITERATURE' || signalled;
      issues.push({
        checkId: 'E1',
        severity: blocking ? 'blocking' : 'warning',
        sectionId: section.id,
        sentence: stripCites(paragraph).slice(0, 200),
        explanation:
          cites === 0
            ? 'This paragraph makes factual claims and cites nothing.'
            : `This paragraph cites ${cites} passage(s); the ${ctx.discipline.displayName} profile asks for ${minCites} per factual paragraph.`,
        suggestedFix: 'Cite the passage each claim rests on, or mark the claim [[NEEDS SOURCE]].',
      });
    }
  }
  return issues;
}

/** E2: a number with a unit, or a percentage, outside a Results chapter, with no citation. */
export function checkUncitedNumbers(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('E2')) return [];
  const issues: RawIssue[] = [];
  for (const section of ctx.sections) {
    if (skipForEvidence(section)) continue;
    for (const sentence of sentencesOf(section.markdown)) {
      if (HAS_CITE.test(sentence)) continue;
      const found = measurementsIn(sentence);
      if (found.length === 0) continue;
      issues.push({
        checkId: 'E2',
        severity: 'blocking',
        sectionId: section.id,
        sentence: stripCites(sentence),
        explanation: `The figure “${found[0]?.full}” has no citation. A number the thesis did not measure must come from a source.`,
        suggestedFix: 'Cite the passage the figure comes from, or remove the figure.',
      });
    }
  }
  return issues;
}

/** E7: the profile's share of cited sources within its recency window. */
export function checkRecency(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('E7')) return [];
  const years = ctx.sourceYears.filter((y) => Number.isFinite(y) && y > 1800);
  if (years.length < 3) return [];
  const cutoff = ctx.now.getUTCFullYear() - ctx.discipline.recencyTarget.years;
  const recent = years.filter((y) => y >= cutoff).length;
  const share = recent / years.length;
  if (share >= ctx.discipline.recencyTarget.share) return [];
  return [
    {
      checkId: 'E7',
      severity: 'warning',
      sectionId: CHAPTER_LEVEL,
      sentence: '',
      explanation: `${recent} of the ${years.length} cited sources are from ${cutoff} or later (${Math.round(share * 100)}%); the ${ctx.discipline.displayName} profile expects ${Math.round(ctx.discipline.recencyTarget.share * 100)}%.`,
      suggestedFix: `Add recent work (${cutoff} onwards) to the library and build again, or say in the review why the field's key sources are older.`,
    },
  ];
}

const RUN = 12;

function ngrams(text: string, n: number): Set<string> {
  const words = normalise(text)
    .split(' ')
    .filter((w) => w.length > 0);
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
}

/** E8: no twelve-word run copied from a passage. */
export function checkCopiedRuns(ctx: CheckContext): {
  issues: RawIssue[];
  copiedRuns: number;
  checkedWords: number;
} {
  let checkedWords = 0;
  if (!ctx.enabled.has('E8')) return { issues: [], copiedRuns: 0, checkedWords };
  const issues: RawIssue[] = [];
  let copiedRuns = 0;
  for (const section of ctx.sections) {
    const passages = ctx.passages.get(section.id) ?? [];
    const grams = new Map<string, CheckPassage>();
    for (const passage of passages) {
      for (const gram of ngrams(passage.text, RUN)) grams.set(gram, passage);
    }
    for (const sentence of sentencesOf(section.markdown)) {
      const plain = stripCites(sentence);
      checkedWords += wordCount(plain);
      if (grams.size === 0) continue;
      const words = normalise(plain)
        .split(' ')
        .filter((w) => w.length > 0);
      for (let i = 0; i + RUN <= words.length; i++) {
        const gram = words.slice(i, i + RUN).join(' ');
        const passage = grams.get(gram);
        if (!passage) continue;
        copiedRuns++;
        issues.push({
          checkId: 'E8',
          severity: 'blocking',
          sectionId: section.id,
          sentence: plain,
          explanation: `Twelve or more consecutive words match passage ${passage.id} word for word.`,
          suggestedFix: 'Paraphrase the sentence in the thesis’s own words and keep the citation.',
        });
        break;
      }
    }
  }
  return { issues, copiedRuns, checkedWords };
}

/**
 * E9: in a Results chapter every number traces to data. The data the build has is the passages
 * the section drew on (the student's uploaded files and library); a number in none of them is
 * flagged, one per sentence.
 */
export function checkFabricatedData(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('E9')) return [];
  const issues: RawIssue[] = [];
  for (const section of ctx.sections) {
    if (!section.dataOnly) continue;
    const known = new Set<string>();
    for (const passage of ctx.passages.get(section.id) ?? []) {
      for (const n of numbersIn(passage.text)) known.add(n);
    }
    for (const sentence of sentencesOf(section.markdown)) {
      const plain = stripCites(sentence);
      const missing = numbersIn(plain).filter((n) => !known.has(n));
      if (missing.length === 0) continue;
      issues.push({
        checkId: 'E9',
        severity: 'blocking',
        sectionId: section.id,
        sentence: plain,
        explanation: `The number ${missing[0]} does not appear in any data or source the section was given. A Results chapter reports only the student's own data.`,
        suggestedFix:
          'Replace it with the value from the data file, or with [[DATA NEEDED: …]] until the data are uploaded.',
      });
    }
  }
  return issues;
}
