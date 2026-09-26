/**
 * Better Auth's refusals, in this API's own shape.
 *
 * `auth.api.*` throws `APIError`, which Nest does not recognise, so without this a mistyped
 * six-digit code came back **500 Internal Server Error** — the student is told the server is
 * broken when the truth is that they fat-fingered a digit, and the log records a server fault
 * that never happened. Caught the first time the email-change flow was driven end to end; the
 * password routes (ADR-0033) reuse it rather than growing a second copy.
 *
 * Mapped by status rather than by matching the library's message text: the status is part of its
 * contract and the wording is not, and a translator that greps for "Email already in use" turns a
 * harmless upstream copy-edit into a 500 all over again. The library's own message is passed
 * through as `detail` because it is more specific than anything that could be written here.
 */

import { isAPIError } from 'better-auth/api';
import {
  AppError,
  ConflictError,
  UnauthorizedError,
  ValidationError,
} from '../../common/errors.js';

export function asAppError(error: unknown, fallback: string): unknown {
  if (!isAPIError(error)) return error;

  const status = Number(error.statusCode);
  const detail = (error.body?.message ?? error.message ?? fallback).toString();

  // A 5xx from the library really is ours to own — let the global filter log and report it.
  if (status >= 500) return error;
  if (status === 401 || status === 403) return new UnauthorizedError();
  if (status === 409) return new ConflictError(detail);
  if (status === 429) {
    return new AppError(
      'RATE_LIMITED',
      'Too many attempts',
      429,
      'Too many attempts for this address. Wait a minute and try again.',
    );
  }
  return new ValidationError(detail);
}
