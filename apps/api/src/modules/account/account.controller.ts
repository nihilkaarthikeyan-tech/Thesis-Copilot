/**
 * The account's own settings: deleting it (PRD §12.2) and moving it to another address (ADR-0015).
 *
 * `DELETE /account` asks; `POST /account/deletion/cancel` takes it back; `GET /account/deletion`
 * says where the request stands. The erasure itself is never triggered from an HTTP request —
 * `DeletionScheduler` does it once the grace period is up, so nothing a caller can do destroys
 * data in the same breath as asking to.
 *
 * Confirmation is the caller's own email address, typed back. Not a checkbox, and not a password
 * (there is none): the thing being confirmed is *which account*, and the address is the only
 * identifier a student has. It also means a request cannot be made by a page the student did not
 * read — a CSRF post has the cookie but not the text.
 *
 * The email-change routes are two steps for the same reason deletion is: the first says what is
 * wanted and the second proves it. What is proved there is control of the *new* mailbox, because
 * with OTP sign-in that is the whole of what the account is about to become.
 */

import { Body, Controller, Delete, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { toWebHeaders } from '../../common/web-headers.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { DeletionService } from './deletion.service.js';
import { EmailChangeService } from './email-change.service.js';

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
  ) {}

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
