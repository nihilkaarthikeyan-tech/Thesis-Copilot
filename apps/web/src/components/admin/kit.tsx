'use client';

/**
 * The small pieces every admin screen shares (2026-09-29): plain-word names for the log's event
 * kinds and the plans, the formatters, a status badge and a modal dialog. The owner reads these
 * screens, not an engineer, so a code such as `USER_SUSPENDED` is never shown on its own.
 */

import { Badge } from '@/components/ui/primitives';
import { actionName } from '@/lib/action-names';

export { Dialog } from '@/components/ui/dialog';

export const inr = (value: number) =>
  `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const whole = (value: number) => value.toLocaleString('en-IN');

export function when(iso: string | null | undefined): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function day(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "2 h ago", "yesterday", "3 Sep" — for lists where the exact minute does not matter. */
export function ago(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'never';
  const ms = now - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return day(iso);
}

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export const PLAN_NAMES: Record<string, string> = {
  FREE_TRIAL: 'Free trial',
  STUDENT_MONTHLY: 'Student · monthly',
  STUDENT_ANNUAL: 'Student · annual',
  INSTITUTION_SEAT: 'Institution seat',
};
export const planName = (plan: string) => PLAN_NAMES[plan] ?? plan;

/** "4 days left", "ends today", "ended 2 Oct" — a free trial's state in a few words (ADR-0036). */
export function trialWords(endsAt: string | null | undefined, now: number = Date.now()): string {
  if (!endsAt) return '';
  const ms = new Date(endsAt).getTime() - now;
  if (ms <= 0) return `ended ${day(endsAt)}`;
  const days = Math.ceil(ms / 86_400_000);
  return days <= 1 ? 'ends today' : `${days} days left`;
}

export const trialOver = (endsAt: string | null | undefined, now: number = Date.now()) =>
  Boolean(endsAt && new Date(endsAt).getTime() <= now);

export const ROLE_NAMES: Record<string, string> = {
  STUDENT: 'Student',
  GUIDE: 'Guide',
  INSTITUTION_ADMIN: 'Institution admin',
  SUPERADMIN: 'Super admin',
};
export const roleName = (role: string) => ROLE_NAMES[role] ?? role;

export type UserStatus = 'active' | 'suspended' | 'deleting' | 'deleted';

export function StatusBadge({ status }: { status: UserStatus }) {
  switch (status) {
    case 'suspended':
      return <Badge tone="danger">Suspended</Badge>;
    case 'deleting':
      return <Badge tone="warn">Deletion pending</Badge>;
    case 'deleted':
      return <Badge>Deleted</Badge>;
    default:
      return <Badge tone="ok">Active</Badge>;
  }
}

/** The activity log's kinds in words. Anything not listed is shown as written, lower-cased. */
export const EVENT_NAMES: Record<string, string> = {
  ALLOWANCE_GRANTED: 'Extra allowance given',
  BILLING_EVENT: 'Billing',
  CAPS_RESET: 'Monthly limits reset',
  CAP_EXCEEDED: 'Monthly limit reached',
  CEILING_EXCEEDED: '₹100 limit reached',
  CHAPTER_VIEWED: 'Chapter read by an admin',
  DELETION_CANCELLED: 'Account deletion cancelled',
  DELETION_COMPLETED: 'Account erased',
  DELETION_REQUESTED: 'Account deletion requested',
  DOCUMENT_DELETED: 'Thesis deleted',
  EMAIL_CHANGED: 'Email address changed',
  EXPORT_OVERRIDE: 'Export check overridden',
  FEEDBACK: 'Feedback sent',
  INSTITUTION_CREATED: 'Institution created',
  INSTITUTION_SEAT_RELEASED: 'Institution seat released',
  INSTITUTION_SEAT_TAKEN: 'Institution seat taken',
  PASSWORD_RESET: 'Password reset',
  PITFALL_APPROVED: 'Pitfall approved',
  PITFALL_EDITED: 'Pitfall edited',
  PITFALL_RETIRED: 'Pitfall retired',
  PLAN_CHANGED: 'Plan changed',
  PLATFORM_BUDGET_CHANGED: 'Site budget changed',
  PLATFORM_CEILING_EXCEEDED: 'Site budget reached',
  PRIVACY_NOTICE_SENT: 'Privacy notice emailed',
  ROLE_CHANGED: 'Role changed',
  SESSIONS_REVOKED: 'Signed out of every device',
  THESIS_VIEWED: 'Thesis opened by an admin',
  TRIAL_EXTENDED: 'Free trial extended',
  TRIAL_EXEMPTED: 'No trial end (account from before the trial)',
  USER_SUSPENDED: 'Suspended',
  USER_UNSUSPENDED: 'Unsuspended',
};

export const eventName = (kind: string) =>
  EVENT_NAMES[kind] ?? kind.replaceAll('_', ' ').toLowerCase();

/** One line saying what an event's detail means, for the log. */
export function describeEvent(kind: string, detail: unknown): string {
  const d = (detail ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  switch (kind) {
    case 'ALLOWANCE_GRANTED':
      return `+${str(d.units)} ${actionName(str(d.action)).toLowerCase()} for ${str(d.period)}${d.reason ? ` · “${str(d.reason)}”` : ''}`;
    case 'USER_SUSPENDED':
      return d.reason ? `“${str(d.reason)}”` : '';
    case 'ROLE_CHANGED':
      return `${roleName(str(d.from))} → ${roleName(str(d.to))}`;
    case 'PLAN_CHANGED':
      return `${planName(str(d.from))} → ${planName(str(d.to))}`;
    case 'THESIS_VIEWED':
      return `“${str(d.title)}”, read-only${d.emailed ? ' · student emailed' : ''}`;
    case 'TRIAL_EXTENDED':
      return `+${str(d.days)} days, until ${day(str(d.to))}${d.reason ? ` · “${str(d.reason)}”` : ''}`;
    case 'CHAPTER_VIEWED':
      return `“${str(d.title)}”`;
    case 'PITFALL_APPROVED':
    case 'PITFALL_EDITED':
    case 'PITFALL_RETIRED':
      return str(d.code);
    case 'DOCUMENT_DELETED':
      return `“${str(d.title)}”${d.by === 'admin' ? ' by an admin' : d.by === 'owner' ? ' by the student' : ''}${d.reason ? ` · “${str(d.reason)}”` : ''}`;
    case 'DELETION_REQUESTED':
      return d.erasesAt ? `erases on ${day(str(d.erasesAt))}` : '';
    case 'CAPS_RESET':
      return Array.isArray(d.reset) && d.reset.length ? `${d.reset.length} counter(s) zeroed` : '';
    case 'PLATFORM_BUDGET_CHANGED':
      return d.to === null ? 'switched off' : d.to !== undefined ? `₹${str(d.to)} a month` : '';
    case 'FEEDBACK':
      return str(d.message).slice(0, 120);
    case 'CAP_EXCEEDED':
      return actionName(str(d.action));
    case 'BILLING_EVENT':
      return [str(d.event), str(d.status)].filter(Boolean).join(' · ');
    default:
      return '';
  }
}

/** Kinds written without an actor that the student themselves caused. */
const BY_THE_STUDENT = new Set([
  'FEEDBACK',
  'DELETION_REQUESTED',
  'DELETION_CANCELLED',
  'EMAIL_CHANGED',
  'PASSWORD_RESET',
]);

/** Who did it, for the log's "By" column. */
export function byWhom(e: {
  kind: string;
  actorId: string | null;
  actorEmail: string | null;
  userId?: string | null;
}): string {
  if (e.actorId === null) {
    if (BY_THE_STUDENT.has(e.kind)) return 'the student';
    if (e.kind === 'BILLING_EVENT') return 'billing';
    return 'system';
  }
  if (e.userId && e.actorId === e.userId) return 'the student';
  return e.actorEmail ?? 'an admin';
}

export function problemText(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'problem' in e) {
    const p = (e as { problem: { detail?: string; title?: string } }).problem;
    return p.detail ?? p.title ?? fallback;
  }
  return fallback;
}
