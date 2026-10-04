/**
 * Outbound mail for the API. The mailer itself is `@tc/mail` (shared with the worker since
 * 2026-10-04); this file adds the Nest injection token and routes the console mailer's line
 * through the Nest logger, so every caller and test keeps importing from here.
 */

import { Logger } from '@nestjs/common';
import type { Env } from '@tc/config';
import { createMailer as createSharedMailer, type MailerChoice } from '@tc/mail';

export {
  ConsoleMailer,
  type Mail,
  MailError,
  type Mailer,
  type MailerChoice,
  type MailLog,
  mailFrom,
  type ResendLike,
  ResendMailer,
  SmtpMailer,
  type SmtpTransportLike,
} from '@tc/mail';

export const MAILER = Symbol('MAILER');

const logger = new Logger('ConsoleMailer');

/** Picks the implementation the environment configures. Called once, from `MailerModule`. */
export function createMailer(env: Env): MailerChoice {
  return createSharedMailer(env, { log: (event, msg) => logger.log(event, msg) });
}
