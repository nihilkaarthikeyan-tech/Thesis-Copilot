/**
 * The citation-support check — ADR-0023.
 *
 * The part that has to be right regardless of the model: a quote shown to a student as the
 * source's words must be the source's words, and the request must carry each sentence with only
 * its own passages. The mock is pinned too, because CI's browser tests run on it.
 */

import { describe, expect, it } from 'vitest';
import {
  buildSupportRequest,
  COHERENCE,
  mockCoherenceResponse,
  supportSchema,
  verbatimQuote,
} from '../src/builder/coherence.js';
import { loadPrompt } from '../src/prompts.js';

const PASSAGE =
  'Adoption rose by 14% in the two districts studied. Upfront cost may explain part of the gap, ' +
  'although the survey could not separate cost from access to credit.';

const item = (sentenceId: string, sentence: string, text = PASSAGE) => ({
  sentenceId,
  sentence,
  passages: [{ shortRef: 'Kumar 2021', page: 4, text }],
});

describe('the request', () => {
  const request = buildSupportRequest({
    items: [item('s1', 'Adoption rose by 14% (Kumar, 2021).')],
    userId: 'u',
    documentId: 'd',
  });

  it('is a Fast-tier coherence call on the support prompt', () => {
    expect(request.tier).toBe('fast');
    expect(request.action).toBe('COHERENCE');
    expect(request.system.cached).toContain(loadPrompt('coh_support').system);
  });

  it('carries each sentence with its own passages, named by source and page', () => {
    const user = request.messages[0]?.content ?? '';
    expect(user).toContain('<sentence id="s1">Adoption rose by 14% (Kumar, 2021).</sentence>');
    expect(user).toContain('<passage for="s1" source="Kumar 2021" page="4">');
  });

  it('never sends more than a batch', () => {
    const many = Array.from({ length: 25 }, (_, i) => item(`s${i}`, `Claim number ${i}.`));
    const user =
      buildSupportRequest({ items: many, userId: 'u', documentId: 'd' }).messages[0]?.content ?? '';
    expect(user.match(/<sentence /g)).toHaveLength(COHERENCE.supportBatch);
  });
});

describe('a quote', () => {
  const passages = [{ text: PASSAGE }];

  it('is kept when it is in the passage word for word, whitespace aside', () => {
    expect(verbatimQuote('Upfront cost may explain part of the gap', passages)).toBe(
      'Upfront cost may explain part of the gap',
    );
    expect(verbatimQuote('  "Upfront cost may\n explain part of the gap"  ', passages)).toBe(
      'Upfront cost may explain part of the gap',
    );
  });

  it('is dropped when it is a paraphrase in quotation marks', () => {
    expect(verbatimQuote('Cost explains most of the gap', passages)).toBeNull();
    expect(verbatimQuote('upfront cost may explain part of the gap', passages)).toBeNull();
  });

  it('is dropped when there is nothing to quote', () => {
    expect(verbatimQuote('', passages)).toBeNull();
    expect(verbatimQuote('the', passages)).toBeNull();
  });
});

describe('the mock, which CI runs on', () => {
  const answer = (items: ReturnType<typeof item>[]) =>
    supportSchema.parse(
      mockCoherenceResponse.respond(
        buildSupportRequest({ items, userId: 'u', documentId: 'd' }) as never,
      ),
    ).results;

  it('calls a different figure a misrepresentation, quoting the passage', () => {
    const [result] = answer([item('s1', 'Adoption rose by 40% in the districts studied.')]);
    expect(result?.verdict).toBe('MISREPRESENTED');
    expect(verbatimQuote(result?.quote ?? '', [{ text: PASSAGE }])).not.toBeNull();
  });

  it('calls certainty where the passage hedges an overstatement', () => {
    const [result] = answer([item('s1', 'Upfront cost always explains the adoption gap.')]);
    expect(result?.verdict).toBe('OVERSTATED');
    expect(result?.quote).toContain('may explain');
  });

  it('says a passage about something else does not address the claim', () => {
    const [result] = answer([item('s1', 'Monsoon variability governs groundwater recharge.')]);
    expect(result?.verdict).toBe('NOT_IN_PASSAGE');
  });

  it('passes a sentence its passage states', () => {
    const [result] = answer([item('s1', 'Adoption rose by 14% in the districts studied.')]);
    expect(result?.verdict).toBe('SUPPORTED');
  });
});
