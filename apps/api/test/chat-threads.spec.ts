/**
 * Chat threads, the pure part — ADR-0116. How a thread is titled, what is kept of it, and the two
 * refusals a chat on one collection gives in its own words.
 */

import { describe, expect, it } from 'vitest';
import {
  collectionEmptyReply,
  collectionOffTopicReply,
  questionCount,
  readTurns,
  THREAD_KEEP_TURNS,
  THREAD_TITLE_MAX,
  threadTitle,
} from '../src/modules/assist/chat-threads.js';

describe('a thread’s title', () => {
  it('is the first question, its spaces collapsed', () => {
    expect(threadTitle('  What limits   rooftop\nsolar adoption? ')).toBe(
      'What limits rooftop solar adoption?',
    );
  });

  it('is cut at a word, with an ellipsis, when the question is long', () => {
    const long =
      'What do the studies in my library say about the financial barriers to rooftop solar adoption among rural households in Karnataka?';
    const title = threadTitle(long);
    expect(title.length).toBeLessThanOrEqual(THREAD_TITLE_MAX);
    expect(title.endsWith('…')).toBe(true);
    expect(long.startsWith(title.slice(0, -1))).toBe(true);
    // At a word: the character after the cut in the question is a space.
    expect(long[title.length - 1]).toBe(' ');
  });

  it('is cut anyway when there is no word to cut at', () => {
    const title = threadTitle('x'.repeat(200));
    expect(title).toBe(`${'x'.repeat(THREAD_TITLE_MAX - 1)}…`);
  });

  it('is never empty', () => {
    expect(threadTitle('   ')).toBe('Chat');
  });
});

describe('the turns kept', () => {
  it('reads only real turns, and gives each an id', () => {
    const turns = readTurns([
      { id: 'q1', role: 'user', text: 'Why?' },
      { role: 'assistant', text: 'Because.' },
      { role: 'system', text: 'not a turn' },
      { role: 'user' },
      'nonsense',
      null,
    ]);
    expect(turns.map((t) => t.text)).toEqual(['Why?', 'Because.']);
    expect(turns[0]?.id).toBe('q1');
    expect(turns[1]?.id).toMatch(/[0-9a-f-]{36}/);
    expect(readTurns({ turns: [] })).toEqual([]);
  });

  it('keeps the last THREAD_KEEP_TURNS, far more than the four A.4 sends the model', () => {
    const many = Array.from({ length: THREAD_KEEP_TURNS + 10 }, (_, i) => ({
      id: `t${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: `turn ${i}`,
    }));
    const kept = readTurns(many);
    expect(kept).toHaveLength(THREAD_KEEP_TURNS);
    expect(kept[0]?.id).toBe('t10');
    expect(THREAD_KEEP_TURNS).toBeGreaterThan(8);
    expect(questionCount(kept)).toBe(THREAD_KEEP_TURNS / 2);
  });
});

describe('a chat on one collection says so when it refuses', () => {
  it('names the collection, and offers no search beyond it', () => {
    const reply = collectionOffTopicReply('Methods');
    expect(reply).toContain('“Methods”');
    expect(reply).toContain('start a new chat on your whole library');
    expect(reply).not.toMatch(/search/i);
    expect(collectionEmptyReply('Methods')).toContain('no readable text yet');
  });
});
