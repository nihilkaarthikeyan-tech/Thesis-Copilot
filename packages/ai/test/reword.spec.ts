/** ADR-0082: the rewording instruction goes through A.1's own slot; the prompt is unchanged. */

import { describe, expect, it } from 'vitest';
import { buildAssistRequest, REWORD_INSTRUCTION } from '../src/builder/assist.js';

describe('REWORD_INSTRUCTION', () => {
  it('names the fault and the rule, and keeps the citations', () => {
    expect(REWORD_INSTRUCTION).toMatch(/own words/);
    expect(REWORD_INSTRUCTION).toMatch(/six consecutive words/);
    expect(REWORD_INSTRUCTION).toMatch(/same citations/);
  });

  it('reaches the model as the instruction, with the student’s own guidance after it', () => {
    const req = buildAssistRequest({
      memoryBlock: '',
      chapter: { title: 'Literature Review', scopeNote: null },
      passages: [{ id: 'S1#c1', shortRef: 'Kumar 2021', page: 7, text: 'Upfront cost first.' }],
      before: 'Adoption is low.',
      after: '',
      instruction: `${REWORD_INSTRUCTION} Keep it to one sentence.`,
      userId: 'u',
      documentId: 'd',
    });
    const user = req.messages.at(-1)?.content ?? '';
    expect(user).toContain(
      `<instruction>${REWORD_INSTRUCTION} Keep it to one sentence.</instruction>`,
    );
  });
});
