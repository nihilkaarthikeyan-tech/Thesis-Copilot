/**
 * The student's own note on their voice — ADR-0025 — as the model receives it.
 *
 * It rides in A.0.1's `voiceNote` slot, after the model's own reading of the student, so the
 * verbatim template is unchanged. Before a profile has been learned there is no slot to ride in:
 * the block's other lines are measurements, and none are printed that were not measured.
 */

import { describe, expect, it } from 'vitest';
import { buildChapterMemory, type ContextClient } from '../src/context.js';

const chapter = {
  id: 'c1',
  documentId: 'd1',
  outlineNodeId: 'ch1',
  title: 'Chapter 1',
  scopeNote: null,
  content: { type: 'doc', content: [] },
};

const clientWith = (styleProfile: unknown): ContextClient => ({
  $executeRawUnsafe: async () => 0,
  $queryRawUnsafe: async <T>() => [] as T,
  documentMemory: {
    findUnique: async () => ({ scope: {}, outline: [], glossary: {}, styleProfile }),
  },
  chapterSourcePin: { findMany: async () => [] },
});

const LEARNED = {
  avgSentenceLen: 21,
  register: 'formal',
  voice: 'mixed',
  transitions: ['however', 'in contrast'],
  voiceNote: 'Measured and precise; defines terms before using them.',
  learnedAt: '2026-09-20T10:00:00.000Z',
};

describe('the style profile in the memory block', () => {
  it('carries the student’s guidance after the model’s reading of them', async () => {
    const memory = await buildChapterMemory(
      clientWith({ ...LEARNED, guidance: 'British spelling; call them farmers, not respondents.' }),
      chapter,
    );
    expect(memory.text).toContain('Measured and precise; defines terms before using them.');
    expect(memory.text).toContain(
      'The student asks: British spelling; call them farmers, not respondents.',
    );
    expect(memory.text.indexOf('Measured and precise')).toBeLessThan(
      memory.text.indexOf('The student asks'),
    );
  });

  it('is unchanged when there is no guidance', async () => {
    const memory = await buildChapterMemory(clientWith(LEARNED), chapter);
    expect(memory.text).toContain('Measured and precise');
    expect(memory.text).not.toContain('The student asks');
  });

  it('prints nothing for guidance alone, before a profile has been learned', async () => {
    const memory = await buildChapterMemory(clientWith({ guidance: 'British spelling.' }), chapter);
    expect(memory.text).not.toContain('<style_profile>');
    expect(memory.text).not.toContain('British spelling');
  });
});
