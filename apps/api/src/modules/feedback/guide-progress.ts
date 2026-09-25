/**
 * What a supervisor sees when they open a thesis — FR-7, 2026-09-21.
 *
 * A guide could already read chapters and leave comments. What they could not do is the thing a
 * supervisor actually does first: look at the whole thing and ask *where is this up to, and what
 * has moved since I last read it?* The share gave them a chapter list, identical on every visit.
 *
 * ## What is deliberately not here
 *
 * **The AI-usage share.** The product tracks provenance for every word and can say what
 * percentage of a chapter came from a suggestion — and it is not shown to the guide. FR-8.6 makes
 * that disclosure something the *student* exports and hands over. Putting it in the supervisor's
 * dashboard by default would convert a disclosure tool into a surveillance one, and would change
 * what it means for a student to invite their supervisor in. They can still share it; this simply
 * does not do it for them.
 *
 * **Anything editable.** A guide comments. Nothing on this path writes to a chapter.
 */

/** A refresh should not clear "changed since you last looked". Half an hour of reading is one visit. */
export const VISIT_WINDOW_MINUTES = 30;

/** A chapter saved this recently is being written now (2026-09-25). Autosave runs every few seconds. */
export const ACTIVE_NOW_MINUTES = 5;

/** Weeks of history in the words-over-time line. */
export const HISTORY_WEEKS = 8;

export type ChapterProgress = {
  id: string;
  title: string;
  order: number;
  words: number;
  /** Null when the chapter has never been written to. */
  updatedAt: string | null;
  /** Changed since this guide's previous visit. False on a first visit — see `guideProgress`. */
  changedSinceLastVisit: boolean;
  /** Comments this guide has left on the chapter that the student has not resolved. */
  openComments: number;
  started: boolean;
  /** Saved in the last `ACTIVE_NOW_MINUTES`: the student is writing it now. */
  activeNow: boolean;
};

/** Words in the whole thesis at the end of one week (Monday 00:00 UTC to Monday). */
export type WeekWords = {
  weekStart: string;
  words: number;
  /**
   * Some chapter's count at that time is not known — its versions from then predate word counts
   * being recorded — so this is a lower bound, and the page says so rather than drawing a dip.
   */
  partial: boolean;
};

export type GuideProgress = {
  chapters: ChapterProgress[];
  totalWords: number;
  chaptersStarted: number;
  chaptersTotal: number;
  /** ISO of the previous visit, or null the first time. */
  lastVisitedAt: string | null;
  changedCount: number;
  openComments: number;
  headline: string;
  /** The last `HISTORY_WEEKS` weeks, oldest first; the last is this week so far. */
  weekly: WeekWords[];
  /** The latest save to any chapter, or null if nothing has been written. */
  lastActiveAt: string | null;
};

export type ChapterRow = {
  id: string;
  title: string;
  order: number;
  wordCount: number;
  updatedAt: Date;
};

/**
 * Whether the stored `lastViewedAt` should be moved forward for this visit.
 *
 * Only once the previous visit has gone cold. Bumping on every request would mean a supervisor
 * who reloads the page sees "nothing changed" a second later, which is worse than useless — it
 * actively hides the thing they opened the page for.
 */
export function shouldBumpVisit(lastViewedAt: Date | null, now: Date): boolean {
  if (!lastViewedAt) return true;
  return now.getTime() - lastViewedAt.getTime() > VISIT_WINDOW_MINUTES * 60_000;
}

export function guideProgress(input: {
  chapters: readonly ChapterRow[];
  /** Open comment counts by chapter id, for this guide only. */
  openCommentsByChapter: ReadonlyMap<string, number>;
  lastViewedAt: Date | null;
  /** Saved versions with their word counts, for the words-over-time line. */
  versions?: readonly VersionRow[];
  now?: Date;
}): GuideProgress {
  const now = input.now ?? new Date();
  const chapters: ChapterProgress[] = input.chapters.map((chapter) => {
    const started = chapter.wordCount > 0;
    return {
      id: chapter.id,
      title: chapter.title,
      order: chapter.order,
      words: chapter.wordCount,
      updatedAt: started ? chapter.updatedAt.toISOString() : null,
      // A first visit reports nothing as new. Marking the whole thesis "changed" would be true
      // and useless, and would train a supervisor to ignore the flag on every later visit.
      changedSinceLastVisit: Boolean(
        input.lastViewedAt && started && chapter.updatedAt > input.lastViewedAt,
      ),
      openComments: input.openCommentsByChapter.get(chapter.id) ?? 0,
      started,
      activeNow:
        started && now.getTime() - chapter.updatedAt.getTime() <= ACTIVE_NOW_MINUTES * 60_000,
    };
  });
  const lastActive = input.chapters
    .filter((c) => c.wordCount > 0)
    .reduce<Date | null>(
      (latest, c) => (!latest || c.updatedAt > latest ? c.updatedAt : latest),
      null,
    );

  const totalWords = chapters.reduce((sum, c) => sum + c.words, 0);
  const chaptersStarted = chapters.filter((c) => c.started).length;
  const changedCount = chapters.filter((c) => c.changedSinceLastVisit).length;
  const openComments = chapters.reduce((sum, c) => sum + c.openComments, 0);

  return {
    chapters,
    totalWords,
    chaptersStarted,
    chaptersTotal: chapters.length,
    lastVisitedAt: input.lastViewedAt ? input.lastViewedAt.toISOString() : null,
    changedCount,
    openComments,
    headline: headlineFor({
      totalWords,
      chaptersStarted,
      chaptersTotal: chapters.length,
      changedCount,
      openComments,
      firstVisit: !input.lastViewedAt,
    }),
    weekly: weeklyWords(input.chapters, input.versions ?? [], now),
    lastActiveAt: lastActive ? lastActive.toISOString() : null,
  };
}

export type VersionRow = { chapterId: string; wordCount: number | null; createdAt: Date };

const DAY = 24 * 60 * 60_000;

/** Monday 00:00 UTC of the week `date` falls in. */
export function weekStartOf(date: Date): Date {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - sinceMonday * DAY);
}

/**
 * The thesis's length at the end of each of the last `HISTORY_WEEKS` weeks, from the versions
 * autosave already keeps — each records its chapter's words. The current week is the chapters as
 * they are now. Nothing is estimated: a chapter with no counted version by a week's end counts as
 * nothing written, unless it had uncounted versions by then, in which case the week is marked
 * `partial` instead of showing a fall that did not happen.
 */
export function weeklyWords(
  chapters: readonly ChapterRow[],
  versions: readonly VersionRow[],
  now: Date,
  weeks = HISTORY_WEEKS,
): WeekWords[] {
  const thisWeek = weekStartOf(now);
  const byChapter = new Map<string, VersionRow[]>();
  for (const version of [...versions].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )) {
    const list = byChapter.get(version.chapterId) ?? [];
    list.push(version);
    byChapter.set(version.chapterId, list);
  }

  const out: WeekWords[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(thisWeek.getTime() - i * 7 * DAY);
    if (i === 0) {
      out.push({
        weekStart: start.toISOString(),
        words: chapters.reduce((sum, c) => sum + c.wordCount, 0),
        partial: false,
      });
      continue;
    }
    const end = new Date(start.getTime() + 7 * DAY);
    let words = 0;
    let partial = false;
    for (const list of byChapter.values()) {
      const upToEnd = list.filter((v) => v.createdAt < end);
      const counted = upToEnd.filter((v) => v.wordCount !== null).at(-1);
      if (counted) words += counted.wordCount ?? 0;
      else if (upToEnd.length > 0) partial = true;
    }
    out.push({ weekStart: start.toISOString(), words, partial });
  }
  return out;
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

function headlineFor(input: {
  totalWords: number;
  chaptersStarted: number;
  chaptersTotal: number;
  changedCount: number;
  openComments: number;
  firstVisit: boolean;
}): string {
  const scale = `${plural(input.chaptersStarted, 'chapter')} of ${input.chaptersTotal} started · ${input.totalWords.toLocaleString()} words`;

  if (input.firstVisit) return `${scale}. This is the first time you have opened it.`;

  const parts: string[] = [];
  if (input.changedCount > 0) {
    parts.push(`${plural(input.changedCount, 'chapter')} changed since you last looked`);
  }
  if (input.openComments > 0) {
    parts.push(`${plural(input.openComments, 'comment')} of yours still open`);
  }
  if (parts.length === 0) return `${scale}. Nothing has changed since you last looked.`;
  return `${scale}. ${parts.join(', ')}.`;
}
