/**
 * Typed errors and the RFC 9457 problem-details shape — PRD §0.2 and §9.
 *
 * Every error the API returns is a problem-details JSON body. `type` is a stable slug the web app
 * switches on; it never parses `detail`.
 */

import { HttpException, HttpStatus } from '@nestjs/common';
import { ALLOWANCE_NAMES, capRefusalDetail } from '@tc/config';

/**
 * R31 (ADR-0122): the allowance a refused action counts against, in the student's words, carried
 * on every refusal so a screen can name it without knowing the codes. Null for an action that is
 * not an allowance of its own (`OUTLINE`, refused only by the trial or a budget).
 */
const allowanceOf = (action: string): string | null => ALLOWANCE_NAMES[action] ?? null;

/** RFC 9457 problem details, plus the extension members this API adds. */
export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  requestId?: string;
  [key: string]: unknown;
};

export class AppError extends HttpException {
  constructor(
    readonly problemType: string,
    title: string,
    status: HttpStatus,
    detail?: string,
    readonly extensions: Record<string, unknown> = {},
  ) {
    super({ type: problemType, title, status, detail, ...extensions }, status);
  }
}

/**
 * ADR-0071: Draft mode was asked for a section that names no topic ("Chapter 1" with no scope
 * note and no heading above the cursor). Refused before any unit is taken.
 */
export class SectionNeedsTopicError extends AppError {
  constructor() {
    super(
      'SECTION_NEEDS_TOPIC',
      'Say what this section is about',
      HttpStatus.UNPROCESSABLE_ENTITY,
      'Add a heading above the cursor, such as "Financial constraints", then draft again. A ' +
        'draft for "Chapter 1" has no topic to write about. Planning your chapters (the ' +
        'proposal or the outline) gives every section one.',
    );
  }
}

/**
 * The cap refusal — PRD §11.5, FR-9.2.
 *
 * Carries what a screen needs to say it plainly (R31, ADR-0122): the allowance, how many of it
 * were used of how many (`cap` is this month's total, an admin's extra allowance included), and
 * `resetsAt`, 00:00 UTC on the 1st, which the web app shows as the student's own local date.
 */
export class CapExceededError extends AppError {
  /**
   * `trialEndsAt` (ADR-0152): the allowance is the free trial's, counted over the whole trial; it
   * does not renew on the 1st, and the refusal says so. `resetsAt` is then the trial's end.
   */
  constructor(action: string, cap: number, resetsAt: Date, used: number = cap, trialEndsAt?: Date) {
    super(
      'CAP_EXCEEDED',
      trialEndsAt ? 'Trial limit reached' : 'Monthly limit reached',
      HttpStatus.TOO_MANY_REQUESTS,
      capRefusalDetail(action, cap, Boolean(trialEndsAt)),
      {
        action,
        allowance: allowanceOf(action),
        used,
        cap,
        resetsAt: resetsAt.toISOString(),
        ...(trialEndsAt ? { trialAllowance: true, trialEndsAt: trialEndsAt.toISOString() } : {}),
      },
    );
  }
}

/**
 * ADR-0144: an allowance that counts only kept suggestions has reached its call ceiling — the
 * student asked for `callCeiling` suggestions this month and kept fewer than the allowance. Kept as
 * `CAP_EXCEEDED`, like the trial's refusal, so every screen that already shows a limit shows this
 * one; `used` and `cap` are the suggestions kept and the allowance, `callCeiling` the calls.
 */
export class CallCeilingError extends AppError {
  constructor(action: string, cap: number, ceiling: number, resetsAt: Date, used: number) {
    const name = (ALLOWANCE_NAMES[action] ?? 'AI actions of this kind').toLowerCase();
    super(
      'CAP_EXCEEDED',
      'Monthly limit reached',
      HttpStatus.TOO_MANY_REQUESTS,
      `You have asked for ${ceiling} ${name} this month, the most one month allows. You kept ${used} of your ${cap}.`,
      {
        action,
        allowance: allowanceOf(action),
        used,
        cap,
        callCeiling: ceiling,
        resetsAt: resetsAt.toISOString(),
      },
    );
  }
}

/**
 * The free trial has ended (ADR-0036).
 *
 * Kept as `CAP_EXCEEDED` on purpose: every screen that meets a refused AI action already shows
 * that type's `detail`, and a new type would fall silent in the ones that ignore what they do not
 * know. No `resetsAt`, because nothing resets: the editor would otherwise add "It resets on 1
 * October" to a trial that is over. `trialEnded` lets a screen offer the pricing page.
 */
export class TrialEndedError extends AppError {
  constructor(action: string, endedAt: Date) {
    super(
      'CAP_EXCEEDED',
      'Free trial ended',
      HttpStatus.PAYMENT_REQUIRED,
      `Your 14-day free trial ended on ${endedAt.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      })}. Your theses are safe and you can keep writing; subscribe to use the AI features again.`,
      {
        action,
        allowance: allowanceOf(action),
        cap: 0,
        trialEnded: true,
        trialEndedAt: endedAt.toISOString(),
      },
    );
  }
}

/**
 * PRD §11's ₹100 ceiling, refusing at run time rather than in a projection.
 *
 * Separate from `CapExceededError` because it can arrive while the student's action counter still
 * shows units left, and being told "you have 40 suggestions remaining" and then refused is the
 * kind of thing that reads as a bug. The message says plainly that the month's AI is finished and
 * when it comes back; everything that is not an AI call — writing, editing, citations already in
 * the document, export — keeps working.
 */
export class CeilingExceededError extends AppError {
  constructor(action: string, spentInr: number, ceilingInr: number, resetsAt: Date) {
    super(
      'CEILING_EXCEEDED',
      'Monthly AI limit reached',
      HttpStatus.TOO_MANY_REQUESTS,
      `You have used this month's AI allowance. It resets on the 1st. ` +
        'You can keep writing, editing and exporting in the meantime.',
      {
        action,
        allowance: allowanceOf(action),
        spentInr,
        ceilingInr,
        resetsAt: resetsAt.toISOString(),
      },
    );
  }
}

/**
 * The site-wide monthly AI budget is spent (`PLATFORM_MONTHLY_CEILING_INR`, 2026-09-25). Not the
 * student's doing, and the sentence says so.
 */
export class PlatformCeilingExceededError extends AppError {
  constructor(action: string, spentInr: number, ceilingInr: number, resetsAt: Date) {
    super(
      'PLATFORM_CEILING_EXCEEDED',
      'AI features paused for this month',
      HttpStatus.TOO_MANY_REQUESTS,
      "The service's AI budget for this month has been used up, so AI features are paused until " +
        'the 1st. Writing, editing, sharing and exporting all still work. This is not your ' +
        'allowance; the administrator has been alerted.',
      {
        action,
        allowance: allowanceOf(action),
        spentInr,
        ceilingInr,
        resetsAt: resetsAt.toISOString(),
      },
    );
  }
}

/**
 * PRD §12.1: "every document/chapter/source query is scoped by ownerId or an active GuideShare. No
 * object is fetched by id alone." An object the caller may not see is reported as absent, so the
 * API never confirms that an id exists to someone without access.
 */
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('NOT_FOUND', 'Not found', HttpStatus.NOT_FOUND, `${resource} was not found.`);
  }
}

export class UnauthorizedError extends AppError {
  constructor(detail = 'You must sign in to do that.') {
    super('UNAUTHORIZED', 'Not signed in', HttpStatus.UNAUTHORIZED, detail);
  }
}

/** Signed in, but not allowed. Distinct from UNAUTHORIZED so the client does not send them to sign in again. */
export class ForbiddenError extends AppError {
  constructor(detail = 'You do not have access to that.') {
    super('FORBIDDEN', 'Not allowed', HttpStatus.FORBIDDEN, detail);
  }
}

export class ValidationError extends AppError {
  constructor(detail: string, issues?: unknown) {
    super('VALIDATION_FAILED', 'Invalid request', HttpStatus.BAD_REQUEST, detail, { issues });
  }
}

/** Autosave conflict — Appendix B.7. */
export class ConflictError extends AppError {
  constructor(detail: string, extensions: Record<string, unknown> = {}) {
    super('CONFLICT', 'Conflict', HttpStatus.CONFLICT, detail, extensions);
  }
}
