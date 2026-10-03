/**
 * Thesis lifecycle — ADR-0043. One explicit, validated state for where a thesis is, so the product
 * stops inferring it from scattered signals (a share exists, a comment is open, compliance passes).
 *
 * The machine is pure: states, the events that move between them, and guards that read a context
 * the caller computes from the database. It decides nothing about the database and talks to no
 * service, so it is settled by a table and a handful of tests. The API owns persisting the state
 * and building the context; this owns what is allowed.
 */

export const DOCUMENT_LIFECYCLE = [
  'DRAFTING',
  'IN_REVIEW',
  'REVISING',
  'READY',
  'SUBMITTED',
] as const;
export type DocumentLifecycle = (typeof DOCUMENT_LIFECYCLE)[number];

export const LIFECYCLE_EVENTS = [
  'sendForReview',
  'startRevising',
  'backToDrafting',
  'markReady',
  'submit',
  'reopen',
] as const;
export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

/** What a guard needs to know, read from the database by the caller. */
export type LifecycleContext = {
  /** The thesis has been shared with at least one guide or committee member. */
  hasShare: boolean;
  /** Review comments exist on the thesis. */
  hasComments: boolean;
  /** Review comments are still open (unresolved). */
  hasOpenComments: boolean;
  /** Every compliance check passes — the same gate `exportThesis` enforces. */
  compliancePasses: boolean;
};

export const LIFECYCLE_LABEL: Record<DocumentLifecycle, string> = {
  DRAFTING: 'Drafting',
  IN_REVIEW: 'With your guide',
  REVISING: 'Revising',
  READY: 'Ready to submit',
  SUBMITTED: 'Submitted',
};

export const EVENT_LABEL: Record<LifecycleEvent, string> = {
  sendForReview: 'Send for review',
  startRevising: 'Start revising',
  backToDrafting: 'Back to drafting',
  markReady: 'Mark ready to submit',
  submit: 'Mark submitted',
  reopen: 'Reopen for changes',
};

type Rule = {
  event: LifecycleEvent;
  from: readonly DocumentLifecycle[];
  to: DocumentLifecycle;
  /** Returns null when allowed, or a reason the student can read when not. */
  guard?: (ctx: LifecycleContext) => string | null;
};

const RULES: readonly Rule[] = [
  {
    event: 'sendForReview',
    from: ['DRAFTING', 'REVISING', 'READY'],
    to: 'IN_REVIEW',
    guard: (ctx) =>
      ctx.hasShare ? null : 'Share the thesis with your guide first, from the Review screen.',
  },
  {
    event: 'startRevising',
    from: ['IN_REVIEW'],
    to: 'REVISING',
    guard: (ctx) => (ctx.hasComments ? null : 'There are no comments to revise against yet.'),
  },
  // Writing is always allowed; going back to drafting never has a guard.
  { event: 'backToDrafting', from: ['IN_REVIEW', 'REVISING', 'READY'], to: 'DRAFTING' },
  {
    event: 'markReady',
    from: ['DRAFTING', 'REVISING'],
    to: 'READY',
    guard: (ctx) => {
      if (!ctx.compliancePasses) {
        return 'Not every compliance check passes yet — see the Submit screen.';
      }
      if (ctx.hasOpenComments) {
        return 'Resolve your guide’s open comments before marking the thesis ready.';
      }
      return null;
    },
  },
  {
    event: 'submit',
    from: ['READY'],
    to: 'SUBMITTED',
    guard: (ctx) =>
      ctx.compliancePasses ? null : 'Compliance no longer passes; return to drafting and fix it.',
  },
  // After a submission (e.g. sent back by the committee) the student can always reopen.
  { event: 'reopen', from: ['SUBMITTED'], to: 'DRAFTING' },
];

/** The rule for an event, or undefined if the event is unknown. */
function ruleFor(event: LifecycleEvent): Rule | undefined {
  return RULES.find((r) => r.event === event);
}

export type TransitionResult = { ok: true; to: DocumentLifecycle } | { ok: false; reason: string };

/**
 * Whether `event` may fire from `from` given `ctx`. Checks the state is a valid origin for the
 * event, then the guard.
 */
export function applyEvent(
  from: DocumentLifecycle,
  event: LifecycleEvent,
  ctx: LifecycleContext,
): TransitionResult {
  const rule = ruleFor(event);
  if (!rule) return { ok: false, reason: 'Unknown action.' };
  if (!rule.from.includes(from)) {
    return {
      ok: false,
      reason: `You cannot ${EVENT_LABEL[event].toLowerCase()} from “${LIFECYCLE_LABEL[from]}”.`,
    };
  }
  const blocked = rule.guard?.(ctx) ?? null;
  if (blocked) return { ok: false, reason: blocked };
  return { ok: true, to: rule.to };
}

/** The events available from a state, each marked allowed or with the reason it is blocked. */
export function availableEvents(
  from: DocumentLifecycle,
  ctx: LifecycleContext,
): Array<{
  event: LifecycleEvent;
  to: DocumentLifecycle;
  label: string;
  allowed: boolean;
  reason: string | null;
}> {
  return RULES.filter((r) => r.from.includes(from)).map((r) => {
    const reason = r.guard?.(ctx) ?? null;
    return {
      event: r.event,
      to: r.to,
      label: EVENT_LABEL[r.event],
      allowed: reason === null,
      reason,
    };
  });
}
