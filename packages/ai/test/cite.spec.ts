/**
 * Citation suggestion — PRD A.3, FR-4.5, PHASES 3.6.
 *
 *   "Done when: unit tests for the heuristic (10 positive, 10 negative sentences)."
 *
 * The heuristic guards a metered call. A false positive spends one of the student's 10–30 monthly
 * CITE units and interrupts their typing; a false negative costs nothing, because they can still
 * ask for a citation by hand. So the negatives below matter more than the positives.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCiteRequest,
  CITE,
  citeResultSchema,
  citeUserMessage,
  detectClaim,
  endsSentence,
  lastCompleteSentence,
  mockCiteResponse,
  usableCandidates,
} from '../src/builder/cite.js';
import { buildMemoryBlock } from '../src/builder/memory.js';
import { fixtureMemory } from './_memory-fixture.js';

const CLAIMS = [
  'Upfront cost was reported by 78% of households as the main barrier.',
  'Studies show that awareness campaigns had little effect on adoption.',
  'It has been demonstrated that grid distance dominates siting decisions.',
  'According to the national survey, uptake tripled between 2015 and 2019.',
  'Rooftop installations are more likely to be abandoned in rented housing.',
  'Subsidy uptake was significantly lower among tenant households.',
  'Adoption rates were higher than in comparable districts of Kerala.',
  'The main barrier reported in the literature is the initial capital outlay.',
  'Lower income was associated with a longer payback expectation.',
  'Prior work found that 312 households cited cost ahead of awareness.',
];

const NOT_CLAIMS = [
  'This section examines cost-related barriers before turning to policy.',
  'The following chapter sets out the survey design.',
  'I will argue that the subsidy is mistargeted.',
  'We surveyed three districts.',
  'Cost matters.',
  'The questionnaire had two parts.',
  'Section 3 describes the sample.',
  'This thesis is organised as follows.',
  'The remainder of the chapter turns to policy responses.',
  'These are the four themes that emerged.',
];

describe('detectClaim (FR-4.5 heuristic)', () => {
  it.each(CLAIMS)('treats as a claim: %s', (sentence) => {
    const verdict = detectClaim(sentence);
    expect(verdict.isClaim, sentence).toBe(true);
    expect(verdict.reasons.length).toBeGreaterThan(0);
  });

  it.each(NOT_CLAIMS)('does not fire on: %s', (sentence) => {
    expect(detectClaim(sentence).isClaim, sentence).toBe(false);
  });

  it('never fires on a structural sentence, even one full of numbers', () => {
    // A.1 tells the model to write exactly this kind of sentence when it has nothing to cite.
    // Offering a citation for it would be nonsense.
    expect(detectClaim('This section examines the 78% figure reported in Chapter 2.').isClaim).toBe(
      false,
    );
  });

  it('ignores a fragment that is too short to be a claim', () => {
    expect(detectClaim('Cost was 78%.').isClaim).toBe(false);
    expect(detectClaim('   ').isClaim).toBe(false);
  });

  it.each([
    'Studies have shown that awareness campaigns had little effect on adoption.',
    'Several studies have found that tenants adopt rooftop solar later.',
    'Earlier research has demonstrated that subsidies change siting decisions.',
    'Studies showed that awareness campaigns had little effect on adoption.',
    'Studies found that awareness campaigns had little effect on adoption.',
    'Researchers found that tenants rarely installed panels themselves.',
    'Studies have consistently reported a gap between intention and uptake.',
    'Recent research has shown a gap between intention and uptake.',
  ])('treats a perfect or past attribution as a claim: %s', (sentence) => {
    expect(detectClaim(sentence).reasons, sentence).toContain('attribution');
  });

  it.each([
    'We found that the interviews were shorter in the second round.',
    'Participants reported feeling rushed during the interview.',
    'The teachers showed great patience in every session.',
    'Our research found that tenants waited for the landlord.',
    'This research has shown the value of a pilot round.',
    'The village elders have shown us their records.',
  ])('does not take the student’s own finding for a claim: %s', (sentence) => {
    expect(detectClaim(sentence).isClaim, sentence).toBe(false);
  });

  it('names why it fired, for the log', () => {
    expect(detectClaim('Studies show adoption rose by 40% after 2015.').reasons).toEqual(
      expect.arrayContaining(['figure', 'attribution']),
    );
  });
});

describe('sentence boundaries (FR-4.5: at most once per sentence end)', () => {
  it('only recognises a finished sentence', () => {
    expect(endsSentence('Cost was the main barrier.')).toBe(true);
    expect(endsSentence('Cost was the main barrier. ')).toBe(true);
    expect(endsSentence('Cost was the main')).toBe(false);
  });

  it('returns the last finished sentence, not the whole paragraph', () => {
    expect(lastCompleteSentence('We surveyed 312 homes. Upfront cost was the main barrier.')).toBe(
      'Upfront cost was the main barrier.',
    );
  });

  it('returns nothing mid-sentence', () => {
    expect(lastCompleteSentence('Upfront cost was the')).toBeNull();
  });
});

describe('the A.3 request', () => {
  const passages = [
    { id: 'S1#c1', shortRef: 'Kumar 2021', page: 7, text: 'Upfront cost was the main barrier.' },
    { id: 'S2#c1', shortRef: 'Rao 2019', page: null, text: 'Siting followed grid distance.' },
  ];

  it('carries the sentence and every passage id', () => {
    const message = citeUserMessage('Cost was the main barrier.', passages);
    expect(message).toContain('<sentence>Cost was the main barrier.</sentence>');
    expect(message).toContain('<passage id="S1#c1" source="Kumar 2021" page="7">');
    expect(message).toContain('<passage id="S2#c1" source="Rao 2019" page="">');
  });

  it('uses A.3’s parameters and the same cached prefix as Assist', () => {
    const memory = buildMemoryBlock(fixtureMemory).text;
    const request = buildCiteRequest({
      memoryBlock: memory,
      sentence: 'Cost was the main barrier.',
      passages,
      userId: 'u',
      documentId: 'd',
    });
    expect(request.tier).toBe('fast');
    expect(request.maxTokens).toBe(200);
    expect(request.temperature).toBe(0);
    expect(request.action).toBe('CITE');
    // Sharing the prefix is what lets a CITE call reuse the block Assist already warmed (§10.3).
    expect(request.system.cached).toContain('<document_memory>');
  });
});

describe('usableCandidates (A.3: direct first, max 3, drop none)', () => {
  const ids = ['S1#c1', 'S2#c1', 'S3#c1', 'S4#c1'];

  it('drops "none", orders direct first and caps at three', () => {
    const { candidates } = usableCandidates(
      citeResultSchema.parse({
        candidates: [
          { id: 'S2#c1', support: 'partial', why: 'weaker version' },
          { id: 'S3#c1', support: 'none', why: 'unrelated' },
          { id: 'S1#c1', support: 'direct', why: 'states the claim' },
          { id: 'S4#c1', support: 'partial', why: 'part of it' },
        ],
      }),
      ids,
    );
    expect(candidates.map((c) => c.id)).toEqual(['S1#c1', 'S2#c1', 'S4#c1']);
    expect(candidates).toHaveLength(CITE.maxCandidates);
  });

  it('drops an id the model invented, and counts it', () => {
    const { candidates, hallucinated } = usableCandidates(
      citeResultSchema.parse({
        candidates: [
          { id: 'S9#c9', support: 'direct', why: 'invented' },
          { id: 'S1#c1', support: 'direct', why: 'real' },
        ],
      }),
      ids,
    );
    expect(candidates.map((c) => c.id)).toEqual(['S1#c1']);
    expect(hallucinated).toEqual(['S9#c9']);
  });

  it('offers nothing when no passage supports the sentence', () => {
    const { candidates } = usableCandidates(
      citeResultSchema.parse({
        candidates: ids.map((id) => ({ id, support: 'none', why: 'no support' })),
      }),
      ids,
    );
    // Silence is the right answer here; a forced suggestion would be a citation to nothing.
    expect(candidates).toEqual([]);
  });
});

describe('mockCiteResponse', () => {
  it('answers from the passages in its own prompt, in A.3’s shape', () => {
    const result = mockCiteResponse({
      tier: 'fast',
      system: { cached: '' },
      messages: [
        {
          role: 'user',
          content: '<passage id="S1#c1" ...>a</passage><passage id="S2#c1" ...>b</passage>',
        },
      ],
      maxTokens: 200,
      action: 'CITE',
      userId: 'u',
    });
    expect(citeResultSchema.safeParse(result).success).toBe(true);
    expect(result.candidates.map((c) => c.id)).toEqual(['S1#c1', 'S2#c1']);
    expect(result.candidates[0]?.support).toBe('direct');
  });
});

describe('a changed figure is not direct support (prompt evaluation, 2026-09-30)', () => {
  const passage = {
    id: 'S1#c1',
    text: 'Using data collected from 49 members of a rural social enterprise, grain size was 0.31 μm.',
  };
  const direct = { candidates: [{ id: 'S1#c1', support: 'direct' as const, why: '' }] };

  it('shows the passage as partial when the sentence gives a figure the passage does not', () => {
    const { candidates } = usableCandidates(direct, ['S1#c1'], {
      sentence: 'Data were collected from 154 members of a rural social enterprise.',
      passages: [passage],
    });
    expect(candidates[0]?.support).toBe('partial');
  });

  it('keeps direct when every figure matches, and ignores years', () => {
    const { candidates } = usableCandidates(direct, ['S1#c1'], {
      sentence: 'A 2021 study of 49 members found a grain size of 0.31 μm.',
      passages: [passage],
    });
    expect(candidates[0]?.support).toBe('direct');
  });
});
