/**
 * Changing the address an account signs in with — ADR-0015.
 *
 * PRD §12 does not mention this, which is why it went unbuilt: with Better Auth's email OTP the
 * address *is* the credential (there is no password — see `docs/PENDING.md`), so "change your
 * email" and "change how you sign in" are the same operation, and neither had a route. A student
 * who leaves their university keeps paying for a thesis they can no longer reach.
 *
 * Better Auth 1.7.2 already implements the flow correctly — single-use OTP with an atomic consume,
 * an attempt budget, and a deliberately enumeration-safe request step that returns success without
 * sending anything when the target address is already an account. That is `changeEmail` on the
 * `emailOTP` plugin, enabled in `auth.ts`, and this service calls it rather than reimplementing it
 * (§0.3 rule 5 — boring over clever).
 *
 * What it adds around the library is the part the library has no opinion about:
 *
 * - **a warning to the address being left**, at request time, while the move can still fail;
 * - **an audit row**, so a disputed account has a record with both addresses in it;
 * - **a refusal while a deletion is pending**, because moving an account out from under a pending
 *   erasure is precisely what someone who should not have the session would do next.
 *
 * The warning is the security-load-bearing piece and it is honestly only half a defence; ADR-0015
 * says what it does and does not cover.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { isAPIError } from 'better-auth/api';
import {
  AppError,
  ConflictError,
  UnauthorizedError,
  ValidationError,
} from '../../common/errors.js';
import { MAILER, type Mail, type Mailer } from '../../common/mailer.js';
import { PrismaService } from '../../common/prisma.service.js';
import type { Auth } from '../auth/auth.js';
import { OTP_MINUTES } from '../auth/auth.js';
import { AUTH } from '../auth/auth.tokens.js';

/**
 * Better Auth's refusals, in this API's own shape.
 *
 * `auth.api.*` throws `APIError`, which Nest does not recognise, so without this a mistyped
 * six-digit code came back **500 Internal Server Error** — the student is told the server is
 * broken when the truth is that they fat-fingered a digit, and the log records a server fault
 * that never happened. Caught the first time this flow was driven end to end.
 *
 * Mapped by status rather than by matching the library's message text: the status is part of its
 * contract and the wording is not, and a translator that greps for "Email already in use" turns a
 * harmless upstream copy-edit into a 500 all over again. The library's own message is passed
 * through as `detail` because it is more specific than anything that could be written here.
 */
function asAppError(error: unknown, fallback: string): unknown {
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
      'Too many codes requested for this address. Wait a minute and try again.',
    );
  }
  return new ValidationError(detail);
}

/**
 * Shows enough of an address to recognise, not enough to be a new fact.
 *
 * The warning goes to someone who may not have asked for the change, so it has to name the
 * destination well enough that "no, that isn't me" is answerable — and no better, because if the
 * request *was* hostile the mail is now a message from us to the attacker's victim containing the
 * attacker's inbox. `ka****@gmail.com`.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local[0] ?? ''}•••${domain}`;
  return `${local.slice(0, 2)}${'•'.repeat(Math.min(local.length - 2, 6))}${domain}`;
}

/** Sent to the address being left, at request time — the only moment at which it still helps. */
export function emailChangeWarningMail(input: { to: string; newEmail: string }): Mail {
  return {
    to: [input.to],
    subject: 'Someone asked to move your Thesis Copilot account',
    text:
      `A request was made to change the address on your Thesis Copilot account to ` +
      `${maskEmail(input.newEmail)}.

` +
      `If that was you, there is nothing to do here — finish it with the code we sent to the new ` +
      `address. It expires in ${OTP_MINUTES} minutes.

` +
      `If it was NOT you, someone else is signed in to your account right now. The change has ` +
      `not happened yet and cannot happen without the code sent to that other address. Sign in ` +
      `at once and delete your other sessions, and reply to this email so we can help.`,
  };
}

@Injectable()
export class EmailChangeService {
  private readonly logger = new Logger(EmailChangeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  /**
   * Step one: send a code to `newEmail`.
   *
   * The response never says whether the address was already taken. Better Auth returns success
   * and sends nothing in that case, and this method copies that silence deliberately — the
   * endpoint is reachable by anyone with a session, so a truthful answer would turn it into a
   * "does this person have an account here" oracle. The student finds out at step two, by which
   * point they have proved they can read the mailbox anyway.
   */
  async request(input: {
    userId: string;
    currentEmail: string;
    newEmail: string;
    headers: Headers;
  }): Promise<{ sent: true }> {
    const newEmail = input.newEmail.trim().toLowerCase();
    if (newEmail === input.currentEmail.trim().toLowerCase()) {
      throw new ValidationError('That is already the address on this account');
    }
    await this.refuseIfDeletionPending(input.userId);

    try {
      await this.auth.api.requestEmailChangeEmailOTP({
        body: { newEmail },
        headers: input.headers,
      });
    } catch (error) {
      throw asAppError(error, 'Could not send a code to that address');
    }

    // After the library call, so a rejected request sends no warning; best-effort, because a mail
    // provider having a bad minute must not strand a student who is about to lose their mailbox.
    try {
      await this.mailer.send(emailChangeWarningMail({ to: input.currentEmail, newEmail }));
    } catch (error) {
      this.logger.error({ err: error }, 'could not warn the old address about an email change');
    }

    return { sent: true };
  }

  /** Step two: the code proves the new mailbox, so the address moves. */
  async confirm(input: {
    userId: string;
    currentEmail: string;
    newEmail: string;
    otp: string;
    headers: Headers;
  }): Promise<{ email: string }> {
    const newEmail = input.newEmail.trim().toLowerCase();
    await this.refuseIfDeletionPending(input.userId);

    try {
      await this.auth.api.changeEmailEmailOTP({
        body: { newEmail, otp: input.otp.trim() },
        headers: input.headers,
      });
    } catch (error) {
      throw asAppError(error, 'That code is not right, or it has expired');
    }

    // Both addresses on one row. An account in dispute is exactly when somebody needs to see
    // where it went, and after the update the `User` row itself no longer remembers.
    await this.prisma.auditEvent.create({
      data: {
        kind: 'EMAIL_CHANGED',
        userId: input.userId,
        detail: { from: input.currentEmail.toLowerCase(), to: newEmail },
      },
    });
    this.logger.log({ userId: input.userId }, 'account email changed');

    return { email: newEmail };
  }

  /**
   * A pending erasure and a change of address should never be in flight together.
   *
   * Either order is bad. Moving the account then cancelling the deletion is how a stolen session
   * becomes a permanent theft; cancelling then moving is the same thing with an extra step. The
   * student can always undo the deletion first (`POST /account/deletion/cancel`) and then change
   * the address, which forces the two decisions to be made one at a time.
   */
  private async refuseIfDeletionPending(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { deletionRequestedAt: true },
    });
    if (user?.deletionRequestedAt) {
      throw new ConflictError(
        'This account is scheduled for deletion. Choose "Keep my account" first, then change the address.',
      );
    }
  }
}
