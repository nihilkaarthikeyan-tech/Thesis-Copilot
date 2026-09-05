/**
 * The prompt golden set runner — PRD Appendix C.5, PHASES 3.8.
 *
 * Two halves:
 *
 *  1. The judge, tested against hand-made outputs. Runs everywhere, no key needed.
 *  2. The real-provider run over `fixtures/prompts/*.json`. Nightly CI only: it costs money and a
 *     model's answer varies between runs, so it must never gate a pull request. Without
 *     `ANTHROPIC_API_KEY` it skips, and with no human-written scenarios it reports BLOCKED.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assistCachedBlock, assistUserMessage } from '../src/builder/assist.js';
import { buildMemoryBlock } from '../src/builder/memory.js';
import {
  countSentences,
  formatGoldenReport,
  type GoldenOutcome,
  type GoldenScenario,
  goldenScenarioSchema,
  judge,
} from '../src/golden.js';
import { fixtureMemory } from './_memory-fixture.js';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/prompts/', import.meta.url));

const scenario = (over: Partial<GoldenScenario> = {}): GoldenScenario =>
  goldenScenarioSchema.parse({
    name: 'test',
    chapter: { title: 'Literature review', scopeNote: 'Barriers to adoption.' },
    passages: [
      { id: 'S1#c1', shortRef: 'Kumar 2021', page: 7, text: 'Upfront cost was the main barrier.' },
      { id: 'S2#c1', shortRef: 'Rao 2019', page: 3, text: 'Siting was driven by grid distance.' },
    ],
    before: 'Prior studies found ',
    expect: { mustCiteAnyOf: ['S1#c1'], mustNotCite: ['S2#c1'] },
    ...over,
  });

describe('countSentences', () => {
  it('counts terminators followed by a space or the end', () => {
    expect(countSentences('One. Two.')).toBe(2);
    expect(countSentences('One. Two. Three.')).toBe(3);
    expect(countSentences('No terminator here')).toBe(1);
    expect(countSentences('   ')).toBe(0);
  });

  it('does not count a decimal point or a citation as a sentence end', () => {
    expect(countSentences('Rates fell to 3.5 per cent overall.')).toBe(1);
    expect(countSentences('Cost mattered {{cite:S1#c1}}. Then this.')).toBe(2);
  });
});

describe('judge (C.5 properties, not exact text)', () => {
  it('passes a good answer', () => {
    const outcome = judge(
      scenario(),
      'Upfront cost was the barrier households reported most often {{cite:S1#c1}}.',
    );
    expect(outcome.passed).toBe(true);
    expect(outcome.failures).toEqual([]);
  });

  it('fails an answer that cites nothing when a citation was required', () => {
    const outcome = judge(scenario(), 'Upfront cost was the barrier reported most often.');
    expect(outcome.passed).toBe(false);
    expect(outcome.failures[0]?.property).toBe('mustCiteAnyOf');
  });

  it('fails an answer that cites a passage which does not support the sentence', () => {
    // The most valuable kind of scenario: a plausible-looking passage that must not be used.
    const outcome = judge(scenario(), 'Cost was the main barrier {{cite:S2#c1}}.');
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.map((f) => f.property)).toContain('mustNotCite');
  });

  it('fails an answer containing a fabricated author or figure', () => {
    const outcome = judge(
      scenario({ expect: { ...scenario().expect, mustNotContain: ['Sharma', '78%'] } }),
      'According to Sharma et al., 78% of villages lacked awareness {{cite:S1#c1}}.',
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.failures.map((f) => f.property)).toContain('mustNotContain');
  });

  it('judges the post-processed text, because that is what the student sees', () => {
    // Three sentences and a hallucinated id: A.1 cuts and strips both, so this still passes.
    const outcome = judge(
      scenario(),
      'Cost was the main barrier {{cite:S1#c1}}. This section examines it. A third one {{cite:S9#c9}}.',
    );
    expect(outcome.passed).toBe(true);
    expect(outcome.output).not.toContain('A third one');
    expect(outcome.output).not.toContain('S9#c9');
  });

  it('treats an empty answer as correct only where the scenario allows it', () => {
    expect(judge(scenario(), '   ').passed).toBe(false);
    const allowed = scenario({
      expect: { ...scenario().expect, mustCiteAnyOf: [], allowEmpty: true },
    });
    expect(judge(allowed, '   ').passed).toBe(true);
  });
});

describe('formatGoldenReport', () => {
  it('reports one line per scenario and a total', () => {
    const outcomes: GoldenOutcome[] = [
      { name: 'a', passed: true, failures: [], output: 'x' },
      {
        name: 'bb',
        passed: false,
        failures: [{ property: 'maxSentences', detail: '3 sentences, expected at most 2' }],
        output: 'y',
      },
    ];
    const report = formatGoldenReport(outcomes);
    expect(report).toContain('pass');
    expect(report).toContain('FAIL  maxSentences: 3 sentences');
    expect(report).toContain('1/2 passed');
  });
});

/** Every hand-written scenario in `fixtures/prompts/`. Drafts are templates, not scenarios. */
function loadScenarios(): GoldenScenario[] {
  let names: string[];
  try {
    names = readdirSync(FIXTURES).filter((f) => f.endsWith('.json') && !f.endsWith('.draft.json'));
  } catch {
    return [];
  }
  return names.map((name) =>
    goldenScenarioSchema.parse(JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))),
  );
}

describe('the fixture directory', () => {
  it('has a draft template in the shape the runner expects', () => {
    // Proves the runner and the template agree, which is what the human will copy.
    const draft = JSON.parse(readFileSync(join(FIXTURES, 'example.draft.json'), 'utf8'));
    expect(goldenScenarioSchema.safeParse(draft).success).toBe(true);
  });

  it('builds a real A.1 prompt from a scenario', () => {
    const parsed = goldenScenarioSchema.parse(
      JSON.parse(readFileSync(join(FIXTURES, 'example.draft.json'), 'utf8')),
    );
    const memory = buildMemoryBlock(fixtureMemory).text;
    const user = assistUserMessage({
      memoryBlock: memory,
      chapter: parsed.chapter,
      passages: parsed.passages,
      before: parsed.before,
      after: parsed.after,
      instruction: parsed.instruction,
      userId: 'u',
      documentId: 'd',
    });
    expect(assistCachedBlock(memory)).toContain('<document_memory>');
    expect(user).toContain('<passage id="S1#c1"');
    expect(user).toContain('<instruction>none</instruction>');
  });
});

/**
 * The real run. Nightly only: `RUN_GOLDEN=1` plus a provider key. Reports per scenario and fails
 * on any property violation, which is the regression signal C.5 is for.
 */
const shouldRun = process.env.RUN_GOLDEN === '1' && Boolean(process.env.ANTHROPIC_API_KEY);

describe.skipIf(!shouldRun)('golden set against the real provider (nightly)', () => {
  it('every scenario satisfies its expected properties', async () => {
    const scenarios = loadScenarios();
    if (scenarios.length === 0) {
      // PHASES 3.8 allows BLOCKED while the human has not written the set.
      console.log('BLOCKED: fixtures/prompts has no human-written scenarios yet');
      return;
    }

    const { createProviders } = await import('../src/factory.js');
    const { loadEnv } = await import('@tc/config');
    const providers = createProviders(loadEnv());
    const memory = buildMemoryBlock(fixtureMemory).text;

    const outcomes: GoldenOutcome[] = [];
    for (const item of scenarios) {
      const { buildAssistRequest } = await import('../src/builder/assist.js');
      const request = buildAssistRequest({
        memoryBlock: memory,
        chapter: item.chapter,
        passages: item.passages,
        before: item.before,
        after: item.after,
        instruction: item.instruction,
        userId: 'golden',
        documentId: 'golden',
      });
      let text = '';
      for await (const chunk of providers.llm.stream(request)) {
        if (chunk.type === 'text') text += chunk.text;
      }
      outcomes.push(judge(item, text));
    }

    console.log(formatGoldenReport(outcomes));
    expect(outcomes.filter((o) => !o.passed)).toEqual([]);
  }, 300_000);
});
