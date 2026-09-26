/**
 * Development-only sink for what would otherwise be emailed.
 *
 * Outside production the one-time code is not emailed; it is printed to the API console and kept
 * here so the Playwright smoke and the latency benchmark can sign in without a mailbox. The
 * verify-email and reset-password links (ADR-0033) are kept the same way. The controller refuses
 * to exist in production: `AuthModule` registers it only when `NODE_ENV !== 'production'`, and it
 * double-checks at request time.
 */

import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { Env } from '@tc/config';
import { ENV } from '../../common/env.token.js';
import { NotFoundError } from '../../common/errors.js';
import type { Mail } from '../../common/mailer.js';

const lastOtpByEmail = new Map<string, { otp: string; at: number }>();
const lastLinkByEmail = new Map<string, { kind: string; url: string; at: number }>();

export function rememberDevOtp(email: string, otp: string): void {
  lastOtpByEmail.set(email.toLowerCase(), { otp, at: Date.now() });
}

/** The first `http(s)://` address in the message is the link. */
export function rememberDevLink(email: string, kind: string, mail: Mail): void {
  const url = /https?:\/\/\S+/.exec(mail.text)?.[0];
  if (url) lastLinkByEmail.set(email.toLowerCase(), { kind, url, at: Date.now() });
}

@Controller('auth/dev')
export class DevOtpController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get('last-otp')
  lastOtp(@Query('email') email?: string): { email: string; otp: string } {
    if (this.env.NODE_ENV === 'production' || !email) throw new NotFoundError('That');
    const entry = lastOtpByEmail.get(email.toLowerCase());
    if (!entry) throw new NotFoundError('A code for that address');
    return { email, otp: entry.otp };
  }

  @Get('last-link')
  lastLink(@Query('email') email?: string): { email: string; kind: string; url: string } {
    if (this.env.NODE_ENV === 'production' || !email) throw new NotFoundError('That');
    const entry = lastLinkByEmail.get(email.toLowerCase());
    if (!entry) throw new NotFoundError('A link for that address');
    return { email, kind: entry.kind, url: entry.url };
  }
}
