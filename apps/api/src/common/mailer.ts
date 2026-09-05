/**
 * Outbound mail — PRD §13.3 (`RESEND_API_KEY` or `SMTP_*`), §14 (alert emails), PHASES 4.6.
 *
 * One interface, one implementation so far. `ConsoleMailer` is what dev and test get: it prints
 * and records every message, so a test can assert an alert was sent without a mail provider. Real
 * delivery needs a key that does not exist yet (docs/PENDING.md), and this interface is the seam
 * a Resend or SMTP implementation slots into without touching a caller.
 */

import { Injectable, Logger } from '@nestjs/common';

export type Mail = { to: readonly string[]; subject: string; text: string };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export const MAILER = Symbol('MAILER');

@Injectable()
export class ConsoleMailer implements Mailer {
  private readonly logger = new Logger(ConsoleMailer.name);
  /** Everything sent, oldest first. Tests read this; production never uses this class. */
  readonly sent: Mail[] = [];

  async send(mail: Mail): Promise<void> {
    this.sent.push(mail);
    this.logger.log({ to: mail.to, subject: mail.subject }, 'mail (console mailer)');
  }
}
