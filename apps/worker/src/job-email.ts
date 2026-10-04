/**
 * "We will email you when it is ready" — ADR-0058, coverage-map row 64.
 *
 * Jenni tells a student a long job is safe to close. Ours made them keep the tab open and watch.
 * Now, when a long job the student started ends — a literature search, a chapter build, an
 * examiner review or a coherence check — the worker sends one short email with a link back to the
 * result, but only when all of these hold:
 *
 * - the job took longer than `JOB_EMAIL.minRunMs` (a minute) from the press to the end;
 * - no visible page has polled it for `JOB_EMAIL.watchedWithinMs` (the `job-watch:<runId>`
 *   heartbeat the API writes, `@tc/types` `jobWatchKey`) — a student looking at it needs no mail;
 * - the student has not turned "Email me when a long job finishes" off (`User.settings`);
 * - no email has gone for this run yet (a Redis `SET NX` claim, so a retry or a second worker
 *   cannot send a second one).
 *
 * The worker sends it because the worker owns terminal job state (CLAUDE.md): it is the one place
 * that knows the job ended, whoever is or is not watching. Nothing here may fail the job — a mail
 * fault is logged and swallowed.
 */

import type { PrismaClient } from '@tc/db';
import type { Mailer } from '@tc/mail';
import {
  type ChapterBuildJob,
  type CoherenceRunJob,
  type ExaminerReviewJob,
  jobWatchKey,
  type SearchLiteratureJob,
} from '@tc/types';
import type { ChapterBuildResult } from './jobs/chapter-build.js';
import type { CoherenceRunResult } from './jobs/coherence-run.js';
import type { ExaminerReviewResult } from './jobs/examiner-review.js';
import type { SearchLiteratureResult } from './jobs/search-literature.js';

export const JOB_EMAIL = {
  /** Shorter jobs finish while the student is still on the page; no mail for those. */
  minRunMs: 60_000,
  /** A poll from a visible tab within this long means someone is looking. */
  watchedWithinMs: 30_000,
  /** How long the "already sent" claim is kept: far longer than any retry. */
  claimTtlSeconds: 7 * 24 * 3600,
} as const;

export type JobKind = 'search' | 'chapter-build' | 'examiner-review' | 'coherence';

export type EmailDecision =
  | { send: true }
  | { send: false; reason: 'short' | 'watched' | 'opted-out' | 'already-sent' };

/** The pure rule. Times are epoch milliseconds; `lastWatchedAt` is null when nobody polled. */
export function shouldEmail(input: {
  startedAt: number;
  finishedAt: number;
  lastWatchedAt: number | null;
  optedIn: boolean;
  alreadySent: boolean;
}): EmailDecision {
  if (input.alreadySent) return { send: false, reason: 'already-sent' };
  if (!input.optedIn) return { send: false, reason: 'opted-out' };
  if (input.finishedAt - input.startedAt < JOB_EMAIL.minRunMs) {
    return { send: false, reason: 'short' };
  }
  if (
    input.lastWatchedAt !== null &&
    input.finishedAt - input.lastWatchedAt < JOB_EMAIL.watchedWithinMs
  ) {
    return { send: false, reason: 'watched' };
  }
  return { send: true };
}

/** Default on: only an explicit `false` turns the emails off. */
export function emailOptedIn(settings: unknown): boolean {
  return (settings as { emailWhenJobDone?: unknown } | null)?.emailWhenJobDone !== false;
}

/** The heartbeat and the once-per-run claim. Redis in the worker; a map in tests. */
export type WatchStore = {
  lastWatchedAt(runId: string): Promise<number | null>;
  /** True exactly once per run: the caller that gets true sends the email. */
  claim(runId: string): Promise<boolean>;
};

/** The part of ioredis `WatchStore` uses. */
export type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ex: 'EX', seconds: number, nx: 'NX'): Promise<'OK' | null>;
};

export function redisWatchStore(redis: RedisLike): WatchStore {
  return {
    async lastWatchedAt(runId) {
      const value = await redis.get(jobWatchKey(runId));
      const at = value === null ? Number.NaN : Number(value);
      return Number.isFinite(at) ? at : null;
    },
    async claim(runId) {
      const ok = await redis.set(
        `job-email:${runId}`,
        String(Date.now()),
        'EX',
        JOB_EMAIL.claimTtlSeconds,
        'NX',
      );
      return ok === 'OK';
    },
  };
}

export type FinishedJob = {
  kind: JobKind;
  runId: string;
  userId: string;
  documentId: string;
  /** Examiner review and coherence: the chapter the link opens (the flags are beside it). */
  chapterId?: string;
  /** When the student pressed the button: BullMQ's `job.timestamp`. */
  startedAt: number;
  outcome: 'done' | 'failed';
  /**
   * Failure only: true when this run gave its unit back to the student's monthly allowance, which
   * is the one case the email may say so. False or absent says nothing about charges.
   */
  refunded?: boolean;
  /** One plain sentence about what it produced, from counts the job observed. */
  summary?: string;
};

export type JobEmailDeps = {
  prisma: PrismaClient;
  mailer: Mailer;
  watch: WatchStore;
  appUrl: string;
  now?: () => number;
  log?: (event: Record<string, unknown>) => void;
};

const WHAT: Record<JobKind, string> = {
  search: 'literature search',
  'chapter-build': 'chapter build',
  'examiner-review': 'examiner review',
  coherence: 'coherence check',
};

const ALLOWANCE: Record<JobKind, string> = {
  search: 'search',
  'chapter-build': 'chapter build',
  'examiner-review': 'examiner review',
  coherence: 'coherence check',
};

/** The page the result is on. */
export function resultPath(job: Pick<FinishedJob, 'kind' | 'documentId' | 'chapterId'>): string {
  const base = `/app/d/${job.documentId}`;
  switch (job.kind) {
    case 'search':
      return `${base}/sources?tab=discover`;
    case 'chapter-build':
      return `${base}/build`;
    case 'examiner-review':
    case 'coherence':
      // The flags are in the editor's Flags tab; a thesis with no chapter has no editor to open.
      return job.chapterId ? `${base}/write/${job.chapterId}` : `${base}/outline`;
  }
}

/** The email itself: plain text, one link to the result, one to turn these off. No tracking. */
export function jobEmail(
  job: FinishedJob,
  thesisTitle: string,
  appUrl: string,
): { subject: string; text: string } {
  const what = WHAT[job.kind];
  const origin = appUrl.replace(/\/+$/, '');
  const title = thesisTitle.trim() || 'your thesis';
  const link = `${origin}${resultPath(job)}`;
  const lines: string[] = [];
  let subject: string;
  if (job.outcome === 'done') {
    subject = `Your ${what} is ready — ${title}`;
    lines.push(`The ${what} you started on "${title}" has finished.`);
    if (job.summary) lines.push(job.summary);
    lines.push('', `See it here: ${link}`);
  } else {
    subject = `Your ${what} did not finish — ${title}`;
    lines.push(`The ${what} you started on "${title}" did not finish.`);
    if (job.refunded) {
      lines.push(
        `Nothing was charged: the ${ALLOWANCE[job.kind]} went back to your monthly allowance.`,
      );
    }
    lines.push('', `You can see what happened and start it again here: ${link}`);
  }
  lines.push(
    '',
    'We send this when a long job finishes while its page is closed. To stop these emails, turn off',
    `"Email me when a long job finishes" in your settings: ${origin}/app/settings`,
    '',
    'Thesis Copilot',
  );
  return { subject, text: lines.join('\n') };
}

/**
 * Decides and, if the rule says so, sends. Never throws: whatever goes wrong is logged and the
 * job's own result stands.
 */
export async function notifyJobFinished(
  deps: JobEmailDeps,
  job: FinishedJob,
): Promise<{ sent: boolean; reason: string }> {
  const log = deps.log ?? (() => undefined);
  const now = deps.now ?? Date.now;
  try {
    const finishedAt = now();
    const user = await deps.prisma.user.findUnique({
      where: { id: job.userId },
      select: {
        email: true,
        settings: true,
        deletedAt: true,
        deletionRequestedAt: true,
        suspendedAt: true,
      },
    });
    if (!user?.email || user.deletedAt || user.deletionRequestedAt || user.suspendedAt) {
      return { sent: false, reason: 'no-recipient' };
    }

    const decision = shouldEmail({
      startedAt: job.startedAt,
      finishedAt,
      lastWatchedAt: await deps.watch.lastWatchedAt(job.runId),
      optedIn: emailOptedIn(user.settings),
      alreadySent: false,
    });
    if (!decision.send) return { sent: false, reason: decision.reason };
    // Claimed last, so a run that did not qualify can still be sent for if a retry later does.
    if (!(await deps.watch.claim(job.runId))) return { sent: false, reason: 'already-sent' };

    const document = await deps.prisma.document.findUnique({
      where: { id: job.documentId },
      select: { title: true },
    });
    const mail = jobEmail(job, document?.title ?? '', deps.appUrl);
    await deps.mailer.send({ to: [user.email], ...mail });
    log({ msg: 'job email sent', kind: job.kind, runId: job.runId, outcome: job.outcome });
    return { sent: true, reason: 'sent' };
  } catch (error) {
    log({
      level: 40,
      msg: 'job email not sent',
      kind: job.kind,
      runId: job.runId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, reason: 'error' };
  }
}

// --------------------------------------------------------------------------------------------
// Per job: what finished, from the job's payload and its own result. Null means "no email for
// this one" (a skipped or superseded run, or a coherence run the student did not start).
// --------------------------------------------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function searchFinished(
  job: SearchLiteratureJob,
  result: SearchLiteratureResult,
  startedAt: number,
): FinishedJob {
  return {
    kind: 'search',
    runId: job.runId,
    userId: job.userId,
    documentId: job.documentId,
    startedAt,
    outcome: 'done',
    summary: `It found ${plural(result.candidates, 'paper')} in ${plural(result.themes, 'theme')}. Nothing is added to your library until you pick it.`,
  };
}

export function chapterBuildFinished(
  job: ChapterBuildJob,
  result: ChapterBuildResult,
  startedAt: number,
): FinishedJob | null {
  if (result.skipped) return null;
  const done = result.status === 'DONE';
  return {
    kind: 'chapter-build',
    runId: job.buildId,
    userId: job.userId,
    documentId: job.documentId,
    startedAt,
    outcome: done ? 'done' : 'failed',
    refunded: !done && result.refunded === true,
    ...(done
      ? {
          summary: `${plural(result.drafted, 'section')} ${result.drafted === 1 ? 'is' : 'are'} waiting in your chapter as drafts for you to accept or reject, with the QA report beside them.`,
        }
      : {}),
  };
}

export function examinerReviewFinished(
  job: ExaminerReviewJob,
  result: ExaminerReviewResult,
  startedAt: number,
): FinishedJob | null {
  if (result.status === 'SKIPPED') return null;
  const done = result.status === 'DONE';
  return {
    kind: 'examiner-review',
    runId: job.runId,
    userId: job.userId,
    documentId: job.documentId,
    chapterId: job.chapterId,
    startedAt,
    outcome: done ? 'done' : 'failed',
    refunded: !done && result.refunded === true,
    ...(done
      ? {
          summary: `The examiner raised ${plural(result.issues, 'issue')} (${result.blocking} blocking), each a flag on its sentence in the Flags tab.`,
        }
      : {}),
  };
}

export function coherenceFinished(
  job: CoherenceRunJob,
  result: CoherenceRunResult,
  startedAt: number,
  chapterId: string | null,
): FinishedJob | null {
  // An autosave or feedback run was not started by the student; they were not waiting on it.
  if (job.triggeredBy !== 'MANUAL') return null;
  return {
    kind: 'coherence',
    runId: job.runId,
    userId: job.userId,
    documentId: job.documentId,
    ...(chapterId ? { chapterId } : {}),
    startedAt,
    outcome: 'done',
    summary: result.skipped
      ? 'Nothing had changed since the last check, so there was nothing new to flag.'
      : `It raised ${plural(result.flags, 'flag')}, listed in the Flags tab.`,
  };
}

/**
 * A search or coherence job that threw on its last attempt (the other two never throw: they
 * write FAILED and refund themselves). No refund happens on this path, so the email claims none.
 */
export function failedAfterRetries(
  queue: string,
  data: unknown,
  startedAt: number,
  chapterId: string | null,
): FinishedJob | null {
  const job = data as Partial<SearchLiteratureJob & CoherenceRunJob>;
  if (!job.runId || !job.userId || !job.documentId) return null;
  if (queue === 'search-literature') {
    return {
      kind: 'search',
      runId: job.runId,
      userId: job.userId,
      documentId: job.documentId,
      startedAt,
      outcome: 'failed',
    };
  }
  if (queue === 'coherence' && job.triggeredBy === 'MANUAL') {
    return {
      kind: 'coherence',
      runId: job.runId,
      userId: job.userId,
      documentId: job.documentId,
      ...(chapterId ? { chapterId } : {}),
      startedAt,
      outcome: 'failed',
    };
  }
  return null;
}
