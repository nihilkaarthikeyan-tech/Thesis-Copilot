/**
 * Discipline checks in code — spec §7.2 D-CS1, D-MED1, D-MGT1, D-HUM1. D-MED2, D-MGT2 and D-LAW1
 * need judgement and are the examiner's, guided by the profile's focus list.
 */

import { containsTerm, HAS_CITE, sentencesOf, stripCites, wordCount } from './text.js';
import { CHAPTER_LEVEL, type CheckContext, type RawIssue } from './types.js';

const METRICS: ReadonlyArray<{ re: RegExp; name: string }> = [
  { re: /\bF1(?:[\s-]score)?\b/, name: 'F1' },
  { re: /\bmAP\b/, name: 'mAP' },
  { re: /\bBLEU\b/, name: 'BLEU' },
  { re: /\bROUGE\b/, name: 'ROUGE' },
  { re: /\bRMSE\b/, name: 'RMSE' },
  { re: /\bMAE\b/, name: 'MAE' },
  { re: /\bMAPE\b/, name: 'MAPE' },
  { re: /\bAUC\b|\bAUROC\b/, name: 'AUC' },
  { re: /\bIoU\b/, name: 'IoU' },
  { re: /\bperplexity\b/i, name: 'perplexity' },
  { re: /\bprecision\b/i, name: 'precision' },
  { re: /\brecall\b/i, name: 'recall' },
  { re: /\baccuracy\b/i, name: 'accuracy' },
  { re: /\bTHD\b/, name: 'THD' },
  { re: /\bSNR\b/, name: 'SNR' },
  { re: /\bBER\b/, name: 'BER' },
  { re: /\blatency\b/i, name: 'latency' },
  { re: /\bthroughput\b/i, name: 'throughput' },
];

const DEFINES =
  /\b(?:is|are)\s+(?:defined|computed|calculated|measured|given|expressed)\s+(?:as|by)\b|\bdenotes?\b|\brefers?\s+to\b|\bmeasures?\s+the\b|\bthe\s+(?:ratio|fraction|proportion|number|share|percentage|harmonic\s+mean)\s+of\b|=/i;

/** D-CS1: a metric is defined at or before its first use. */
export function checkMetricsDefined(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('D-CS1')) return [];
  const issues: RawIssue[] = [];
  const all = ctx.sections.flatMap((s) =>
    sentencesOf(s.markdown).map((sentence) => ({
      sectionId: s.id,
      sentence: stripCites(sentence),
    })),
  );
  for (const metric of METRICS) {
    const first = all.findIndex((s) => metric.re.test(s.sentence));
    if (first === -1) continue;
    // Defined in the sentence itself, the one before, or the one after.
    const nearby = all.slice(Math.max(0, first - 1), first + 2).map((s) => s.sentence);
    if (nearby.some((s) => metric.re.test(s) && DEFINES.test(s))) continue;
    const at = all[first] as (typeof all)[number];
    issues.push({
      checkId: 'D-CS1',
      severity: 'warning',
      sectionId: at.sectionId,
      sentence: at.sentence,
      explanation: `The metric “${metric.name}” is used here without a definition.`,
      suggestedFix: `Define ${metric.name} (what it measures and how it is computed) before or at its first use.`,
    });
  }
  return issues;
}

const PICO: ReadonlyArray<{ types: readonly string[]; name: string }> = [
  { types: ['POPULATION'], name: 'the population' },
  { types: ['INTERVENTION', 'DRUG', 'FORMULATION'], name: 'the intervention' },
  { types: ['COMPARATOR'], name: 'the comparator' },
  { types: ['OUTCOME'], name: 'the outcome' },
];

/** D-MED1: PICO elements among the key terms; an ethics statement in a methodology chapter. */
export function checkPicoAndEthics(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('D-MED1')) return [];
  const issues: RawIssue[] = [];
  if (ctx.chapterRole === 'INTRODUCTION' || ctx.chapterRole === 'METHOD') {
    const types = new Set(ctx.entities.map((e) => e.type));
    for (const element of PICO) {
      if (element.types.some((t) => types.has(t))) continue;
      issues.push({
        checkId: 'D-MED1',
        severity: 'warning',
        sectionId: CHAPTER_LEVEL,
        sentence: '',
        explanation: `No key term names ${element.name} (PICO).`,
        suggestedFix: `State ${element.name} in the objectives or research question, so the chapter introduces it.`,
      });
    }
  }
  if (ctx.chapterRole === 'METHOD') {
    const text = ctx.sections.map((s) => s.markdown).join('\n');
    if (
      !/\b(?:ethic(?:s|al)|IRB|IEC|institutional (?:review|ethics) (?:board|committee)|informed consent)\b/i.test(
        text,
      )
    ) {
      issues.push({
        checkId: 'D-MED1',
        severity: 'blocking',
        sectionId: CHAPTER_LEVEL,
        sentence: '',
        explanation: 'The methodology has no ethics approval or consent statement.',
        suggestedFix:
          'Add the ethics committee, approval number and date, and how consent was taken.',
      });
    }
  }
  return issues;
}

const HYPOTHESIS =
  /\bH\s?\d+[a-z]?\s*[:.]|\bit\s+is\s+hypothesi[sz]ed\b|\bwe\s+hypothesi[sz]e\b|\bhypothesis\s+\d+\b|\bhypothesi[sz]es?\s+that\b/i;
const VARIABLE_TYPES = new Set([
  'CONSTRUCT',
  'VARIABLE_IV',
  'VARIABLE_DV',
  'MEDIATOR',
  'MODERATOR',
]);

/** D-MGT1: every hypothesis names at least one defined variable or construct. */
export function checkHypothesisVariables(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('D-MGT1')) return [];
  const variables = ctx.entities.filter((e) => VARIABLE_TYPES.has(e.type));
  if (variables.length === 0) return [];
  const issues: RawIssue[] = [];
  for (const section of ctx.sections) {
    for (const raw of sentencesOf(section.markdown)) {
      const sentence = stripCites(raw);
      if (!HYPOTHESIS.test(sentence)) continue;
      const named = variables.some((v) =>
        [v.text, ...v.aliases].some((f) => containsTerm(sentence, f)),
      );
      if (named) continue;
      issues.push({
        checkId: 'D-MGT1',
        severity: 'blocking',
        sectionId: section.id,
        sentence,
        explanation:
          'This hypothesis names none of the variables or constructs the objectives define.',
        suggestedFix: `State the hypothesis in terms of the defined variables (${variables
          .slice(0, 4)
          .map((v) => v.text)
          .join(', ')}).`,
      });
    }
  }
  return issues;
}

/** D-HUM1: a quotation of eight or more words carries a citation; forty or more is too long. */
export function checkQuotations(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('D-HUM1')) return [];
  const issues: RawIssue[] = [];
  for (const section of ctx.sections) {
    for (const raw of sentencesOf(section.markdown)) {
      for (const match of raw.matchAll(/[“"]([^”"]{20,})[”"]/g)) {
        const quoted = match[1] as string;
        const words = wordCount(quoted);
        if (words < 8) continue;
        if (!HAS_CITE.test(raw)) {
          issues.push({
            checkId: 'D-HUM1',
            severity: 'blocking',
            sectionId: section.id,
            sentence: stripCites(raw),
            explanation: 'A quotation with no citation: the edition and page must be given.',
            suggestedFix: 'Cite the primary text with edition and page after the quotation.',
          });
        }
        if (words >= 40) {
          issues.push({
            checkId: 'D-HUM1',
            severity: 'warning',
            sectionId: section.id,
            sentence: stripCites(raw),
            explanation: `A quotation of ${words} words; the profile asks quotations to stay short.`,
            suggestedFix: 'Quote the phrase that carries the argument and paraphrase the rest.',
          });
        }
      }
    }
  }
  return issues;
}
