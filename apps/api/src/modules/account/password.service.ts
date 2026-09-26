/**
 * A password on an account that did not need one — ADR-0033.
 *
 * Sign-in is the emailed code, and stays so; the owner asked (2026-09-26) for the password most
 * people expect as well, with "forgot password" and a reset. Better Auth 1.7.2 implements the
 * credential account, the hashing (scrypt), the single-use reset token and the revocation on
 * reset. This service wraps the two mutations that need a session — set and change — for the
 * three things the library has no opinion about:
 *
 * - **an audit row**, so a disputed account shows when its password moved;
 * - **a notice to the address**, because the person most likely to catch a takeover is its victim;
 * - **the library's refusals in this API's shape** (`asAppError`), so a short password is a 400
 *   with a sentence and not a 500.
 *
 * The reset itself never touches this file: `/api/v1/auth/request-password-reset` and
 * `/reset-password` are the library's own, and `onPasswordReset` in `auth.ts` writes the same
 * audit row and sends the same notice.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Env } from '@tc/config';
import { ENV } from '../../common/env.token.js';
import { MAILER, type Mailer } from '../../common/mailer.js';
import { PrismaService } from '../../common/prisma.service.js';
import { asAppError } from '../auth/api-error.js';
import { type Auth, passwordChangedMail } from '../auth/auth.js';
import { AUTH } from '../auth/auth.tokens.js';

export type PasswordStatus = { hasPassword: boolean };

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Whether this account can sign in with a password at all — what the settings page shows. */
  async status(userId: string): Promise<PasswordStatus> {
    const account = await this.prisma.account.findFirst({
      where: { userId, providerId: 'credential', password: { not: null } },
      select: { id: true },
    });
    return { hasPassword: account !== null };
  }

  /** First password on an account made with the emailed code. Refused when one exists. */
  async set(input: {
    userId: string;
    email: string;
    newPassword: string;
    headers: Headers;
  }): Promise<{ ok: true }> {
    try {
      await this.auth.api.setPassword({
        body: { newPassword: input.newPassword },
        headers: input.headers,
      });
    } catch (error) {
      throw asAppError(error, 'Could not set a password');
    }
    await this.record(input.userId, input.email, 'PASSWORD_SET', 'set for the first time');
    return { ok: true };
  }

  /**
   * The current password proves the change; every other device is signed out.
   *
   * Revoking "other" sessions is, in the library, revoking all of them and minting a fresh one
   * for the caller, which it hands back as a `set-cookie`. Because this call is made server-side
   * that header would otherwise stop here and the person who just changed their password would
   * find themselves signed out — which is what the first run of `password.spec.ts` found. The
   * cookies are returned for the controller to forward.
   */
  async change(input: {
    userId: string;
    email: string;
    currentPassword: string;
    newPassword: string;
    headers: Headers;
  }): Promise<{ ok: true; setCookie: string[] }> {
    let setCookie: string[] = [];
    try {
      const { headers } = await this.auth.api.changePassword({
        body: {
          currentPassword: input.currentPassword,
          newPassword: input.newPassword,
          revokeOtherSessions: true,
        },
        headers: input.headers,
        returnHeaders: true,
      });
      setCookie = headers.getSetCookie();
    } catch (error) {
      throw asAppError(error, 'Could not change the password');
    }
    await this.record(input.userId, input.email, 'PASSWORD_CHANGED', 'changed');
    return { ok: true, setCookie };
  }

  private async record(userId: string, email: string, kind: string, how: string): Promise<void> {
    await this.prisma.auditEvent.create({ data: { kind, userId } });
    // Best-effort: a mail provider having a bad minute must not undo a change that has happened.
    try {
      await this.mailer.send(passwordChangedMail({ email, appUrl: this.env.APP_URL, how }));
    } catch (error) {
      this.logger.error({ err: error }, 'could not send the password-changed notice');
    }
  }
}
