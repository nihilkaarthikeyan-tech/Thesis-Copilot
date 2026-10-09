/**
 * ADR-0142: the one-click link at the foot of a comment email.
 *
 * No session: the token (`@tc/mail` `unsubscribeToken`, an HMAC under `AUTH_SECRET`) names the
 * account and proves the link came from us. It flips exactly one thing, the same switch the
 * account page shows ("Email me about comments and replies"), off — or back on, for the page's
 * "Undo". A wrong or forged token is a 400 that says nothing about which accounts exist.
 *
 * The page (`/unsubscribe`) posts here rather than the email linking to a GET that changes
 * state: mail scanners fetch every link in a message, and a GET would unsubscribe on their visit.
 */

import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import type { Env } from '@tc/config';
import { verifyUnsubscribeToken } from '@tc/mail';
import { z } from 'zod';
import { ENV } from '../../common/env.token.js';
import { ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';

const body = z.object({
  token: z.string().trim().min(1).max(200),
  /** False (the default) turns comment emails off; true is the page's "Undo". */
  on: z.boolean().optional(),
});

@Controller('email')
export class UnsubscribeController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('unsubscribe')
  @HttpCode(200)
  async unsubscribe(@Body() input: unknown): Promise<{ emailOnComments: boolean }> {
    const parsed = body.safeParse(input);
    const userId = parsed.success
      ? verifyUnsubscribeToken(this.env.AUTH_SECRET, parsed.data.token)
      : null;
    const invalid = new ValidationError(
      'That link is not valid. Turn these emails off under Account.',
    );
    if (!parsed.success || !userId || !z.string().uuid().safeParse(userId).success) throw invalid;
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true, deletedAt: true },
    });
    if (!row || row.deletedAt) throw invalid;
    const on = parsed.data.on === true;
    const settings = {
      ...((row.settings as Record<string, unknown> | null) ?? {}),
      emailOnComments: on,
    };
    await this.prisma.user.update({ where: { id: userId }, data: { settings } });
    return { emailOnComments: on };
  }
}
