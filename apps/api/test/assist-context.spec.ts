/**
 * Small pure pieces of the Assist pipeline (PHASES 3.2–3.4): the chapter-text extractor the
 * glossary trimming reads, and the request-aware mock reply that keeps E2E honest under the
 * §10.6 whitelist.
 */

import { type LlmRequest, postProcessAssist } from '@tc/ai';
import { describe, expect, it } from 'vitest';
import { MOCK_SUGGESTION, mockSuggestionFor } from '../src/modules/ai/ai.module.js';
import { docToText } from '../src/modules/assist/doc-text.js';

describe('docToText', () => {
  it('flattens a chapter to prose, one block per line', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Introduction' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Cost is the ' },
            { type: 'text', text: 'barrier', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' most often cited.' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Adoption' }] }],
            },
          ],
        },
      ],
    };
    expect(docToText(doc)).toBe('Introduction\nCost is the barrier most often cited.\nAdoption');
  });

  it('contributes nothing for a citation node or an image', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'A claim' },
            { type: 'citation', attrs: { key: 'S1#c1', sourceId: 'x', chunkId: 'y' } },
            { type: 'text', text: '.' },
          ],
        },
        { type: 'image', attrs: { src: 'data:…' } },
      ],
    };
    expect(docToText(doc)).toBe('A claim.');
  });

  it('is empty for nothing, garbage, or an empty document', () => {
    expect(docToText(null)).toBe('');
    expect(docToText('not a doc')).toBe('');
    expect(docToText({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe('');
  });

  it('turns a hard break into a line', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'one' },
            { type: 'hardBreak' },
            { type: 'text', text: 'two' },
          ],
        },
      ],
    };
    expect(docToText(doc)).toBe('one\ntwo');
  });
});

describe('mockSuggestionFor (the mock obeys A.0 rule 3)', () => {
  const request = (user: string): LlmRequest => ({
    tier: 'fast',
    system: { cached: '' },
    messages: [{ role: 'user', content: user }],
    maxTokens: 120,
    action: 'ASSIST',
    userId: 'u',
  });

  it('cites the first passage that is actually in the prompt, by its own id', () => {
    const text = mockSuggestionFor(
      request(
        '<passages>\n<passage id="S2#c1" source="Kumar 2021" page="3">x</passage>\n<passage id="S1#c1" source="Rao" page="">y</passage>\n</passages>',
      ),
    );
    expect(text).toContain('{{cite:S2#c1}}');
    expect(text).not.toContain('{{cite:S1#c1}}');
  });

  it('cites nothing when the prompt carries no passages', () => {
    const text = mockSuggestionFor(request('<passages>\n</passages>'));
    expect(text).not.toContain('{{cite:');
    // The sentence is intact, just uncited — a library-less document still gets a suggestion.
    expect(text).toContain('barrier households reported.');
  });

  it('keeps a third sentence so the A.1 two-sentence cut has something to do', () => {
    expect(MOCK_SUGGESTION.split('. ').length).toBeGreaterThanOrEqual(3);
  });

  it('writes something new once its paragraph is already before the cursor (ADR-0144)', () => {
    const kept = `<before>${MOCK_SUGGESTION}</before>\n<passages>\n</passages>`;
    const first = mockSuggestionFor(request(kept));
    const second = mockSuggestionFor(request(`<before>${first}</before>`));
    expect(first).not.toContain('rural Karnataka indicates');
    expect(first).not.toContain('{{cite:');
    expect(second).not.toBe(first);

    // Fifty kept in a row each survive A.1's filters against everything kept before them.
    let chapter = MOCK_SUGGESTION.replace(' {{cite:S1#c1}}', '');
    for (let i = 0; i < 50; i++) {
      const next = mockSuggestionFor(request(`<before>${chapter}</before>`));
      const processed = postProcessAssist({
        output: next,
        passageIds: [],
        before: chapter,
        autoCite: true,
        existingText: chapter,
      });
      expect(processed.empty, `variant ${i}: ${next}`).toBe(false);
      chapter = `${chapter} ${processed.text}`;
    }
  });
});
