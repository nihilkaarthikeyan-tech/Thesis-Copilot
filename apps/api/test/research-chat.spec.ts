/**
 * The pure half of a research question with no thesis — ADR-0132.
 */

import { describe, expect, it } from 'vitest';
import type { BeyondPaper } from '../src/modules/assist/beyond-library.js';
import type { StoredTurn } from '../src/modules/assist/chat-threads.js';
import {
  acrossNote,
  acrossStep,
  noThesisMemoryBlock,
  noThesisNote,
  papersOfChat,
  readingPassagesStep,
  thesisTitleFrom,
} from '../src/modules/assist/research-chat.js';

const paper = (doi: string | null, title = `Paper ${doi}`): BeyondPaper => ({
  title,
  year: 2021,
  venue: null,
  doi,
  inLibrary: false,
  reference: doi ? { raw: title, doi } : { raw: title },
});

describe('research chat helpers', () => {
  it('collects every cited paper once, from the web and from the theses, in first-cited order', () => {
    // Cast: `ChatTurn`'s citation type (key, label) and ChatCitation are intersected on StoredTurn.
    const turns = [
      { id: '1', role: 'user', text: 'q' },
      {
        id: '2',
        role: 'assistant',
        text: 'a',
        citations: [
          {
            key: 'Sweb1#cabstract',
            sourceId: '',
            chunkId: '',
            label: 'A',
            beyond: paper('10.1/a'),
          },
          {
            key: 'Sweb2#cabstract',
            sourceId: '',
            chunkId: '',
            label: 'B',
            beyond: paper(null, 'B'),
          },
        ],
      },
      { id: '3', role: 'user', text: 'q2' },
      {
        id: '4',
        role: 'assistant',
        text: 'a2',
        citations: [
          { key: 'S1#c1', sourceId: 's', chunkId: 'c', label: 'A', paper: paper('10.1/A') },
          {
            key: 'S2#c1',
            sourceId: 's2',
            chunkId: 'c2',
            label: 'C',
            thesis: { id: 't', title: 'T' },
            paper: paper('10.1/c'),
          },
        ],
      },
    ] as StoredTurn[];
    expect(papersOfChat(turns).map((p) => p.doi ?? p.title)).toEqual(['10.1/a', 'B', '10.1/c']);
  });

  it('suggests the question as a working title, cut at a word under 300 characters', () => {
    expect(thesisTitleFrom('  What   limits solar? ')).toBe('What limits solar?');
    const long = thesisTitleFrom('word '.repeat(100));
    expect(long.length).toBeLessThanOrEqual(300);
    expect(long.endsWith('word…')).toBe(true);
  });

  it('asks under an empty memory block: no thesis is described', () => {
    const block = noThesisMemoryBlock();
    expect(block).toContain('<document_memory>');
    expect(block).toContain('Working title: \n');
    expect(block).toContain('(no outline yet)');
  });

  it('says what it read', () => {
    expect(noThesisNote(1)).toMatch(/^From the abstracts of 1 paper the search found/);
    expect(acrossStep(1)).toBe('Searching your thesis…');
    expect(acrossStep(3)).toBe('Searching your 3 theses…');
    expect(readingPassagesStep(1, 1)).toBe('Reading 1 passage from 1 thesis');
    expect(acrossNote(5, 2)).toBe(
      'From 5 passages in the libraries of 2 of your theses. Each citation names its thesis.',
    );
  });
});
