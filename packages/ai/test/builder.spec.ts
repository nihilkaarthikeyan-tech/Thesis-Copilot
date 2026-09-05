/**
 * The prompt builder — PRD A.0, A.0.1, A.1, §10.3, FR-3.4 and PHASES 3.2.
 *
 *   "Snapshot tests: given a fixture memory + chapter state, the assembled prompt equals the
 *    stored snapshot; a second test proves that changing the outline changes the cached block
 *    (FR-3.4 AC)."
 *
 * The snapshot is the contract: every byte of the cached block is part of the provider's cache
 * key, so an accidental change here silently costs six times per Assist call (§11.2). A diff in
 * `__snapshots__` is a change a human should look at.
 */

import { describe, expect, it } from 'vitest';
import {
  ASSIST,
  assistCachedBlock,
  assistUserMessage,
  buildAssistRequest,
} from '../src/builder/assist.js';
import { buildMemoryBlock, MEMORY_BUDGET_TOKENS, renderOutline } from '../src/builder/memory.js';
import {
  cutAfterSecondSentence,
  postProcessAssist,
  removeLeadingOverlap,
  stripUnknownCitations,
} from '../src/builder/postprocess.js';
import { approxTokens, headByTokens, tailByTokens } from '../src/builder/tokens.js';
import { loadPrompt } from '../src/prompts.js';
import { renderTemplate } from '../src/template.js';
import { fixtureMemory, fixtureStyleProfile, outline } from './_memory-fixture.js';

describe('renderTemplate (the Appendix A dialect)', () => {
  it('fills simple and dotted paths', () => {
    expect(renderTemplate('Hi {{name}}, {{a.b.c}}.', { name: 'Asha', a: { b: { c: 'ok' } } })).toBe(
      'Hi Asha, ok.',
    );
  });

  it('iterates with {{this}} and with field access', () => {
    expect(renderTemplate('{{#each xs}}- {{this}}\n{{/each}}', { xs: ['a', 'b'] })).toBe(
      '- a\n- b\n',
    );
    expect(
      renderTemplate('{{#each rows}}{{term}}={{definition}};{{/each}}', {
        rows: [{ term: 't', definition: 'd' }],
      }),
    ).toBe('t=d;');
  });

  it('renders {{#if}} on truthiness, including empty arrays and nested blocks', () => {
    expect(renderTemplate('{{#if x}}yes{{/if}}', { x: 'v' })).toBe('yes');
    expect(renderTemplate('{{#if x}}yes{{/if}}', { x: null })).toBe('');
    expect(renderTemplate('{{#if x}}yes{{/if}}', { x: [] })).toBe('');
    expect(
      renderTemplate('{{#each rows}}{{term}}{{#if note}} ({{note}}){{/if}};{{/each}}', {
        rows: [{ term: 'a', note: 'n' }, { term: 'b' }],
      }),
    ).toBe('a (n);b;');
  });

  it('leaves {{cite:ID}} alone, because that is model output syntax', () => {
    expect(renderTemplate('cite with {{cite:ID}} after', {})).toBe('cite with {{cite:ID}} after');
  });

  it('drops <!-- comments -->, which instruct the builder rather than the model', () => {
    expect(renderTemplate('a{{x}}   <!-- note to builder -->\nb', { x: '1' })).toBe('a1\nb');
  });

  it('does not HTML-escape, so a student’s < survives into the prompt', () => {
    expect(renderTemplate('{{t}}', { t: 'x < 4% & y' })).toBe('x < 4% & y');
  });

  it('renders an unknown path as nothing rather than the placeholder', () => {
    expect(renderTemplate('[{{missing}}]', {})).toBe('[]');
  });
});

describe('token estimator (PHASES 3.2: a calibrated estimator, stated)', () => {
  it('is the ~4 characters per token PRD §11.1 assumes', () => {
    expect(approxTokens('a'.repeat(400))).toBe(100);
    expect(approxTokens('')).toBe(0);
  });

  it('keeps the tail of `before` and the head of `after`, at word boundaries', () => {
    const words = Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ');
    const tail = tailByTokens(words, 20);
    expect(tail.length).toBeLessThanOrEqual(80);
    expect(tail.endsWith('w199')).toBe(true);
    expect(tail.startsWith('w')).toBe(true);

    const head = headByTokens(words, 20);
    expect(head.length).toBeLessThanOrEqual(80);
    expect(head.startsWith('w0 ')).toBe(true);
    expect(/\s$/.test(head)).toBe(false);
  });
});

describe('renderOutline (A.0.1: current ± 1 in full, others as "N. Title")', () => {
  it('renders neighbours in full and the rest as titles', () => {
    const text = renderOutline(outline, '2-literature');
    expect(text).toMatchInlineSnapshot(`
      "1. Introduction
         Scope: Sets out why rooftop solar uptake in rural Karnataka remains low.
         1.1. Context
         1.2. The gap
      2. Literature review (current)
         Scope: What is known about household adoption barriers, and where the evidence thins out.
         2.1. Cost barriers
         2.2. Awareness and trust
      3. Method
         Scope: A structured questionnaire administered to 312 households across three districts.
      4. Findings
      5. Discussion"
    `);
  });

  it('finds the current chapter when the id belongs to a subheading', () => {
    const text = renderOutline(outline, '2-1-cost');
    expect(text).toContain('2. Literature review (current)');
    expect(text).toContain('4. Findings\n5. Discussion');
  });

  it('collapses everything to titles when asked (trimming step 1)', () => {
    expect(renderOutline(outline, '2-literature', true)).toBe(
      '1. Introduction\n2. Literature review\n3. Method\n4. Findings\n5. Discussion',
    );
  });

  it('says so when there is no outline yet', () => {
    expect(renderOutline([], 'x')).toBe('(no outline yet)');
  });
});

describe('buildMemoryBlock (A.0.1)', () => {
  it('renders the fixture memory to the stored snapshot', () => {
    const block = buildMemoryBlock(fixtureMemory);
    expect(block.trimmed).toEqual([]);
    expect(block.overBudget).toBe(false);
    expect(block.text).toMatchSnapshot();
  });

  it('includes the style profile block when there is one, and omits it when there is not', () => {
    const without = buildMemoryBlock(fixtureMemory).text;
    expect(without).not.toContain('<style_profile>');

    const withProfile = buildMemoryBlock({
      ...fixtureMemory,
      styleProfile: fixtureStyleProfile,
    }).text;
    expect(withProfile).toContain('<style_profile>');
    expect(withProfile).toContain(
      'Typical sentence length: 21 words. Register: formal. Voice: passive.',
    );
    expect(withProfile).toContain(
      'Transitions the student uses: however, in contrast, this suggests.',
    );
    expect(withProfile).toMatchSnapshot();
  });

  it('is byte-stable: the same memory renders to the same bytes', () => {
    expect(buildMemoryBlock(fixtureMemory).text).toBe(buildMemoryBlock(fixtureMemory).text);
    // Glossary order is fixed regardless of insertion order, or the cache would miss at random.
    const reordered = {
      ...fixtureMemory,
      glossary: Object.fromEntries(Object.entries(fixtureMemory.glossary).reverse()),
    };
    expect(buildMemoryBlock(reordered).text).toBe(buildMemoryBlock(fixtureMemory).text);
  });

  it('carries no template syntax or builder comments into the prompt', () => {
    const text = buildMemoryBlock(fixtureMemory).text;
    expect(text).not.toMatch(/\{\{|\}\}/);
    expect(text).not.toContain('<!--');
  });

  it('fits the fixture well inside A.0.1’s 3,200-token ceiling', () => {
    const block = buildMemoryBlock(fixtureMemory);
    expect(block.tokens).toBeLessThan(MEMORY_BUDGET_TOKENS);
    // The number goes in the log (PHASES 3.2 done-when).
    expect(block.tokens).toBeGreaterThan(100);
  });

  describe('trimming, in A.0.1’s order', () => {
    const bloated = (): typeof fixtureMemory => ({
      ...fixtureMemory,
      // Twenty chapters with long scope notes, and a large glossary mostly unused by the chapter.
      outline: Array.from({ length: 20 }, (_, i) => ({
        id: `ch-${i}`,
        title: `Chapter ${i + 1}`,
        scopeNote: 'A long scope note about what this chapter covers in detail. '.repeat(8),
        children: [],
      })),
      glossary: Object.fromEntries(
        Array.from({ length: 80 }, (_, i) => [
          i < 2 ? ['Adoption', 'Barrier'][i] : `Term ${i}`,
          { definition: 'A definition long enough to matter for the budget. '.repeat(3) },
        ]),
      ),
      chapter: { outlineNodeId: 'ch-5', text: 'Adoption and the barrier are discussed here.' },
    });

    it('first collapses the outline to titles', () => {
      const block = buildMemoryBlock({ ...bloated(), budgetTokens: 2_600 });
      expect(block.trimmed[0]).toBe('outline-titles-only');
      expect(block.text).not.toContain('Scope:');
    });

    it('then drops glossary entries the chapter does not mention, keeping the ones it does', () => {
      const block = buildMemoryBlock({ ...bloated(), budgetTokens: 900 });
      expect(block.trimmed).toContain('glossary-unused-entries');
      expect(block.text).toContain('- Adoption:');
      expect(block.text).toContain('- Barrier:');
      expect(block.text).not.toContain('Term 40');
      expect(block.overBudget).toBe(false);
    });

    it('reports when every step ran and the block is still over budget', () => {
      const block = buildMemoryBlock({ ...bloated(), budgetTokens: 50 });
      expect(block.trimmed).toEqual([
        'outline-titles-only',
        'glossary-unused-entries',
        'style-profile-samples',
      ]);
      expect(block.overBudget).toBe(true);
    });

    it('does not trim at all when the block already fits', () => {
      const block = buildMemoryBlock(fixtureMemory);
      expect(block.trimmed).toEqual([]);
      expect(block.text).toContain('Scope:');
      expect(block.text).toContain('- Net metering:');
    });
  });
});

describe('the cached block (§10.3, FR-3.4)', () => {
  const memory = buildMemoryBlock(fixtureMemory).text;

  it('is A.0, then A.0.1, then A.1’s task block, verbatim', () => {
    const cached = assistCachedBlock(memory);
    const preamble = loadPrompt('_preamble').system.trim();
    const task = loadPrompt('assist').system.trim();

    expect(cached.startsWith(preamble)).toBe(true);
    expect(cached.endsWith(task)).toBe(true);
    expect(cached).toContain(memory);
    expect(cached.indexOf(preamble)).toBeLessThan(cached.indexOf('<document_memory>'));
    expect(cached.indexOf('<document_memory>')).toBeLessThan(cached.indexOf(task));
  });

  it('matches the stored snapshot', () => {
    expect(assistCachedBlock(memory)).toMatchSnapshot();
  });

  it('fits §10.3’s 4,000-token budget for the fixture', () => {
    expect(approxTokens(assistCachedBlock(memory))).toBeLessThan(4_000);
  });

  it('FR-3.4 AC: an outline edit changes the cached block', () => {
    const before = assistCachedBlock(buildMemoryBlock(fixtureMemory).text);
    const edited = {
      ...fixtureMemory,
      outline: fixtureMemory.outline.map((chapter) =>
        chapter.id === '2-literature' ? { ...chapter, title: 'Prior work' } : chapter,
      ),
    };
    const after = assistCachedBlock(buildMemoryBlock(edited).text);

    expect(after).not.toBe(before);
    expect(after).toContain('2. Prior work (current)');
    expect(before).toContain('2. Literature review (current)');
  });

  it('is untouched by anything volatile', () => {
    // Different cursor text, passages and instruction: same cached bytes, so the cache can hit.
    const a = buildAssistRequest({
      memoryBlock: memory,
      chapter: { title: 'Literature review', scopeNote: 'x' },
      passages: [],
      before: 'One thing.',
      after: '',
      userId: 'u',
      documentId: 'd',
    });
    const b = buildAssistRequest({
      memoryBlock: memory,
      chapter: { title: 'Method', scopeNote: 'y' },
      passages: [{ id: 'S1#c1', shortRef: 'Kumar 2021', page: 3, text: 'A passage.' }],
      before: 'Another thing entirely.',
      after: 'and more',
      instruction: 'mention cost barriers',
      userId: 'u',
      documentId: 'd',
    });
    expect(a.system.cached).toBe(b.system.cached);
    expect(a.messages[0]?.content).not.toBe(b.messages[0]?.content);
  });
});

describe('the Assist user message (A.1, FR-4.3)', () => {
  const base = {
    memoryBlock: buildMemoryBlock(fixtureMemory).text,
    chapter: { title: 'Literature review', scopeNote: 'What is known about barriers.' },
    passages: [
      {
        id: 'S4#c2',
        shortRef: 'Kumar 2021',
        page: 7,
        text: 'A 2021 survey of 312 rural households found upfront cost the main barrier.',
      },
      { id: 'S9#c1', shortRef: 'Rao 2019', page: null, text: 'Awareness was rarely mentioned.' },
    ],
    before: 'Prior studies in Karnataka found ',
    after: '',
    userId: 'user-1',
    documentId: 'doc-1',
  };

  it('renders A.1’s template with the passages and their ids', () => {
    const message = assistUserMessage(base);
    expect(message).toMatchSnapshot();
    expect(message).toContain('<passage id="S4#c2" source="Kumar 2021" page="7">');
    expect(message).toContain('<passage id="S9#c1" source="Rao 2019" page="">');
    expect(message).toContain('<instruction>none</instruction>');
  });

  it('passes the guided instruction through', () => {
    expect(assistUserMessage({ ...base, instruction: '  mention cost barriers ' })).toContain(
      '<instruction>mention cost barriers</instruction>',
    );
  });

  it('cuts `before` to ~1,200 tokens from the end and `after` to ~300 from the start', () => {
    const long = Array.from({ length: 3_000 }, (_, i) => `w${i}`).join(' ');
    const message = assistUserMessage({ ...base, before: long, after: long });
    const before = /<text_before>([\s\S]*?)<\/text_before>/.exec(message)?.[1] ?? '';
    const after = /<text_after>([\s\S]*?)<\/text_after>/.exec(message)?.[1] ?? '';
    expect(approxTokens(before)).toBeLessThanOrEqual(ASSIST.beforeTokens);
    expect(approxTokens(after)).toBeLessThanOrEqual(ASSIST.afterTokens);
    expect(before.endsWith('w2999')).toBe(true);
    expect(after.startsWith('w0 ')).toBe(true);
  });

  it('sets A.1’s parameters on the request', () => {
    const request = buildAssistRequest(base);
    expect(request.tier).toBe('fast');
    expect(request.maxTokens).toBe(120);
    expect(request.temperature).toBe(0.4);
    expect(request.action).toBe('ASSIST');
    expect(request.messages).toHaveLength(1);
  });
});

describe('A.1 post-processing, in order', () => {
  const passageIds = ['S4#c2', 'S9#c1'];

  it('(1) strips a citation that was not in the prompt and counts it', () => {
    const result = stripUnknownCitations(
      'Cost was the main barrier {{cite:S4#c2}}. Villages lacked awareness {{cite:S7#c3}}.',
      passageIds,
    );
    expect(result.text).toBe(
      'Cost was the main barrier {{cite:S4#c2}}. Villages lacked awareness.',
    );
    expect(result.hallucinated).toEqual(['S7#c3']);
    expect(result.cited).toEqual(['S4#c2']);
  });

  it('(2) removes a restated run of six or more words, and leaves shorter ones alone', () => {
    const before = 'Prior studies in the region of Karnataka found that upfront';
    expect(
      removeLeadingOverlap('region of Karnataka found that upfront cost mattered most.', before),
    ).toEqual({ text: 'cost mattered most.', removed: true });
    expect(removeLeadingOverlap('that upfront cost mattered most.', before).removed).toBe(false);
  });

  it('(3) cuts after the second sentence, never inside a citation', () => {
    expect(
      cutAfterSecondSentence(
        'First sentence {{cite:S4#c2}}. Second one ends here. Third should go.',
      ),
    ).toEqual({ text: 'First sentence {{cite:S4#c2}}. Second one ends here.', truncated: true });

    // A citation after the terminator belongs to the sentence it follows.
    expect(cutAfterSecondSentence('One. Two. {{cite:S9#c1}} Three.').text).toBe(
      'One. Two. {{cite:S9#c1}}',
    );

    // "e.g." style dots followed by a non-space are not terminators.
    expect(cutAfterSecondSentence('Rates fell to 3.5 per cent. Then rose. And more.').text).toBe(
      'Rates fell to 3.5 per cent. Then rose.',
    );
  });

  it('(4) returns empty for whitespace, and for an output that was only a bad citation', () => {
    expect(postProcessAssist({ output: '   \n', passageIds, before: '' }).empty).toBe(true);
    const onlyBad = postProcessAssist({ output: ' {{cite:S1#c9}} ', passageIds, before: '' });
    expect(onlyBad.empty).toBe(true);
    expect(onlyBad.hallucinated).toEqual(['S1#c9']);
  });

  it('runs the steps in A.1’s order on the good example', () => {
    const result = postProcessAssist({
      output:
        'Evidence from rural Karnataka shows that upfront cost, not awareness, was the main barrier reported by households {{cite:S4#c2}}. This section therefore examines cost-related barriers before turning to policy responses. A third sentence that A.1 forbids.',
      passageIds,
      before: 'Prior studies in Karnataka found ',
    });
    expect(result.text).toBe(
      'Evidence from rural Karnataka shows that upfront cost, not awareness, was the main barrier reported by households {{cite:S4#c2}}. This section therefore examines cost-related barriers before turning to policy responses.',
    );
    expect(result.truncated).toBe(true);
    expect(result.hallucinated).toEqual([]);
    expect(result.cited).toEqual(['S4#c2']);
    expect(result.empty).toBe(false);
  });

  it('never lets the bad example through with a citation attached', () => {
    // A.1's "bad output": a named author and a figure with no passage id at all.
    const result = postProcessAssist({
      output: 'According to Sharma et al. (2019), 78% of villages lacked awareness.',
      passageIds,
      before: '',
    });
    // The text survives (it is the model's job not to write it; §10.6 only whitelists ids), but
    // it carries no citation, which is what the editor's whitelist renders as uncited.
    expect(result.cited).toEqual([]);
    expect(result.hallucinated).toEqual([]);
  });
});
