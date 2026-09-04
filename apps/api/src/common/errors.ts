/**
 * Typed errors and the RFC 9457 problem-details shape — PRD §0.2 and §9.
 *
 * Every error the API returns is a problem-details JSON body. `type` is a stable slug the web app
 * switches on; it never parses `detail`.
 */

import { HttpException, HttpStatus } from '@nestjs/common';

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
 * The cap refusal — PRD §11.5, FR-9.2.
 * Carries `resetsAt` so the UI can say when the student gets more.
 */
export class CapExceededError extends AppError {
  constructor(action: string, cap: number, resetsAt: Date) {
    super(
      'CAP_EXCEEDED',
      'Monthly limit reached',
      HttpStatus.TOO_MANY_REQUESTS,
      `You have used all ${cap} ${action} actions for this month.`,
      { action, cap, resetsAt: resetsAt.toISOString() },
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
