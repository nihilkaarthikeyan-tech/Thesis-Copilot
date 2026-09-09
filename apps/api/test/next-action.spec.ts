/**
 * The next-action ladder.
 *
 * `decide` is a pure function of counts, which is the point: the recommendation has to be cheap
 * enough to compute on every page load, so it may not call a model and may not ask the database
 * anything the page did not already need.
 *
 * What these tests are really about is the *order*. Each rung is easy; the value is entirely in
 * which one wins when several are true at once, so most of what follows sets up two conditions and
 * asserts which of them the student is shown.
 */

import { describe, expect, it } from 'vitest';
import { decide, type NextActionCounts } from '../src/modules/documents/next-action.service.js';

const NONE: NextActionCounts = {
  chapters: 3,
  words: 4500,
  sources: 12,
  unresolvedSources: 0,
  abstractOnlySources: 0,
  openComments: 0,
  openFlags: 0,
};

const chapter = (
  over: Partial<{ id: string; title: string; order: number; wordCount: number; pins: number }> = {},
) => ({
  id: over.id ?? 'ch-1',
  title: over.title ?? 'Introduction',
  order: over.order ?? 1,
  wordCount: over.wordCount ?? 1500,
  _count: { pins: over.pins ?? 0 },
});

const doc = (over: Partial<Parameters<typeof decide>[0]> = {}) => ({
  chapters: over.chapters ?? [chapter()],
  comments: over.comments ?? [],
  flags: over.flags ?? [],
});

describe('each rung', () => {
  it('sends a thesis with no chapters to the outline', () => {
    const action = decide(doc({ chapters: [] }), { ...NONE, chapters: 0, words: 0 });
    expect(action.kind).toBe('outline');
    expect(action.href).toBe('/outline');
  });

  it('names how many guide comments are waiting', () => {
    const action = decide(
      doc({ comments: [{ class: 'SUBSTANTIVE' }, { class: null }, { class: 'SUBSTANTIVE' }] }),
      { ...NONE, openComments: 3 },
    );
    expect(action.kind).toBe('comments');
    expect(action.headline).toContain('3 comments');
    // The substantive count is the part that decides whether this is an afternoon or five minutes.
    expect(action.detail).toContain('2 of them');
  });

  it('reads naturally for exactly one of anything', () => {
    const action = decide(doc({ comments: [{ class: null }] }), { ...NONE, openComments: 1 });
    expect(action.headline).toContain('1 comment from your guide is unanswered');
    expect(action.headline).not.toContain('comments');
  });

  it('flags sources that never resolved', () => {
    const action = decide(doc(), { ...NONE, unresolvedSources: 2 });
    expect(action.kind).toBe('unresolved');
    expect(action.href).toBe('/sources');
  });

  it('calls out serious coherence flags by count', () => {
    const action = decide(doc({ flags: [{ severity: 'ERROR' }, { severity: 'WARN' }] }), {
      ...NONE,
      openFlags: 2,
    });
    expect(action.kind).toBe('flags');
    expect(action.detail).toContain('1 is serious');
  });

  it('sends an empty library to sources', () => {
    const action = decide(doc(), { ...NONE, sources: 0 });
    expect(action.kind).toBe('sources');
  });

  it('points at a chapter whose reading is already done', () => {
    const action = decide(
      doc({
        chapters: [
          chapter({ id: 'a', title: 'Introduction', wordCount: 1200 }),
          chapter({ id: 'b', title: 'Literature review', wordCount: 0, pins: 9 }),
        ],
      }),
      NONE,
    );
    expect(action.kind).toBe('write-ready');
    expect(action.headline).toContain('Literature review has 9 sources pinned');
    expect(action.href).toBe('/write/b');
  });

  it('mentions abstract-only sources once nothing is blocked', () => {
    const action = decide(doc(), { ...NONE, abstractOnlySources: 4 });
    expect(action.kind).toBe('grounding');
    expect(action.headline).toContain('4 sources have only an abstract');
  });

  it('falls through to the thinnest chapter', () => {
    const action = decide(
      doc({
        chapters: [
          chapter({ id: 'a', title: 'Introduction', wordCount: 3000 }),
          chapter({ id: 'b', title: 'Method', wordCount: 400 }),
          chapter({ id: 'c', title: 'Results', wordCount: 2200 }),
        ],
      }),
      NONE,
    );
    expect(action.kind).toBe('thinnest');
    expect(action.headline).toContain('Method is the thinnest chapter at 400 words');
    expect(action.href).toBe('/write/b');
  });

  it('says so when everything is ready and nothing is written', () => {
    const action = decide(
      doc({ chapters: [chapter({ id: 'a', title: 'Introduction', wordCount: 0 })] }),
      { ...NONE, words: 0 },
    );
    expect(action.kind).toBe('clear');
    expect(action.href).toBe('/write/a');
  });
});

describe('the order is the design', () => {
  it('puts the guide ahead of everything else', () => {
    // Someone else is blocked. That outranks work only the student is blocked on.
    const action = decide(doc({ comments: [{ class: null }], flags: [{ severity: 'ERROR' }] }), {
      ...NONE,
      openComments: 1,
      openFlags: 5,
      unresolvedSources: 3,
      sources: 0,
    });
    expect(action.kind).toBe('comments');
  });

  it('puts an unciteable source ahead of a contradiction', () => {
    const action = decide(doc({ flags: [{ severity: 'ERROR' }] }), {
      ...NONE,
      unresolvedSources: 1,
      openFlags: 4,
    });
    expect(action.kind).toBe('unresolved');
  });

  it('puts a ready chapter ahead of merely-thin ones', () => {
    // Both rungs match. The one whose reading is done is the cheaper hour.
    const action = decide(
      doc({
        chapters: [
          chapter({ id: 'a', title: 'Introduction', wordCount: 90 }),
          chapter({ id: 'b', title: 'Method', wordCount: 0, pins: 4 }),
        ],
      }),
      NONE,
    );
    expect(action.kind).toBe('write-ready');
    expect(action.href).toBe('/write/b');
  });

  it('puts a ready chapter ahead of abstract-only sources', () => {
    const action = decide(doc({ chapters: [chapter({ id: 'b', wordCount: 0, pins: 2 })] }), {
      ...NONE,
      abstractOnlySources: 7,
    });
    expect(action.kind).toBe('write-ready');
  });

  it('ignores a chapter with no words and no pins — there is nothing to write from', () => {
    const action = decide(
      doc({
        chapters: [
          chapter({ id: 'a', title: 'Introduction', wordCount: 2000 }),
          chapter({ id: 'b', title: 'Method', wordCount: 0, pins: 0 }),
        ],
      }),
      NONE,
    );
    expect(action.kind).toBe('thinnest');
    expect(action.href).toBe('/write/b');
  });
});

describe('it always gives somewhere to go', () => {
  it('returns a usable link whatever the state', () => {
    const states: NextActionCounts[] = [
      { ...NONE, chapters: 0, words: 0 },
      { ...NONE, openComments: 2 },
      { ...NONE, unresolvedSources: 1 },
      { ...NONE, openFlags: 1 },
      { ...NONE, sources: 0 },
      { ...NONE, abstractOnlySources: 1 },
      NONE,
    ];
    for (const counts of states) {
      const action = decide(doc(), counts);
      expect(action.href.startsWith('/'), action.kind).toBe(true);
      expect(action.cta.length, action.kind).toBeGreaterThan(0);
      expect(action.headline.length, action.kind).toBeGreaterThan(0);
      expect(action.detail.length, action.kind).toBeGreaterThan(0);
    }
  });
});
