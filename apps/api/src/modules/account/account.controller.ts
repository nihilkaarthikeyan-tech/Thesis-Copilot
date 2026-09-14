/**
 * Account deletion — PRD §12.2.
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
 */

import { Body, Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ValidationError } from '../../common/errors.js';
import { CurrentUser, type SessionUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { DeletionService } from './deletion.service.js';

const confirmSchema = z.object({
  /** The signed-in address, typed by hand. Compared case-insensitively and trimmed. */
  confirmEmail: z.string().trim().min(1),
  /** Optional and free text; kept on the audit row so a pattern in the reasons is visible. */
  reason: z.string().trim().max(500).optional(),
});

@Controller('account')
@UseGuards(SessionGuard)
export class AccountController {
  constructor(private readonly deletion: DeletionService) {}

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
