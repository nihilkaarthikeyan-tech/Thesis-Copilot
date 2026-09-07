/**
 * FR-5.6, the citation role rewrite — PRD §5.5, ADR-0010.
 *
 * The prompt is the only one in the product that is not a copy of an Appendix A section, so its
 * post-processing carries more weight than usual: there is no PRD text to appeal to about what a
 * good answer looks like, only the two rules the ADR states. Both are enforced by refusing, never
 * by repairing — a rewrite that lost its citation cannot be patched by putting one back, because
 * the claim may have moved with it.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCiteRoleRequest,
  CITE_ROLE,
  citeRoleUserMessage,
  mockCiteRoleResponse,
  postProcessCiteRole,
} from '../src/builder/cite-role.js';

const ORIGINAL = 'Upfront cost was the main barrier {{cite:S1#c1}}.';

const input = {
  sentence: ORIGINAL,
  citationId: 'S1#c1',
  targetRole: 'narrative' as const,
  memoryBlock: '<document_memory></document_memory>',
  userId: 'u',
  documentId: 'd',
};

describe('the request', () => {
  it('is a Strong call metered as COMMAND (ADR-0008, ADR-0010)', () => {
    const request = buildCiteRoleRequest(input);
    expect(request.tier).toBe('strong');
    // Not an action of its own: the ₹100 ceiling has no room for another cap.
    expect(request.action).toBe('COMMAND');
    expect(request.maxTokens).toBe(CITE_ROLE.maxTokens);
  });

  it('names the citation and the form it is going to', () => {
    const message = citeRoleUserMessage(input);
    expect(message).toContain('citation="S1#c1"');
    expect(message).toContain('to="narrative"');
    expect(message).toContain(ORIGINAL);
  });

  it('carries the document memory in the cached block', () => {
    const request = buildCiteRoleRequest(input);
    expect(request.system.cached).toContain('<document_memory>');
    // The shared preamble comes first, so the cache prefix matches every other Strong call.
    expect(request.system.cached.startsWith('You are the writing engine')).toBe(true);
  });
});

describe('post-processing accepts a good rewrite', () => {
  it('keeps a rewrite that moved the citation and nothing else', () => {
    const out = postProcessCiteRole(
      '{{cite:S1#c1}} found that upfront cost was the main barrier.',
      ORIGINAL,
      'S1#c1',
    );
    expect(out.ok).toBe(true);
    expect(out.refusal).toBe(null);
    expect(out.unchanged).toBe(false);
    expect(out.sentence).toContain('{{cite:S1#c1}}');
  });

  it('strips the quotation marks a model wraps a one-sentence answer in', () => {
    const out = postProcessCiteRole(
      `"{{cite:S1#c1}} found that cost mattered."`,
      ORIGINAL,
      'S1#c1',
    );
    expect(out.ok).toBe(true);
    expect(out.sentence.startsWith('"')).toBe(false);
    expect(out.sentence.endsWith('"')).toBe(false);
  });

  it('reports an unchanged sentence as a legitimate answer, not a failure', () => {
    // The prompt tells the model to return the sentence as-is when it is already in the requested
    // form. That is a correct answer with nothing to apply.
    const out = postProcessCiteRole(ORIGINAL, ORIGINAL, 'S1#c1');
    expect(out.ok).toBe(true);
    expect(out.unchanged).toBe(true);
    expect(out.refusal).toBe(null);
  });

  it('leaves a second citation exactly where it was', () => {
    const two = 'Cost mattered {{cite:S1#c1}}, though siting also did {{cite:S2#c1}}.';
    const out = postProcessCiteRole(
      '{{cite:S1#c1}} found that cost mattered, though siting also did {{cite:S2#c1}}.',
      two,
      'S1#c1',
    );
    expect(out.ok).toBe(true);
    expect(out.sentence).toContain('{{cite:S2#c1}}');
  });
});

describe('post-processing refuses rather than repairs', () => {
  it('refuses a rewrite that dropped the citation, and keeps the student’s sentence', () => {
    const out = postProcessCiteRole(
      'Kumar found that upfront cost was the main barrier.',
      ORIGINAL,
      'S1#c1',
    );
    expect(out.ok).toBe(false);
    expect(out.sentence).toBe(ORIGINAL);
    expect(out.refusal).toContain('dropped the citation');
  });

  it('refuses a rewrite that lost a different citation in the same sentence', () => {
    const two = 'Cost mattered {{cite:S1#c1}}, though siting also did {{cite:S2#c1}}.';
    const out = postProcessCiteRole(
      '{{cite:S1#c1}} found that cost mattered, though siting also did.',
      two,
      'S1#c1',
    );
    expect(out.ok).toBe(false);
    expect(out.sentence).toBe(two);
    expect(out.refusal).toContain('other citation');
  });

  it('refuses a rewrite that invented a citation', () => {
    const out = postProcessCiteRole(
      '{{cite:S1#c1}} found that cost mattered {{cite:S9#c9}}.',
      ORIGINAL,
      'S1#c1',
    );
    expect(out.ok).toBe(false);
    expect(out.refusal).toContain('added a citation');
  });

  it('refuses an empty answer', () => {
    const out = postProcessCiteRole('   ', ORIGINAL, 'S1#c1');
    expect(out.ok).toBe(false);
    expect(out.sentence).toBe(ORIGINAL);
    expect(out.refusal).toContain('empty');
  });

  it('never returns a sentence the student did not have when it refuses', () => {
    for (const bad of ['', 'no citation here', '{{cite:S9#c9}} wrong id']) {
      const out = postProcessCiteRole(bad, ORIGINAL, 'S1#c1');
      expect(out.ok, bad).toBe(false);
      expect(out.sentence, bad).toBe(ORIGINAL);
    }
  });
});

describe('the mock', () => {
  const ask = (sentence: string, to: 'narrative' | 'parenthetical') => ({
    action: 'COMMAND',
    messages: [
      {
        content: citeRoleUserMessage({ ...input, sentence, targetRole: to }),
      },
    ],
  });

  it('only answers a request carrying a <target> block', () => {
    expect(mockCiteRoleResponse.match(ask(ORIGINAL, 'narrative'))).toBe(true);
    // A section command is also a COMMAND call and must fall through to its own mock.
    expect(
      mockCiteRoleResponse.match({ action: 'COMMAND', messages: [{ content: '<selection>x' }] }),
    ).toBe(false);
  });

  it('moves the citation to the front for narrative', () => {
    const { text } = mockCiteRoleResponse.respond(ask(ORIGINAL, 'narrative'));
    expect(text.startsWith('{{cite:S1#c1}}')).toBe(true);
    expect(postProcessCiteRole(text, ORIGINAL, 'S1#c1').ok).toBe(true);
  });

  it('moves it back to the end for parenthetical', () => {
    const narrative = '{{cite:S1#c1}} found that upfront cost was the main barrier.';
    const { text } = mockCiteRoleResponse.respond(ask(narrative, 'parenthetical'));
    expect(text.trimEnd().endsWith('{{cite:S1#c1}}.')).toBe(true);
    expect(postProcessCiteRole(text, narrative, 'S1#c1').ok).toBe(true);
  });

  it('invents no author name — it has none, and nor does the real model', () => {
    // The id renders the name in the reader's style. A name in the prose would not follow a
    // style switch, which FR-5.2 promises it must.
    const { text } = mockCiteRoleResponse.respond(ask(ORIGINAL, 'narrative'));
    const words = text.replace(/\{\{cite:[^}]+\}\}/g, '').toLowerCase();
    for (const word of words.split(/[^a-z]+/).filter(Boolean)) {
      expect(`${ORIGINAL.toLowerCase()} found that`, word).toContain(word);
    }
  });

  it('leaves a sentence alone when the citation is not in it', () => {
    const { text } = mockCiteRoleResponse.respond(ask('No citation in this one.', 'narrative'));
    expect(text).toBe('No citation in this one.');
  });
});
