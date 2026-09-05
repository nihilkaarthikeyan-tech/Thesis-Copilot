/**
 * The prompt golden set — PRD Appendix C.5, PHASES 3.8.
 *
 *   "Ten hand-written Assist scenarios (`before`, `after`, 3–6 passages, optional instruction)
 *    with the **expected properties** of a good output, not the exact text: max sentences,
 *    must-cite / must-not-cite passage ids, must-not-contain strings (e.g. a fabricated author
 *    name). The test runs against the real provider in CI's nightly job only."
 *
 * Properties rather than exact text, because a good model gives a different good answer each time.
 * A golden set that pinned the words would fail on every model update and teach us nothing about
 * whether the prompt still works.
 */

import { z } from 'zod';
import { postProcessAssist } from './builder/postprocess.js';

export const goldenPassageSchema = z.object({
  id: z.string().trim().min(1),
  shortRef: z.string().trim().min(1),
  page: z.number().int().nullable().default(null),
  text: z.string().trim().min(1),
});

export const goldenScenarioSchema = z.object({
  name: z.string().trim().min(1),
  /** Why this scenario exists — what regression it is watching for. */
  intent: z.string().trim().default(''),
  chapter: z.object({ title: z.string().trim(), scopeNote: z.string().trim().default('') }),
  passages: z.array(goldenPassageSchema).min(1).max(6),
  before: z.string().default(''),
  after: z.string().default(''),
  instruction: z.string().trim().nullable().default(null),
  expect: z.object({
    /** A.1's hard limit is two; a scenario may ask for fewer. */
    maxSentences: z.number().int().min(1).max(2).default(2),
    /** At least one of these must be cited. Empty means "no citation is required". */
    mustCiteAnyOf: z.array(z.string()).default([]),
    /** None of these may be cited, even though they were offered. */
    mustNotCite: z.array(z.string()).default([]),
    /** Case-insensitive substrings that must not appear: fabricated authors, invented figures. */
    mustNotContain: z.array(z.string()).default([]),
    /** An empty suggestion is a legitimate answer for some scenarios, and a failure for others. */
    allowEmpty: z.boolean().default(false),
  }),
});

export const goldenSetSchema = z.array(goldenScenarioSchema);

export type GoldenPassage = z.infer<typeof goldenPassageSchema>;
export type GoldenScenario = z.infer<typeof goldenScenarioSchema>;

export type GoldenFailure = {
  property: 'maxSentences' | 'mustCiteAnyOf' | 'mustNotCite' | 'mustNotContain' | 'allowEmpty';
  detail: string;
};

export type GoldenOutcome = {
  name: string;
  passed: boolean;
  failures: GoldenFailure[];
  /** The post-processed text that was judged, so a failing run is readable in CI. */
  output: string;
};

/** Counts sentences the way A.1's cut does: a terminator followed by whitespace or the end. */
export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  let count = 0;
  let i = 0;
  while (i < trimmed.length) {
    if (trimmed.startsWith('{{', i)) {
      const end = trimmed.indexOf('}}', i);
      i = end === -1 ? trimmed.length : end + 2;
      continue;
    }
    const char = trimmed[i] as string;
    if (char === '.' || char === '?' || char === '!') {
      let end = i + 1;
      while (end < trimmed.length && /[.!?"')\]]/.test(trimmed[end] as string)) end++;
      const rest = trimmed.slice(end);
      if (rest.length === 0 || /^\s/.test(rest)) {
        count++;
        i = end;
        continue;
      }
    }
    i++;
  }
  // Text that never terminates is still one sentence's worth of output.
  return count === 0 ? 1 : count;
}

/**
 * Judges one raw model output against a scenario. Post-processing runs first, because the student
 * never sees the raw output — A.1's steps are part of the product, and a prompt that leans on the
 * two-sentence cut is not thereby broken.
 */
export function judge(scenario: GoldenScenario, rawOutput: string): GoldenOutcome {
  const passageIds = scenario.passages.map((passage) => passage.id);
  const processed = postProcessAssist({
    output: rawOutput,
    passageIds,
    before: scenario.before,
  });

  const failures: GoldenFailure[] = [];

  if (processed.empty) {
    if (!scenario.expect.allowEmpty) {
      failures.push({ property: 'allowEmpty', detail: 'the suggestion was empty' });
    }
    return { name: scenario.name, passed: failures.length === 0, failures, output: '' };
  }

  const sentences = countSentences(processed.text);
  if (sentences > scenario.expect.maxSentences) {
    failures.push({
      property: 'maxSentences',
      detail: `${sentences} sentences, expected at most ${scenario.expect.maxSentences}`,
    });
  }

  const cited = new Set(processed.cited);
  if (
    scenario.expect.mustCiteAnyOf.length > 0 &&
    !scenario.expect.mustCiteAnyOf.some((id) => cited.has(id))
  ) {
    failures.push({
      property: 'mustCiteAnyOf',
      detail: `cited ${[...cited].join(', ') || 'nothing'}; expected one of ${scenario.expect.mustCiteAnyOf.join(', ')}`,
    });
  }

  const forbidden = scenario.expect.mustNotCite.filter((id) => cited.has(id));
  if (forbidden.length > 0) {
    failures.push({ property: 'mustNotCite', detail: `cited ${forbidden.join(', ')}` });
  }

  const lower = processed.text.toLowerCase();
  const found = scenario.expect.mustNotContain.filter((needle) =>
    lower.includes(needle.toLowerCase()),
  );
  if (found.length > 0) {
    failures.push({ property: 'mustNotContain', detail: `contains ${found.join(', ')}` });
  }

  return { name: scenario.name, passed: failures.length === 0, failures, output: processed.text };
}

/** A one-line-per-scenario report for the CI log. */
export function formatGoldenReport(outcomes: readonly GoldenOutcome[]): string {
  const width = Math.max(4, ...outcomes.map((o) => o.name.length));
  const lines = outcomes.map((outcome) => {
    const mark = outcome.passed ? 'pass' : 'FAIL';
    const why = outcome.failures.map((f) => `${f.property}: ${f.detail}`).join('; ');
    return `${outcome.name.padEnd(width)}  ${mark}${why ? `  ${why}` : ''}`;
  });
  const passed = outcomes.filter((o) => o.passed).length;
  lines.push(`${'TOTAL'.padEnd(width)}  ${passed}/${outcomes.length} passed`);
  return lines.join('\n');
}
