/**
 * "Am I ready to submit, and how long have I got?" (2026-09-21)
 *
 * The ten compliance checks (Appendix D.3.3) already decide whether a thesis *may* be exported as
 * a PDF. What they could never say is whether a failure was a crisis or a Tuesday, because nothing
 * in the product knew when the thesis was due.
 *
 * This joins the two. The checks are unchanged and this gates nothing extra — `exportThesis` still
 * owns the refusal. What this adds is the sentence a student actually needs: *eight of ten pass,
 * you have eleven days, and here is the one that will take longest.*
 *
 * ## Why urgency is computed here and not in the browser
 *
 * "Days left" from a browser clock is the student's device timezone, which is not the university's
 * and is not the timezone the deadline was written in. Both sides are compared as calendar dates
 * in UTC, which is the same convention the caps already reset on (§0.2).
 */

/** What the readiness screen needs from a compliance run, without importing the whole shape. */
export type CheckSummary = { check: string; label: string; passed: boolean; findingCount: number };

export type Readiness = {
  passed: number;
  total: number;
  /** null when no deadline is set — most of this still works without one. */
  daysLeft: number | null;
  deadline: string | null;
  urgency: 'none' | 'comfortable' | 'soon' | 'urgent' | 'overdue';
  /** The failing checks, worst first. */
  blocking: CheckSummary[];
  headline: string;
};

/**
 * How close is close.
 *
 * Chosen around how long the *work* takes, not around round numbers: a failing word count or a
 * missing abstract is days of writing, not an afternoon, so "soon" starts at three weeks rather
 * than at one.
 */
export const URGENCY_DAYS = { urgent: 7, soon: 21 } as const;

/** Whole days between two calendar dates, in UTC — see the note above on timezones. */
export function daysBetween(from: Date, to: Date): number {
  const day = 24 * 60 * 60 * 1000;
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / day);
}

export function urgencyOf(daysLeft: number | null): Readiness['urgency'] {
  if (daysLeft === null) return 'none';
  if (daysLeft < 0) return 'overdue';
  if (daysLeft <= URGENCY_DAYS.urgent) return 'urgent';
  if (daysLeft <= URGENCY_DAYS.soon) return 'soon';
  return 'comfortable';
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export function readiness(input: {
  checks: readonly CheckSummary[];
  deadline: Date | null;
  now?: Date;
}): Readiness {
  const now = input.now ?? new Date();
  const total = input.checks.length;
  const blocking = input.checks.filter((c) => !c.passed);
  const passed = total - blocking.length;

  const daysLeft = input.deadline ? daysBetween(now, input.deadline) : null;
  const urgency = urgencyOf(daysLeft);

  return {
    passed,
    total,
    daysLeft,
    deadline: input.deadline ? input.deadline.toISOString().slice(0, 10) : null,
    urgency,
    // Most findings first: the check with twelve problems is a bigger afternoon than the one with
    // a single missing field, and a student triaging at midnight should see that ordering.
    blocking: [...blocking].sort((a, b) => b.findingCount - a.findingCount),
    headline: headlineFor(passed, total, blocking.length, daysLeft, urgency),
  };
}

function headlineFor(
  passed: number,
  total: number,
  failing: number,
  daysLeft: number | null,
  urgency: Readiness['urgency'],
): string {
  const score = `${passed} of ${total} checks pass`;

  if (daysLeft === null) {
    return failing === 0
      ? `${score}. This thesis is ready to submit.`
      : `${score}. Set a submission date to see how much time the rest leaves you.`;
  }

  if (urgency === 'overdue') {
    const late = plural(Math.abs(daysLeft), 'day');
    return failing === 0
      ? `${score}. Your submission date passed ${late} ago, and the thesis is ready.`
      : `${score}. Your submission date passed ${late} ago and ${failing} ${failing === 1 ? 'check is' : 'checks are'} still failing.`;
  }

  const when = daysLeft === 0 ? 'today' : `in ${plural(daysLeft, 'day')}`;
  if (failing === 0) return `${score}. Ready to submit, and it is due ${when}.`;

  return `${score}. Due ${when}, with ${failing} ${failing === 1 ? 'check' : 'checks'} left to fix.`;
}
