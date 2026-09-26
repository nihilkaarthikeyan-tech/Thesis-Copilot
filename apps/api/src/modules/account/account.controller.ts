/**
 * The account's own settings: deleting it (PRD §12.2) and moving it to another address (ADR-0015).
 *
 * `DELETE /account` asks; `POST /account/deletion/cancel` takes it back; `GET /account/deletion`
 * says where the request stands. The erasure itself is never triggered from an HTTP request —
 * `DeletionScheduler` does it once the grace period is up, so nothing a caller can do destroys
 * data in the same breath as asking to.
 *
 * Confirmation is the caller's own email address, typed back. Not a checkbox, and not a password
 * (most accounts have none — ADR-0033 made one optional): the thing being confirmed is *which
 * account*, and the address is the only identifier every student has. It also means a request cannot be made by a page the student did not
 * read — a CSRF post has the cookie but not the text.
 *
 * The email-change routes are two steps for the same reason deletion is: the first says what is
 * wanted and the second proves it. What is proved there is control of the *new* mailbox, because
 * with OTP sign-in that is the whole of what the account is about to become.
 */

import { Body, Controller, Delete, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { toWebHeaders } from '../../common/web-headers.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth/auth.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { DeletionService } from './deletion.service.js';
import { EmailChangeService } from './email-change.service.js';
import { PasswordService } from './password.service.js';

/**
 * ADR-0033. Length is the whole rule, and it is checked here so the student gets a sentence
 * rather than the library's error code; Better Auth checks it again on its side.
 */
const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);
const setPasswordSchema = z.object({ newPassword: password });
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: password,
});

const confirmSchema = z.object({
  /** The signed-in address, typed by hand. Compared case-insensitively and trimmed. */
  confirmEmail: z.string().trim().min(1),
  /** Optional and free text; kept on the audit row so a pattern in the reasons is visible. */
  reason: z.string().trim().max(500).optional(),
});

/**
 * `z.string().email()` and not a hand-rolled pattern. Better Auth validates it again on its side,
 * so this one exists to fail early with a problem-details body rather than the library's own
 * shape — not to be the authority on what an address is.
 */
const newEmailSchema = z.object({ newEmail: z.string().trim().min(1).email() });

const confirmEmailChangeSchema = newEmailSchema.extend({
  /** Six digits, but taken as a string: leading zeros are part of the code. */
  otp: z.string().trim().min(1),
});

@Controller('account')
@UseGuards(SessionGuard)
export class AccountController {
  constructor(
    private readonly deletion: DeletionService,
    private readonly emailChange: EmailChangeService,
    private readonly password: PasswordService,
  ) {}

  /** Whether a password exists on this account — the settings page shows "add" or "change". */
  @Get('password')
  passwordStatus(@CurrentUser() user: SessionUser) {
    return this.password.status(user.id);
  }

  /** The first password on an account that signs in with the code. Refused when one exists. */
  @Post('password')
  @HttpCode(200)
  async setPassword(
    @CurrentUser() user: SessionUser,
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ) {
    const parsed = setPasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? 'Choose a password',
        parsed.error.issues,
      );
    }
    return this.password.set({
      userId: user.id,
      email: user.email,
      newPassword: parsed.data.newPassword,
      headers: toWebHeaders(request),
    });
  }

  /**
   * The current password proves the change; every other device is signed out — and this one is
   * kept by forwarding the fresh session cookie the library mints (see `PasswordService.change`).
   */
  @Post('password/change')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: SessionUser,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? 'Enter your current and new password',
        parsed.error.issues,
      );
    }
    const { setCookie } = await this.password.change({
      userId: user.id,
      email: user.email,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
      headers: toWebHeaders(request),
    });
    // `set-cookie` may repeat and must not be collapsed into one header.
    if (setCookie.length > 0) reply.header('set-cookie', setCookie);
    return { ok: true };
  }

  /** Step one — sends a code to the new address. Never says whether it was already taken. */
  @Post('email')
  @HttpCode(200)
  async requestEmailChange(
    @CurrentUser() user: SessionUser,
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ) {
    const parsed = newEmailSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Enter the email address you want to use', parsed.error.issues);
    }
    return this.emailChange.request({
      userId: user.id,
      currentEmail: user.email,
      newEmail: parsed.data.newEmail,
      headers: toWebHeaders(request),
    });
  }

  /** Step two — the code out of the new mailbox, and the address moves. */
  @Post('email/verify')
  @HttpCode(200)
  async confirmEmailChange(
    @CurrentUser() user: SessionUser,
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ) {
    const parsed = confirmEmailChangeSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Enter the code we sent to the new address', parsed.error.issues);
    }
    return this.emailChange.confirm({
      userId: user.id,
      currentEmail: user.email,
      newEmail: parsed.data.newEmail,
      otp: parsed.data.otp,
      headers: toWebHeaders(request),
    });
  }

  @Get('deletion')
  async status(@CurrentUser() user: SessionUser) {
    return this.deletion.status(user.id);
  }

  @Delete()
  @HttpCode(200)
  async request(@CurrentUser() user: SessionUser, @Body() body: unknown) {
    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Type your email address to confirm', parsed.error.issues);
    }
    if (parsed.data.confirmEmail.toLowerCase() !== user.email.toLowerCase()) {
      throw new ValidationError('That is not the address this account signs in with');
    }
    return this.deletion.request(user.id);
  }

  @Post('deletion/cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() user: SessionUser) {
    return this.deletion.cancel(user.id);
  }
}
