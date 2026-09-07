/**
 * One `Mailer` for the whole API, chosen from the environment at boot (see `mailer.ts`).
 *
 * Global for the same reason `AppConfigModule` is: four modules send mail, and each providing its
 * own instance meant a test's console mailer recorded only the messages of the module it was
 * fetched from. One provider, one record.
 */

import { Global, Inject, Logger, Module } from '@nestjs/common';
import type { Env } from '@tc/config';
import { ENV } from './env.token.js';
import { createMailer, MAILER, type Mailer } from './mailer.js';

const MAILER_CHOICE = Symbol('MAILER_CHOICE');

@Global()
@Module({
  providers: [
    { provide: MAILER_CHOICE, inject: [ENV], useFactory: (env: Env) => createMailer(env) },
    {
      provide: MAILER,
      inject: [MAILER_CHOICE],
      useFactory: (choice: ReturnType<typeof createMailer>): Mailer => choice.mailer,
    },
  ],
  exports: [MAILER],
})
export class MailerModule {
  constructor(
    @Inject(MAILER_CHOICE) choice: ReturnType<typeof createMailer>,
    @Inject(ENV) env: Env,
  ) {
    const logger = new Logger(MailerModule.name);
    if (choice.provider === 'console') {
      // Production cannot reach here — `packages/config` refuses to boot without a transport —
      // so this is the dev/test line saying where the OTP will appear.
      logger.log('mail: console (no RESEND_API_KEY or SMTP_*); one-time codes print to this log');
    } else {
      logger.log(`mail: ${choice.provider}, from ${env.MAIL_FROM ?? env.SMTP_FROM ?? '(derived)'}`);
    }
  }
}
