import { describe, expect, it } from 'vitest';
import {
  matchPrompts,
  promptQuery,
  type SavedPrompt,
  suggestPromptTitle,
} from '../src/lib/prompts';

describe('asking for a saved prompt', () => {
  it('is a / at the very start of the box', () => {
    expect(promptQuery('/')).toBe('');
    expect(promptQuery('/lim')).toBe('lim');
    expect(promptQuery('/compare methods')).toBe('compare methods');
  });

  it('is not a slash anywhere else', () => {
    expect(promptQuery('and/or')).toBeNull();
    expect(promptQuery('What does p/q mean?')).toBeNull();
    expect(promptQuery(' /lim')).toBeNull();
    expect(promptQuery('')).toBeNull();
  });
});

describe('a name to start from', () => {
  it('is the first few words, without the question mark', () => {
    expect(suggestPromptTitle('What limitations do the authors admit about their sample?')).toBe(
      'What limitations do the authors admit',
    );
    expect(suggestPromptTitle('  Compare the methods?  ')).toBe('Compare the methods');
  });

  it('stays short when the words are long', () => {
    const title = suggestPromptTitle(
      `${'Pneumonoultramicroscopicsilicovolcanoconiosis '.repeat(3)}`,
    );
    expect(title.length).toBeLessThanOrEqual(60);
  });
});

describe('finding a prompt', () => {
  const prompts: SavedPrompt[] = [
    { id: '1', title: 'Compare methods', body: 'How do the methods differ?', updatedAt: '' },
    {
      id: '2',
      title: 'Limitations',
      body: 'What do the authors admit about their methods?',
      updatedAt: '',
    },
    { id: '3', title: 'Gaps', body: 'What is still unknown?', updatedAt: '' },
  ];

  it('lists everything for a bare /', () => {
    expect(matchPrompts(prompts, '').map((p) => p.id)).toEqual(['1', '2', '3']);
  });

  it('puts a match in the name before a match in the text', () => {
    // "method" is in 1's name and 2's text.
    expect(matchPrompts(prompts, 'method').map((p) => p.id)).toEqual(['1', '2']);
  });

  it('ignores case, and finds nothing when nothing matches', () => {
    expect(matchPrompts(prompts, 'GAPS').map((p) => p.id)).toEqual(['3']);
    expect(matchPrompts(prompts, 'zzz')).toEqual([]);
  });
});
