/**
 * Language and mechanics — spec §7.1 L3, L4, L9. L1, L2, L7 and L8 are corrected by the
 * assembler (`assemble.ts`) and reported as counts; L5 (tense) and L6 (grammar) are the
 * examiner's and the proofreader's.
 */

import { SPELLING_PAIRS } from '@tc/config';
import { normalise, plainDigits, sentencesOf, stripCites } from './text.js';
import type { CheckContext, RawIssue } from './types.js';

/** Units and notation that look like abbreviations and are not (check L3). */
const UNIT_LIKE = new Set([
  'GPA',
  'MPA',
  'KPA',
  'PA',
  'HV',
  'HRC',
  'HRB',
  'HB',
  'RPM',
  'KN',
  'KJ',
  'KW',
  'MW',
  'HZ',
  'KHZ',
  'MHZ',
  'GHZ',
  'MM',
  'CM',
  'KM',
  'NM',
  'UM',
  'MG',
  'KG',
  'ML',
  'MOL',
  'MM',
  'II',
  'III',
  'IV',
  'VI',
  'VII',
  'VIII',
  'IX',
  'XI',
  'XII',
  'AC',
  'DC',
  'UV',
  'IR',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'RQ1',
  'RQ2',
  'RQ3',
  'RQ4',
]);

const ELEMENT_LIKE = /^(?:[A-Z][a-z]?\d*){1,4}$/;

/**
 * L3: an abbreviation (2–7 capitals, digits allowed) is defined where it is first used:
 * "Full Name (ABBR)" or "ABBR (Full Name)". Known ones — the profile's list, the front matter's
 * abbreviations table, the entities' aliases — are not asked for.
 */
export function checkAbbreviations(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('L3')) return [];
  const known = new Set<string>(
    [
      ...ctx.discipline.knownAbbreviations,
      ...ctx.knownAbbreviations,
      ...ctx.entities.flatMap((e) => [e.text, ...e.aliases]),
    ].map((a) => a.toUpperCase()),
  );
  const chapter = ctx.sections.map((s) => stripCites(s.markdown)).join('\n\n');
  const seen = new Set<string>();
  const issues: RawIssue[] = [];
  for (const match of chapter.matchAll(/\b([A-Z][A-Z0-9]{1,6})\b/g)) {
    const abbr = match[1] as string;
    if (seen.has(abbr)) continue;
    seen.add(abbr);
    if (known.has(abbr) || UNIT_LIKE.has(abbr)) continue;
    if (/^\d+$/.test(abbr) || !/[A-Z]{2}/.test(abbr)) continue;
    // A chemical formula (Al2O3, TiC, SiC) is not an abbreviation.
    if (/\d/.test(abbr) && ELEMENT_LIKE.test(abbr)) continue;
    const index = match.index ?? 0;
    const before = chapter.slice(Math.max(0, index - 1), index);
    const after = chapter.slice(index + abbr.length, index + abbr.length + 2);
    const defined = (before === '(' && after.startsWith(')')) || after.startsWith(' (');
    if (defined) continue;
    const section = ctx.sections.find((s) => stripCites(s.markdown).includes(abbr));
    const sentence = sentencesOf(section?.markdown ?? '').find((s) => stripCites(s).includes(abbr));
    issues.push({
      checkId: 'L3',
      severity: 'blocking',
      sectionId: section?.id ?? ctx.sections[0]?.id ?? 'chapter',
      sentence: sentence ? stripCites(sentence) : abbr,
      explanation: `“${abbr}” is used without being defined at first use.`,
      suggestedFix: `Write the full form followed by (${abbr}) the first time, then ${abbr} after that.`,
    });
  }
  return issues;
}

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * L4: one term for one thing. The discipline's terminology sheet names the preferred form and
 * the forms to avoid; the university's spelling variant adds the American/British pairs.
 */
export function checkTerminology(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('L4')) return [];
  const issues: RawIssue[] = [];
  for (const section of ctx.sections) {
    const sentences = sentencesOf(section.markdown).map(stripCites);
    for (const rule of ctx.discipline.terminology) {
      for (const avoid of rule.avoid) {
        const re = new RegExp(`\\b${escapeRe(avoid)}\\b`, 'i');
        const hit = sentences.find((s) => re.test(s));
        if (!hit) continue;
        // Only a mix is an inconsistency: the avoided form alone, used throughout, is a choice.
        const preferredUsed = ctx.sections.some((s) =>
          new RegExp(`\\b${escapeRe(rule.preferred)}\\b`, 'i').test(s.markdown),
        );
        issues.push({
          checkId: 'L4',
          severity: preferredUsed ? 'blocking' : 'warning',
          sectionId: section.id,
          sentence: hit,
          explanation: preferredUsed
            ? `“${avoid}” and “${rule.preferred}” are both used for the same thing.`
            : `“${avoid}” — the ${ctx.discipline.displayName} terminology sheet prefers “${rule.preferred}”.`,
          suggestedFix: `Use “${rule.preferred}” throughout.`,
        });
      }
    }
    const [wrongIndex, rightIndex] = ctx.university.spelling === 'british' ? [0, 1] : [1, 0];
    for (const pair of SPELLING_PAIRS) {
      const wrong = pair[wrongIndex] as string;
      const right = pair[rightIndex] as string;
      const re = new RegExp(`\\b${escapeRe(wrong)}\\b`, 'i');
      const hit = sentences.find((s) => re.test(s));
      if (!hit) continue;
      issues.push({
        checkId: 'L4',
        severity: 'warning',
        sectionId: section.id,
        sentence: hit,
        explanation: `“${wrong}” is ${ctx.university.spelling === 'british' ? 'American' : 'British'} spelling; the university profile asks for ${ctx.university.spelling} spelling.`,
        suggestedFix: `Write “${right}”.`,
      });
    }
  }
  return issues;
}

const COMPOUND_TAILS =
  /\b([a-z]{3,})(reinforced|assisted|induced|coated|treated|doped|enhanced|modified|oriented|dependent|controlled|driven|specific|related|scale|free)\b/g;
const PREFIXES = new Set([
  'non',
  'pre',
  'post',
  'semi',
  'multi',
  'anti',
  'self',
  'well',
  'co',
  're',
  'high',
  'low',
  'long',
  'short',
  'in',
  'on',
  'off',
  'two',
  'one',
  'three',
  'sub',
  'inter',
  'intra',
  'micro',
  'nano',
  'macro',
  'ultra',
  'over',
  'under',
  'cross',
  'half',
  'full',
  'wide',
  'near',
  'far',
  'top',
  'bottom',
  'step',
  'time',
  'cost',
  'wear',
  'heat',
  'load',
  'stress',
  'strain',
  'point',
  'fine',
  'coarse',
  'open',
  'closed',
  'single',
  'double',
  'so',
  'end',
  'user',
  'case',
  'data',
  'real',
  'large',
  'small',
  'state',
  'rule',
  'ready',
  'part',
  'first',
  'second',
  'third',
  'x',
  'e',
]);

/**
 * L9: hyphenation and extraction artefacts. Two signals: a compound tail run into the word before
 * it ("fiberreinforced"), and a hyphen splitting a word that appears whole elsewhere in the
 * chapter or its passages ("proper-ties" when "properties" occurs).
 */
export function checkArtefacts(ctx: CheckContext): RawIssue[] {
  if (!ctx.enabled.has('L9')) return [];
  const issues: RawIssue[] = [];
  const corpus = normalise(
    [
      ...ctx.sections.map((s) => s.markdown),
      ...[...ctx.passages.values()].flat().map((p) => p.text),
    ].join(' '),
  );
  const wordsSeen = new Set(corpus.split(' '));
  for (const section of ctx.sections) {
    for (const raw of sentencesOf(section.markdown)) {
      const sentence = stripCites(raw);
      for (const match of sentence.matchAll(COMPOUND_TAILS)) {
        const head = match[1] as string;
        const tail = match[2] as string;
        issues.push({
          checkId: 'L9',
          severity: 'warning',
          sectionId: section.id,
          sentence,
          explanation: `“${match[0]}” looks like two words run together.`,
          suggestedFix: `Write “${head}-${tail}”.`,
        });
      }
      for (const match of plainDigits(sentence).matchAll(/\b([a-z]{2,8})-([a-z]{2,6})\b/g)) {
        const a = match[1] as string;
        const b = match[2] as string;
        if (PREFIXES.has(a) || PREFIXES.has(b)) continue;
        const joined = `${a}${b}`;
        if (!wordsSeen.has(joined)) continue;
        issues.push({
          checkId: 'L9',
          severity: 'warning',
          sectionId: section.id,
          sentence,
          explanation: `“${match[0]}” looks like a line-break hyphen left in: “${joined}” appears elsewhere.`,
          suggestedFix: `Write “${joined}”.`,
        });
      }
    }
  }
  return issues;
}
