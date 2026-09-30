/**
 * S5 and the discipline checks that can be read off the text — spec §7.1 S5, §7.2 D-MED2,
 * D-MGT2, D-LAW1. Each is a floor the examiner builds on: the code catches the unmistakable
 * cases, the examiner (with the profile's focus list) judges the rest.
 */

import { containsTerm, normalise, sentencesOf, stripCites } from './text.js';
import type { CheckContext, RawIssue } from './types.js';
import { CHAPTER_LEVEL } from './types.js';

const TRACED_ROLES = new Set(['LITERATURE', 'RESULTS', 'DISCUSSION', 'CONCLUSION']);

/**
 * S5: every objective is traced in the chapter — named as "objective n", or most of its content
 * words appear together in one section (the gap it addresses, the result that answers it, the
 * finding that closes it). At the thesis level the spec calls this blocking; on one chapter it is
 * a warning, because the trace may live in a chapter not yet built.
 */
export function checkObjectiveTraceability(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('S5') || !TRACED_ROLES.has(ctx.chapterRole)) return [];
  if (ctx.objectives.length === 0) return [];
  const sectionTexts = ctx.sections.map((s) => normalise(stripCites(s.markdown)));
  const chapter = sectionTexts.join(' ');
  const issues: RawIssue[] = [];
  ctx.objectives.forEach((objective, i) => {
    const n = i + 1;
    if (new RegExp(`\\bobjective\\s+${n}\\b`).test(chapter)) return;
    const words = normalise(objective)
      .split(' ')
      .filter((w) => w.length > 3 && !STOP.has(w));
    if (words.length === 0) return;
    const traced = sectionTexts.some((text) => {
      const hits = words.filter((w) => ` ${text} `.includes(` ${w} `)).length;
      return hits / words.length >= 0.6;
    });
    if (traced) return;
    issues.push({
      checkId: 'S5',
      severity: 'warning',
      sectionId: CHAPTER_LEVEL,
      sentence: objective,
      explanation: `Objective ${n} is not traced in this chapter: no section names it or takes up its terms.`,
      suggestedFix:
        ctx.chapterRole === 'LITERATURE'
          ? `State the gap objective ${n} addresses and link it to the objective.`
          : `Report or interpret what was found for objective ${n}, naming it.`,
    });
  });
  return issues;
}

const STOP = new Set([
  'this',
  'that',
  'with',
  'from',
  'into',
  'through',
  'their',
  'these',
  'those',
  'study',
  'thesis',
  'research',
  'using',
  'based',
  'evaluate',
  'investigate',
  'analyse',
  'analyze',
  'develop',
  'determine',
  'examine',
  'assess',
  'compare',
  'effect',
  'effects',
]);

/** D-MGT2: a methodology in management or social science reports instrument reliability and validity. */
export function checkInstrumentEvidence(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('D-MGT2') || ctx.chapterRole !== 'METHOD') return [];
  const text = ctx.sections.map((s) => s.markdown).join('\n');
  const reliability =
    /\b(?:cronbach|alpha|reliab|composite reliability|test[\s-]retest|inter[\s-]rater)\b/i.test(
      text,
    );
  const validity =
    /\b(?:validity|confirmatory factor|exploratory factor|CFA|EFA|AVE|discriminant|convergent|content valid|face valid|pilot)\b/i.test(
      text,
    );
  const issues: RawIssue[] = [];
  if (!reliability) {
    issues.push({
      checkId: 'D-MGT2',
      severity: 'warning',
      sectionId: CHAPTER_LEVEL,
      sentence: '',
      explanation:
        'The methodology does not report the instrument’s reliability (for example Cronbach’s alpha).',
      suggestedFix:
        'Report the reliability statistic for each scale, with the sample it was computed on.',
    });
  }
  if (!validity) {
    issues.push({
      checkId: 'D-MGT2',
      severity: 'warning',
      sectionId: CHAPTER_LEVEL,
      sentence: '',
      explanation: 'The methodology does not report how the instrument’s validity was established.',
      suggestedFix:
        'Say how content, construct or criterion validity was established (expert review, pilot, factor analysis).',
    });
  }
  return issues;
}

const DOSE =
  /(\d+(?:\.\d+)?)\s?(mg|g|mcg|µg|μg|IU|units?)\s?(\/\s?(?:kg|day|d|h|hr|week|wk|m2|m²))?(?:\s?\/\s?(?:day|d|h|hr))?/g;

/**
 * D-MED2: doses that cannot be right. Only the unmistakable: more than 100 mg/kg or 10 g/kg of
 * anything, a single dose over 20 g, or a microgram figure over 100 000. Drug names need a
 * reference the product does not hold; the examiner judges those.
 */
export function checkDoses(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('D-MED2')) return [];
  const issues: RawIssue[] = [];
  for (const section of ctx.sections) {
    for (const raw of sentencesOf(section.markdown)) {
      const sentence = stripCites(raw);
      for (const match of sentence.matchAll(DOSE)) {
        const value = Number(match[1]);
        const unit = (match[2] as string).replace('μ', 'µ');
        const per = (match[3] ?? '').replace(/\s/g, '');
        const perKg = /\/kg/.test(per);
        let bad: string | null = null;
        if (perKg && unit === 'mg' && value > 100) bad = 'more than 100 mg/kg';
        if (perKg && unit === 'g' && value > 10) bad = 'more than 10 g/kg';
        if (!perKg && unit === 'g' && value > 20) bad = 'a single dose over 20 g';
        if ((unit === 'mcg' || unit === 'µg') && value > 100_000) bad = 'over 100 000 µg';
        if (!bad) continue;
        issues.push({
          checkId: 'D-MED2',
          severity: 'blocking',
          sectionId: section.id,
          sentence,
          explanation: `“${match[0].trim()}” is ${bad}, outside any plausible dose.`,
          suggestedFix: 'Check the dose and its unit against the cited source or the formulary.',
        });
      }
    }
  }
  return issues;
}

const CASE_NAME =
  /\b[A-Z][A-Za-z.&'’-]+(?:\s+[A-Z][A-Za-z.&'’-]+){0,4}\s+v\.?\s+[A-Z][A-Za-z.&'’-]+/;
const REPORTER =
  /\b(?:AIR|SCC|SCR|SCALE|Cri\s?LJ|WLR|All\s?ER|UKSC|UKHL|EWCA|EWHC|US|S\.?\s?Ct\.?|F\.\d?d|HCA|CLR)\b/;

/**
 * D-LAW1: a case named in the text carries a year or a reporter citation, and two jurisdictions
 * are not mixed without a comparative framing.
 */
export function checkLegalCitations(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('D-LAW1')) return [];
  const issues: RawIssue[] = [];
  for (const section of ctx.sections) {
    for (const raw of sentencesOf(section.markdown)) {
      const sentence = stripCites(raw);
      const named = CASE_NAME.exec(sentence);
      if (!named) continue;
      if (/\b(?:1[89]|20)\d{2}\b/.test(sentence) || REPORTER.test(sentence)) continue;
      issues.push({
        checkId: 'D-LAW1',
        severity: 'blocking',
        sectionId: section.id,
        sentence,
        explanation: `The case “${named[0]}” is cited without a year or a reporter reference, so it cannot be verified.`,
        suggestedFix: 'Give the case in the university’s style: parties, year, reporter, court.',
      });
    }
  }
  const jurisdictions = ctx.entities.filter((e) => e.type === 'JURISDICTION');
  if (jurisdictions.length >= 2) {
    const text = ctx.sections.map((s) => s.markdown).join('\n');
    const framed = /\bcompar(?:e|ed|ison|ative)\b/i.test(text);
    const mentioned = jurisdictions.filter((j) =>
      [j.text, ...j.aliases].some((f) => containsTerm(text, f)),
    );
    if (!framed && mentioned.length >= 2) {
      issues.push({
        checkId: 'D-LAW1',
        severity: 'warning',
        sectionId: CHAPTER_LEVEL,
        sentence: '',
        explanation: `The chapter discusses ${mentioned.map((j) => j.text).join(' and ')} without saying it is comparing them.`,
        suggestedFix:
          'State the comparative framing: which jurisdiction is primary, and why the other is brought in.',
      });
    }
  }
  return issues;
}
