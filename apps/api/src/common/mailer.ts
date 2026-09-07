/**
 * Outbound mail — PRD §7.2 ("Resend (or SMTP), transactional only"), §13.3 (`RESEND_API_KEY` or
 * `SMTP_*`), §14 (alert emails), PHASES 4.6.
 *
 * One interface, three implementations, chosen once at boot by `createMailer`:
 *
 * - `ResendMailer` when `RESEND_API_KEY` is set;
 * - `SmtpMailer` when `SMTP_HOST` and `SMTP_PORT` are set;
 * - `ConsoleMailer` otherwise — what dev and test get. It prints and records every message, so a
 *   test can assert an alert was sent without a mail provider.
 *
 * `packages/config` refuses to start production without one of the first two, because the email
 * OTP is the only way to sign in. Everything that sends mail — the OTP, §14 alerts, billing
 * reminders, review invitations — goes through `Mailer.send`, so a provider swap touches no caller.
 *
 * Both real implementations take their client as a constructor argument. That is what makes them
 * testable without a network, and it keeps the SDK types (`resend`, `nodemailer` — both checked in
 * `node_modules`, §0.3 rule 1) out of every other file.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { Env } from '@tc/config';
import { createTransport } from 'nodemailer';
import { Resend } from 'resend';

export type Mail = { to: readonly string[]; subject: string; text: string };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export const MAILER = Symbol('MAILER');

/** A provider refused or failed to accept a message. The caller decides whether that is fatal. */
export class MailError extends Error {
  constructor(
    readonly provider: 'resend' | 'smtp',
    message: string,
  ) {
    super(`${provider}: ${message}`);
    this.name = 'MailError';
  }
}

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

/** The part of the Resend SDK this file uses: `resend.emails.send` (`dist/index.d.cts`). */
export type ResendLike = {
  emails: {
    send(payload: {
      from: string;
      to: string[];
      subject: string;
      text: string;
    }): Promise<{ data: { id: string } | null; error: { message: string; name: string } | null }>;
  };
};

export class ResendMailer implements Mailer {
  constructor(
    private readonly client: ResendLike,
    private readonly from: string,
  ) {}

  static withKey(apiKey: string, from: string): ResendMailer {
    return new ResendMailer(new Resend(apiKey), from);
  }

  async send(mail: Mail): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: [...mail.to],
      subject: mail.subject,
      text: mail.text,
    });
    // The SDK reports refusals in the envelope rather than by throwing.
    if (error) throw new MailError('resend', `${error.name}: ${error.message}`);
  }
}

/** The part of a nodemailer transport this file uses: `sendMail` (`@types/nodemailer`). */
export type SmtpTransportLike = {
  sendMail(options: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
};

export class SmtpMailer implements Mailer {
  constructor(
    private readonly transport: SmtpTransportLike,
    private readonly from: string,
  ) {}

  static fromEnv(env: Env, from: string): SmtpMailer {
    if (!env.SMTP_HOST || !env.SMTP_PORT) {
      throw new MailError('smtp', 'SMTP_HOST and SMTP_PORT are required');
    }
    const transport = createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // 465 is implicit TLS; 587 and 25 upgrade with STARTTLS, which nodemailer does by default.
      secure: env.SMTP_PORT === 465,
      ...(env.SMTP_USER && env.SMTP_PASS
        ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }
        : {}),
    });
    return new SmtpMailer(transport, from);
  }

  async send(mail: Mail): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.from,
        to: mail.to.join(', '),
        subject: mail.subject,
        text: mail.text,
      });
    } catch (error) {
      throw new MailError('smtp', error instanceof Error ? error.message : String(error));
    }
  }
}

/**
 * The sender address. `MAIL_FROM` wins; `SMTP_FROM` is the older name for the SMTP path; failing
 * both, a no-reply address on the app's own host — which Resend will refuse until that domain is
 * verified, with a message that says so (docs/PENDING.md).
 */
export function mailFrom(env: Env): string {
  if (env.MAIL_FROM) return env.MAIL_FROM;
  if (env.SMTP_FROM) return env.SMTP_FROM;
  const host = new URL(env.APP_URL).hostname;
  return `Thesis Copilot <no-reply@${host}>`;
}

export type MailerChoice = { mailer: Mailer; provider: 'resend' | 'smtp' | 'console' };

/** Picks the implementation the environment configures. Called once, from `MailerModule`. */
export function createMailer(env: Env): MailerChoice {
  const from = mailFrom(env);
  if (env.RESEND_API_KEY) {
    return { mailer: ResendMailer.withKey(env.RESEND_API_KEY, from), provider: 'resend' };
  }
  if (env.SMTP_HOST && env.SMTP_PORT) {
    return { mailer: SmtpMailer.fromEnv(env, from), provider: 'smtp' };
  }
  return { mailer: new ConsoleMailer(), provider: 'console' };
}
