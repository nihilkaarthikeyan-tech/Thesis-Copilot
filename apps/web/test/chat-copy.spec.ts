import { describe, expect, it } from 'vitest';
import { answerPlainText } from '../src/lib/chat-copy';

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
