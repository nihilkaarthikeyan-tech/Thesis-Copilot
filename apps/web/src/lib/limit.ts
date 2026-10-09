/**
 * The limit message (R31, ADR-0122): one plain message for every action a monthly allowance, the
 * end of the free trial, the ₹100 ceiling or the site's budget refuses, on every screen. It says
 * which allowance, how many of it were used of how many, the date it resets in the student's own
 * calendar, and where to go next. Jenni's wall said none of that (inventory §13.6).
 *
 * Built from the refusal's extension members (`action`, `allowance`, `used`, `cap`, `resetsAt`,
 * `trialEndedAt` — `apps/api/src/common/errors.ts`), never from `detail`. A screen gets the
 * refusal with `limitRefusal(error)` and shows it with `<LimitNotice>`.
 */

import { ALLOWANCE_NAMES } from '@tc/config';
import { type MessageKey, tNow } from '../i18n';
import { ApiError } from './api';

/** The problem types that mean "a limit refused this", as opposed to a fault. */
export const LIMIT_TYPES = ['CAP_EXCEEDED', 'CEILING_EXCEEDED', 'PLATFORM_CEILING_EXCEEDED'];

export type LimitRefusal =
  /** A monthly allowance used up: `used` of `cap` this month. */
  | { kind: 'cap'; allowance: string; used: number; cap: number; resetsAt: string | null }
  /** An allowance the plan does not include at all (a cap of 0). */
  | { kind: 'notIncluded'; allowance: string }
  /** The 14-day free trial is over (ADR-0036); nothing resets. */
  | { kind: 'trial'; endedAt: string | null }
  /** The student's own ₹100 of AI this month (PRD §11), which can arrive with units left. */
  | { kind: 'ceiling'; resetsAt: string | null }
  /** The site's monthly AI budget, which is not the student's doing. */
  | { kind: 'platform'; resetsAt: string | null };

export type LimitText = {
  title: string;
  body: string;
  /** Where to go next: the usage table and plans, or the pricing page. None for the site budget. */
  link: { href: string; label: string } | null;
};

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * The limit behind a refused request, or null for any other failure. Takes what a screen has in
 * its `catch`: an `ApiError`, a problem-details body, or an object carrying one as `problem`
 * (the suggestion stream's error event).
 */
export function limitRefusal(source: unknown): LimitRefusal | null {
  const problem =
    source instanceof ApiError
      ? (source.problem as Record<string, unknown>)
      : (record(record(source)?.problem) ?? record(source));
  if (!problem || !LIMIT_TYPES.includes(String(problem.type))) return null;

  const resetsAt = str(problem.resetsAt);
  if (problem.type === 'PLATFORM_CEILING_EXCEEDED') return { kind: 'platform', resetsAt };
  if (problem.type === 'CEILING_EXCEEDED') return { kind: 'ceiling', resetsAt };
  if (problem.trialEnded === true) return { kind: 'trial', endedAt: str(problem.trialEndedAt) };

  const action = str(problem.action);
  const allowance =
    str(problem.allowance) ?? (action ? ALLOWANCE_NAMES[action] : undefined) ?? 'AI actions';
  const cap = num(problem.cap) ?? 0;
  if (cap <= 0) return { kind: 'notIncluded', allowance };
  // An API from before R31 sends no `used`; a refusal at the cap means every unit was used.
  return { kind: 'cap', allowance, used: num(problem.used) ?? cap, cap, resetsAt };
}

/**
 * A reset moment in the student's own calendar. Caps reset at 00:00 UTC on the 1st, which is the
 * 1st in India (05:30) but the evening of the 31st west of Greenwich; there the time is shown too,
 * so "Oct 31" is not read as a whole day early. The usage menu uses the same words.
 */
export function formatResetDate(
  iso: string,
  options: { locale?: string; timeZone?: string } = {},
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const zone = options.timeZone ? { timeZone: options.timeZone } : {};
  const dayOfMonth = Number(
    new Intl.DateTimeFormat('en-US', { day: 'numeric', ...zone }).format(date),
  );
  return new Intl.DateTimeFormat(options.locale, {
    dateStyle: 'medium',
    ...(dayOfMonth === 1 ? {} : { timeStyle: 'short' }),
    ...zone,
  }).format(date);
}

/** A day, without the time, for the date a trial ended. */
function formatDay(iso: string, options: { locale?: string; timeZone?: string }): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(options.locale, {
    dateStyle: 'medium',
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  }).format(date);
}

/** The words of the message. One place, so every screen says exactly the same thing. */
export function limitText(
  limit: LimitRefusal,
  options: { locale?: string; timeZone?: string } = {},
): LimitText {
  // In the interface's language (`tNow`); English wherever a key has no translation.
  const stillWorks = tNow('limit.stillWorks');
  const usageLink = { href: '/app/account', label: tNow('limit.usageLink') };
  const plansLink = { href: '/pricing', label: tNow('limit.plansLink') };
  const resets = (iso: string | null, on: MessageKey, nextMonth: MessageKey) =>
    iso ? tNow(on, { date: formatResetDate(iso, options) }) : tNow(nextMonth);
  switch (limit.kind) {
    case 'cap':
      return {
        title: tNow('limit.cap.title'),
        body: `${tNow('limit.cap.used', { allowance: limit.allowance, used: limit.used, cap: limit.cap })} ${resets(limit.resetsAt, 'limit.resetsOn', 'limit.resetsNextMonth')} ${stillWorks}`,
        link: usageLink,
      };
    case 'notIncluded':
      return {
        title: tNow('limit.notIncluded.title'),
        body: `${tNow('limit.notIncluded.body', { allowance: limit.allowance })} ${stillWorks}`,
        link: plansLink,
      };
    case 'trial':
      return {
        title: tNow('limit.trial.title'),
        body: `${limit.endedAt ? tNow('limit.trial.endedOn', { date: formatDay(limit.endedAt, options) }) : tNow('limit.trial.ended')} ${tNow('limit.trial.safe')}`,
        link: plansLink,
      };
    case 'ceiling':
      return {
        title: tNow('limit.ceiling.title'),
        body: `${tNow('limit.ceiling.body')} ${resets(limit.resetsAt, 'limit.ceiling.resetsOn', 'limit.ceiling.resetsNextMonth')} ${stillWorks}`,
        link: usageLink,
      };
    case 'platform':
      return {
        title: tNow('limit.platform.title'),
        body: `${tNow('limit.platform.body')} ${resets(limit.resetsAt, 'limit.platform.returnsOn', 'limit.platform.returnsNextMonth')} ${tNow('limit.platform.notYours')} ${stillWorks}`,
        link: null,
      };
  }
}

/** The whole message as one line, for a screen reader's label and the tests. */
export function limitLine(
  limit: LimitRefusal,
  options: { locale?: string; timeZone?: string } = {},
): string {
  const text = limitText(limit, options);
  return `${text.title}. ${text.body}`;
}

/** The editor's message strip, carrying a limit: drawn as `<LimitNotice>`, read as `text`. */
export type LimitNoticeMessage = { text: string; action: null; limit: LimitRefusal };

export const limitNotice = (limit: LimitRefusal): LimitNoticeMessage => ({
  text: limitLine(limit),
  action: null,
  limit,
});
