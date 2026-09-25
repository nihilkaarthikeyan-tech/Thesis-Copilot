/**
 * The supervisor's progress view.
 *
 * Two decisions carry it, and both are about not crying wolf: a first visit must not report the
 * whole thesis as new, and a refresh must not clear the list of what changed. Get either wrong
 * and the flag becomes noise a supervisor learns to skip — which is worse than not having it.
 */

import { describe, expect, it } from 'vitest';
import {
  type ChapterRow,
  guideProgress,
  HISTORY_WEEKS,
  shouldBumpVisit,
  VISIT_WINDOW_MINUTES,
  weeklyWords,
  weekStartOf,
} from '../src/modules/feedback/guide-progress.js';

const NOW = new Date('2026-09-21T12:00:00Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

const chapter = (over: Partial<ChapterRow> & { id: string }): ChapterRow => ({
  title: 'A chapter',
  order: 1,
  wordCount: 1200,
  updatedAt: minutesAgo(60),
  ...over,
});

const progress = (over: Partial<Parameters<typeof guideProgress>[0]> = {}) =>
  guideProgress({
    chapters: [chapter({ id: 'c1' })],
    openCommentsByChapter: new Map(),
    lastViewedAt: minutesAgo(120),
    ...over,
  });

describe('when to move the visit marker', () => {
  it('moves it on a first visit', () => {
    expect(shouldBumpVisit(null, NOW)).toBe(true);
  });

  it('leaves it alone on a refresh, so the list does not empty while they read', () => {
    expect(shouldBumpVisit(minutesAgo(1), NOW)).toBe(false);
    expect(shouldBumpVisit(minutesAgo(VISIT_WINDOW_MINUTES - 1), NOW)).toBe(false);
  });

  it('moves it once the previous visit has gone cold', () => {
    expect(shouldBumpVisit(minutesAgo(VISIT_WINDOW_MINUTES + 1), NOW)).toBe(true);
  });
});

describe('what changed', () => {
  it('marks a chapter edited since the last visit', () => {
    const p = progress({
      chapters: [chapter({ id: 'c1', updatedAt: minutesAgo(30) })],
      lastViewedAt: minutesAgo(120),
    });
    expect(p.chapters[0]?.changedSinceLastVisit).toBe(true);
    expect(p.changedCount).toBe(1);
  });

  it('leaves an untouched chapter alone', () => {
    const p = progress({
      chapters: [chapter({ id: 'c1', updatedAt: minutesAgo(300) })],
      lastViewedAt: minutesAgo(120),
    });
    expect(p.chapters[0]?.changedSinceLastVisit).toBe(false);
  });

  it('reports nothing as new on a first visit', () => {
    // True but useless: flagging the whole thesis trains a supervisor to ignore the flag.
    const p = progress({ lastViewedAt: null });
    expect(p.changedCount).toBe(0);
    expect(p.headline).toContain('first time');
  });

  it('never marks an unstarted chapter as changed', () => {
    const p = progress({
      chapters: [chapter({ id: 'c1', wordCount: 0, updatedAt: minutesAgo(1) })],
      lastViewedAt: minutesAgo(120),
    });
    expect(p.chapters[0]?.changedSinceLastVisit).toBe(false);
    expect(p.chapters[0]?.updatedAt).toBeNull();
  });
});

describe('the scale of the thing', () => {
  it('counts only started chapters as started', () => {
    const p = progress({
      chapters: [
        chapter({ id: 'a', wordCount: 900 }),
        chapter({ id: 'b', wordCount: 0, order: 2 }),
        chapter({ id: 'c', wordCount: 400, order: 3 }),
      ],
    });
    expect(p.chaptersStarted).toBe(2);
    expect(p.chaptersTotal).toBe(3);
    expect(p.totalWords).toBe(1300);
  });

  it('adds up this guide’s open comments', () => {
    const p = progress({
      chapters: [chapter({ id: 'a' }), chapter({ id: 'b', order: 2 })],
      openCommentsByChapter: new Map([
        ['a', 2],
        ['b', 1],
      ]),
    });
    expect(p.openComments).toBe(3);
  });
});

describe('the sentence a supervisor reads', () => {
  it('says plainly when nothing has moved', () => {
    const p = progress({
      chapters: [chapter({ id: 'c1', updatedAt: minutesAgo(300) })],
      lastViewedAt: minutesAgo(120),
    });
    expect(p.headline).toContain('Nothing has changed');
  });

  it('leads with what changed, and mentions their open comments', () => {
    const p = progress({
      chapters: [chapter({ id: 'c1', updatedAt: minutesAgo(10) })],
      openCommentsByChapter: new Map([['c1', 2]]),
      lastViewedAt: minutesAgo(120),
    });
    expect(p.headline).toContain('1 chapter changed since you last looked');
    expect(p.headline).toContain('2 comments of yours still open');
  });

  it('gets the singular right', () => {
    const p = progress({
      chapters: [chapter({ id: 'c1', updatedAt: minutesAgo(10) })],
      openCommentsByChapter: new Map([['c1', 1]]),
      lastViewedAt: minutesAgo(120),
    });
    expect(p.headline).toContain('1 comment of yours');
    expect(p.headline).not.toContain('1 comments');
  });
});

describe('the live view (2026-09-25)', () => {
  it('marks a chapter saved in the last few minutes as being written now', () => {
    const p = guideProgress({
      chapters: [
        chapter({ id: 'c1', updatedAt: minutesAgo(2) }),
        chapter({ id: 'c2', updatedAt: minutesAgo(40) }),
        chapter({ id: 'c3', wordCount: 0, updatedAt: minutesAgo(1) }),
      ],
      openCommentsByChapter: new Map(),
      lastViewedAt: minutesAgo(120),
      now: NOW,
    });
    expect(p.chapters.map((c) => c.activeNow)).toEqual([true, false, false]);
    expect(p.lastActiveAt).toBe(minutesAgo(2).toISOString());
  });

  it('weeks start on Monday, UTC', () => {
    expect(weekStartOf(new Date('2026-09-24T18:00:00Z')).toISOString()).toBe(
      '2026-09-21T00:00:00.000Z',
    );
    expect(weekStartOf(new Date('2026-09-27T23:59:00Z')).toISOString()).toBe(
      '2026-09-21T00:00:00.000Z',
    );
  });

  it('draws words over time from the counts autosave recorded, this week from now', () => {
    const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60_000);
    const weeks = weeklyWords(
      [chapter({ id: 'c1', wordCount: 3000 }), chapter({ id: 'c2', wordCount: 500 })],
      [
        { chapterId: 'c1', wordCount: 800, createdAt: daysAgo(20) },
        { chapterId: 'c1', wordCount: 1500, createdAt: daysAgo(10) },
        { chapterId: 'c1', wordCount: 2000, createdAt: daysAgo(3) },
        { chapterId: 'c2', wordCount: 200, createdAt: daysAgo(3) },
      ],
      NOW,
    );
    expect(weeks).toHaveLength(HISTORY_WEEKS);
    expect(weeks.at(-1)).toEqual({
      weekStart: '2026-09-21T00:00:00.000Z',
      words: 3500,
      partial: false,
    });
    // The week before this one ended with c1 at 2,000 and c2 at 200.
    expect(weeks.at(-2)?.words).toBe(2200);
    expect(weeks.at(-3)?.words).toBe(1500);
    expect(weeks.at(-4)?.words).toBe(800);
    expect(weeks[0]?.words).toBe(0);
  });

  it('marks a week partial rather than inventing a fall, when a count was never recorded', () => {
    const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60_000);
    const weeks = weeklyWords(
      [chapter({ id: 'c1', wordCount: 3000 })],
      [{ chapterId: 'c1', wordCount: null, createdAt: daysAgo(3) }],
      NOW,
    );
    expect(weeks.at(-2)).toMatchObject({ words: 0, partial: true });
  });
});
