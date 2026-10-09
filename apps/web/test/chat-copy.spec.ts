import { describe, expect, it } from 'vitest';
import { answerPlainText, isRefusalAnswer } from '../src/lib/chat-copy';

describe('isRefusalAnswer — no "Add to document" under a refusal (QA 2026-10-08)', () => {
  it('knows a refusal by its outcome', () => {
    for (const outcome of [
      'not-enough',
      'off-topic',
      'filtered-out',
      'named-empty',
      'beyond-empty',
      'beyond-not-enough',
      'deep-empty',
      'writing-redirect',
    ]) {
      expect(isRefusalAnswer({ outcome, text: 'anything' })).toBe(true);
    }
    expect(isRefusalAnswer({ outcome: 'answered', text: 'Cost is the barrier.' })).toBe(false);
  });

  it('knows a stored refusal by its words when it has no outcome', () => {
    for (const text of [
      'Your library does not contain enough on this. Try adding sources on: chocolate cake.',
      'This chat only answers questions about the sources in your library. Nothing in your library relates to that, so there is nothing for me to answer from.',
      'This chat answers only from the papers in the collection “Methods”. Nothing in them relates to that.',
      'The papers in the collection “Methods” have no readable text yet, so there is nothing in them to answer from.',
      'The abstracts the search found do not answer this. Try naming the method.',
    ]) {
      expect(isRefusalAnswer({ text })).toBe(true);
    }
    expect(isRefusalAnswer({ text: 'Heat stress lowers milk yield {{cite:S1#c1}}.' })).toBe(false);
  });
});

const citations = [
  { key: 'a1', label: '(Kumar et al., 2021)' },
  { key: 'b2', label: '[7]' },
];

describe('answerPlainText — a chat answer for the clipboard', () => {
  it('writes each citation as its label, never as a marker', () => {
    const copied = answerPlainText(
      'Upfront cost is the main barrier {{cite:a1}}. Subsidies help{{cite:b2}}.',
      citations,
    );
    expect(copied).toBe(
      'Upfront cost is the main barrier (Kumar et al., 2021). Subsidies help [7].',
    );
    expect(copied).not.toContain('{{');
  });

  it('keeps equations as their LaTeX, in their delimiters', () => {
    expect(answerPlainText('The rate is $7.4 \\times 10^{-10}$ and $$E = mc^2$$ holds.', [])).toBe(
      'The rate is $7.4 \\times 10^{-10}$ and $$E = mc^2$$ holds.',
    );
  });

  it('drops a marker the panel would not show, without leaving a gap before the full stop', () => {
    expect(answerPlainText('A claim {{cite:gone}}. Next.', citations)).toBe('A claim. Next.');
  });

  it('copies an answer in parts with its headings as words, not markup (ADR-0074)', () => {
    expect(
      answerPlainText('Cost leads.\n\n### Upfront cost\nIt is high {{cite:a1}}.', citations),
    ).toBe('Cost leads.\n\nUpfront cost\nIt is high (Kumar et al., 2021).');
  });

  it('keeps line breaks and trims the ends', () => {
    expect(answerPlainText('\nFirst {{cite:a1}}.\n\nSecond.\n', citations)).toBe(
      'First (Kumar et al., 2021).\n\nSecond.',
    );
  });
});
