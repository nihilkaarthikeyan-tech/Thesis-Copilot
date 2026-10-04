/**
 * ADR-0058 — one email when a long job ends with nobody watching. No network, no Redis, no
 * database: a recording mailer, an in-memory watch store and a two-table fake Prisma.
 */

import type { PrismaClient } from '@tc/db';
import { ConsoleMailer } from '@tc/mail';
import type {
  ChapterBuildJob,
  CoherenceRunJob,
  ExaminerReviewJob,
  SearchLiteratureJob,
} from '@tc/types';
import { describe, expect, it } from 'vitest';
import {
  chapterBuildFinished,
  coherenceFinished,
  emailOptedIn,
  examinerReviewFinished,
  type FinishedJob,
  failedAfterRetries,
  JOB_EMAIL,
  jobEmail,
  notifyJobFinished,
  redisWatchStore,
  searchFinished,
  shouldEmail,
  type WatchStore,
} from '../src/job-email.js';
import type { ChapterBuildResult } from '../src/jobs/chapter-build.js';
import type { ExaminerReviewResult } from '../src/jobs/examiner-review.js';

const T0 = Date.parse('2026-10-04T10:00:00Z');
const APP = 'https://app.example.edu';
const DOC = '0190a000-0000-7000-8000-000000000001';
const USER = '0190a000-0000-7000-8000-000000000002';
const CHAPTER = '0190a000-0000-7000-8000-000000000003';

describe('shouldEmail', () => {
  const base = {
    startedAt: T0,
    finishedAt: T0 + 5 * 60_000,
    lastWatchedAt: null,
    optedIn: true,
    alreadySent: false,
  };

  it('sends for a long job nobody watched', () => {
    expect(shouldEmail(base)).toEqual({ send: true });
  });

  it('does not send for a job shorter than the threshold', () => {
    expect(shouldEmail({ ...base, finishedAt: T0 + JOB_EMAIL.minRunMs - 1 })).toEqual({
      send: false,
      reason: 'short',
    });
    expect(shouldEmail({ ...base, finishedAt: T0 + JOB_EMAIL.minRunMs }).send).toBe(true);
  });

  it('does not send while a visible page polled within the window', () => {
    const finishedAt = base.finishedAt;
    expect(shouldEmail({ ...base, lastWatchedAt: finishedAt - 5_000 })).toEqual({
      send: false,
      reason: 'watched',
    });
    expect(
      shouldEmail({ ...base, lastWatchedAt: finishedAt - JOB_EMAIL.watchedWithinMs }).send,
    ).toBe(true);
  });

  it('respects the setting', () => {
    expect(shouldEmail({ ...base, optedIn: false })).toEqual({ send: false, reason: 'opted-out' });
  });

  it('never sends twice', () => {
    expect(shouldEmail({ ...base, alreadySent: true })).toEqual({
      send: false,
      reason: 'already-sent',
    });
  });

  it('reads the setting as on unless explicitly false', () => {
    expect(emailOptedIn(null)).toBe(true);
    expect(emailOptedIn({})).toBe(true);
    expect(emailOptedIn({ emailWhenJobDone: true })).toBe(true);
    expect(emailOptedIn({ emailWhenJobDone: false })).toBe(false);
  });
});

function memoryWatch(watched: Record<string, number> = {}): WatchStore & { claims: string[] } {
  const claims: string[] = [];
  return {
    claims,
    async lastWatchedAt(runId) {
      return watched[runId] ?? null;
    },
    async claim(runId) {
      if (claims.includes(runId)) return false;
      claims.push(runId);
      return true;
    },
  };
}

function fakePrisma(user: Record<string, unknown> | null, title = 'Tribology of AA7050') {
  return {
    user: { findUnique: async () => user },
    document: { findUnique: async () => ({ title }) },
  } as unknown as PrismaClient;
}

const student = {
  email: 'student@x.edu',
  settings: {},
  deletedAt: null,
  deletionRequestedAt: null,
  suspendedAt: null,
};

function setup(over: { user?: Record<string, unknown> | null; watched?: Record<string, number> }) {
  const mailer = new ConsoleMailer(() => undefined);
  const watch = memoryWatch(over.watched);
  const deps = {
    prisma: fakePrisma(over.user === undefined ? student : over.user),
    mailer,
    watch,
    appUrl: APP,
    now: () => T0 + 3 * 60_000,
  };
  return { mailer, watch, deps };
}

const finished = (over: Partial<FinishedJob> = {}): FinishedJob => ({
  kind: 'search',
  runId: 'run-1',
  userId: USER,
  documentId: DOC,
  startedAt: T0,
  outcome: 'done',
  ...over,
});

describe('notifyJobFinished', () => {
  it('sends one email with a link to the result and a way to turn these off', async () => {
    const { mailer, deps } = setup({});
    expect(await notifyJobFinished(deps, finished())).toEqual({ sent: true, reason: 'sent' });
    expect(mailer.sent).toHaveLength(1);
    const mail = mailer.sent[0];
    expect(mail?.to).toEqual(['student@x.edu']);
    expect(mail?.subject).toBe('Your literature search is ready — Tribology of AA7050');
    expect(mail?.text).toContain(`${APP}/app/d/${DOC}/sources?tab=discover`);
    expect(mail?.text).toContain(`${APP}/app/settings`);
    // Plain text, one link to the result and one to the settings, nothing else.
    expect(mail?.text.match(/https?:\/\//g)).toHaveLength(2);
  });

  it('sends only once per run, whoever asks', async () => {
    const { mailer, deps } = setup({});
    await notifyJobFinished(deps, finished());
    expect(await notifyJobFinished(deps, finished())).toEqual({
      sent: false,
      reason: 'already-sent',
    });
    expect(mailer.sent).toHaveLength(1);
  });

  it('stays quiet when the page was being looked at', async () => {
    const { mailer, deps } = setup({ watched: { 'run-1': T0 + 3 * 60_000 - 4_000 } });
    expect((await notifyJobFinished(deps, finished())).reason).toBe('watched');
    expect(mailer.sent).toEqual([]);
  });

  it('does not claim a run it did not send for', async () => {
    const { watch, deps } = setup({ watched: { 'run-1': T0 + 3 * 60_000 - 4_000 } });
    await notifyJobFinished(deps, finished());
    expect(watch.claims).toEqual([]);
  });

  it('stays quiet when the student turned it off', async () => {
    const { mailer, deps } = setup({ user: { ...student, settings: { emailWhenJobDone: false } } });
    expect((await notifyJobFinished(deps, finished())).reason).toBe('opted-out');
    expect(mailer.sent).toEqual([]);
  });

  it('stays quiet for a short job', async () => {
    const { mailer, deps } = setup({});
    const result = await notifyJobFinished(deps, finished({ startedAt: T0 + 3 * 60_000 - 10_000 }));
    expect(result.reason).toBe('short');
    expect(mailer.sent).toEqual([]);
  });

  it('does not write to a suspended, deleted or leaving account', async () => {
    for (const user of [
      { ...student, suspendedAt: new Date() },
      { ...student, deletedAt: new Date() },
      { ...student, deletionRequestedAt: new Date() },
      null,
    ]) {
      const { mailer, deps } = setup({ user });
      expect((await notifyJobFinished(deps, finished())).reason).toBe('no-recipient');
      expect(mailer.sent).toEqual([]);
    }
  });

  it('never throws: a mail fault is logged and the job stands', async () => {
    const { deps } = setup({});
    const events: Array<Record<string, unknown>> = [];
    const result = await notifyJobFinished(
      {
        ...deps,
        mailer: {
          send: async () => {
            throw new Error('smtp down');
          },
        },
        log: (e) => events.push(e),
      },
      finished(),
    );
    expect(result).toEqual({ sent: false, reason: 'error' });
    expect(events[0]).toMatchObject({ msg: 'job email not sent', error: 'smtp down' });
  });
});

describe('the email', () => {
  it('says a refunded failure cost nothing, and only then', () => {
    const refunded = jobEmail(
      finished({ kind: 'chapter-build', outcome: 'failed', refunded: true }),
      'T',
      APP,
    );
    expect(refunded.subject).toBe('Your chapter build did not finish — T');
    expect(refunded.text).toContain('Nothing was charged');
    const notRefunded = jobEmail(finished({ kind: 'coherence', outcome: 'failed' }), 'T', APP);
    expect(notRefunded.text).not.toMatch(/charged|allowance/);
  });

  it('links each job to its own page', () => {
    const link = (job: Partial<FinishedJob>) => jobEmail(finished(job), 'T', `${APP}/`).text;
    expect(link({ kind: 'chapter-build' })).toContain(`${APP}/app/d/${DOC}/build\n`);
    expect(link({ kind: 'examiner-review', chapterId: CHAPTER })).toContain(
      `${APP}/app/d/${DOC}/write/${CHAPTER}`,
    );
    expect(link({ kind: 'coherence', chapterId: CHAPTER })).toContain(
      `${APP}/app/d/${DOC}/write/${CHAPTER}`,
    );
    expect(link({ kind: 'coherence' })).toContain(`${APP}/app/d/${DOC}/outline`);
  });
});

describe('each job’s call site', () => {
  const searchJob: SearchLiteratureJob = {
    documentId: DOC,
    userId: USER,
    runId: 's1',
    mode: 'discover',
  };
  const buildJob = {
    documentId: DOC,
    userId: USER,
    buildId: 'b1',
    chapterId: CHAPTER,
  } as ChapterBuildJob;
  const reviewJob: ExaminerReviewJob = {
    documentId: DOC,
    chapterId: CHAPTER,
    userId: USER,
    runId: 'r1',
    version: 3,
  };
  const coherenceJob: CoherenceRunJob = {
    documentId: DOC,
    userId: USER,
    runId: 'c1',
    triggeredBy: 'MANUAL',
  };
  const build = (over: Partial<ChapterBuildResult>): ChapterBuildResult => ({
    buildId: 'b1',
    status: 'DONE',
    sections: 4,
    drafted: 4,
    blockingOpen: 0,
    spentInr: 9,
    ...over,
  });
  const review = (over: Partial<ExaminerReviewResult>): ExaminerReviewResult => ({
    runId: 'r1',
    status: 'DONE',
    sections: 3,
    sectionsReviewed: 3,
    failedSections: [],
    issues: 5,
    blocking: 1,
    flagsWritten: 5,
    spentInr: 2,
    ...over,
  });

  async function send(job: FinishedJob | null) {
    const { mailer, deps } = setup({});
    if (job) await notifyJobFinished(deps, job);
    return mailer.sent;
  }

  it('search: what it found', async () => {
    const sent = await send(
      searchFinished(
        searchJob,
        { runId: 's1', mode: 'discover', candidates: 48, themes: 6, counts: {} },
        T0,
      ),
    );
    expect(sent[0]?.text).toContain('It found 48 papers in 6 themes.');
  });

  it('chapter build: delivered, refused with the unit back, or skipped', async () => {
    expect((await send(chapterBuildFinished(buildJob, build({}), T0)))[0]?.text).toContain(
      '4 sections are waiting in your chapter as drafts',
    );
    const refused = await send(
      chapterBuildFinished(buildJob, build({ status: 'REFUSED', drafted: 0, refunded: true }), T0),
    );
    expect(refused[0]?.subject).toContain('did not finish');
    expect(refused[0]?.text).toContain('the chapter build went back to your monthly allowance');
    const unrefunded = await send(
      chapterBuildFinished(buildJob, build({ status: 'FAILED', refunded: false }), T0),
    );
    expect(unrefunded[0]?.text).not.toContain('charged');
    expect(
      chapterBuildFinished(buildJob, build({ status: 'FAILED', skipped: true }), T0),
    ).toBeNull();
  });

  it('examiner review: the issues, a refunded failure, and a skipped run', async () => {
    expect((await send(examinerReviewFinished(reviewJob, review({}), T0)))[0]?.text).toContain(
      'The examiner raised 5 issues (1 blocking)',
    );
    const failed = await send(
      examinerReviewFinished(reviewJob, review({ status: 'FAILED', refunded: true }), T0),
    );
    expect(failed[0]?.text).toContain('Nothing was charged');
    expect(examinerReviewFinished(reviewJob, review({ status: 'SKIPPED' }), T0)).toBeNull();
  });

  it('coherence: only a run the student started', async () => {
    const result = {
      runId: 'c1',
      chaptersChecked: 2,
      chaptersRelated: 1,
      flags: 7,
      byType: {},
      reducedScope: false,
      estimatedInr: 1,
    };
    const sent = await send(coherenceFinished(coherenceJob, result, T0, CHAPTER));
    expect(sent[0]?.text).toContain('It raised 7 flags');
    expect(
      coherenceFinished({ ...coherenceJob, triggeredBy: 'AUTOSAVE' }, result, T0, CHAPTER),
    ).toBeNull();
  });

  it('a search or coherence check that failed for good says so, and claims no refund', async () => {
    const search = await send(failedAfterRetries('search-literature', searchJob, T0, null));
    expect(search[0]?.subject).toBe('Your literature search did not finish — Tribology of AA7050');
    expect(search[0]?.text).not.toContain('charged');
    const coherence = await send(failedAfterRetries('coherence', coherenceJob, T0, CHAPTER));
    expect(coherence[0]?.subject).toContain('coherence check did not finish');
    expect(
      failedAfterRetries('coherence', { ...coherenceJob, triggeredBy: 'FEEDBACK' }, T0, null),
    ).toBeNull();
    expect(failedAfterRetries('index-source', searchJob, T0, null)).toBeNull();
  });
});

describe('redisWatchStore', () => {
  it('reads the heartbeat and claims a run once', async () => {
    const data = new Map<string, string>([['job-watch:run-1', String(T0)]]);
    const store = redisWatchStore({
      get: async (key) => data.get(key) ?? null,
      set: async (key, value) => {
        if (data.has(key)) return null;
        data.set(key, value);
        return 'OK';
      },
    });
    expect(await store.lastWatchedAt('run-1')).toBe(T0);
    expect(await store.lastWatchedAt('run-2')).toBeNull();
    expect(await store.claim('run-1')).toBe(true);
    expect(await store.claim('run-1')).toBe(false);
  });
});
