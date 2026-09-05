/**
 * Development-only OTP sink.
 *
 * Outside production the one-time code is not emailed; it is printed to the API console and kept
 * here so the Playwright smoke and the latency benchmark can sign in without a mailbox. The
 * controller refuses to exist in production: `AuthModule` registers it only when
 * `NODE_ENV !== 'production'`, and it double-checks at request time.
 */

import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { Env } from '@tc/config';
import { ENV } from '../../common/env.token.js';
import { NotFoundError } from '../../common/errors.js';

const lastOtpByEmail = new Map<string, { otp: string; at: number }>();

export function rememberDevOtp(email: string, otp: string): void {
  lastOtpByEmail.set(email.toLowerCase(), { otp, at: Date.now() });
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
}
