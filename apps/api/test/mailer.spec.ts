/**
 * Outbound mail — PRD §7.2, §13.3; the OTP path in §7.2 (Better Auth, email OTP).
 *
 * No network here. Both real mailers take their client as a constructor argument, so the tests
 * hand them a recorder and check what would have gone over the wire — the one thing that matters
 * for a message nobody can read back: was it addressed, and from whom.
 */

import type { Env } from '@tc/config';
import { describe, expect, it, vi } from 'vitest';
import {
  ConsoleMailer,
  createMailer,
  MailError,
  type Mailer,
  mailFrom,
  ResendMailer,
  SmtpMailer,
} from '../src/common/mailer.js';
import { OTP_MINUTES, otpMail, otpSenderFor } from '../src/modules/auth/auth.js';

/** Only the variables the mailer reads; everything else is irrelevant to it. */
function env(over: Partial<Env> = {}): Env {
  return { APP_URL: 'https://thesis.example.edu', ...over } as Env;
}

describe('createMailer', () => {
  it('is the console mailer when no transport is configured — dev and test', () => {
    const choice = createMailer(env());
    expect(choice.provider).toBe('console');
    expect(choice.mailer).toBeInstanceOf(ConsoleMailer);
  });

  it('is Resend when the key is set', () => {
    const choice = createMailer(env({ RESEND_API_KEY: 're_test' }));
    expect(choice.provider).toBe('resend');
    expect(choice.mailer).toBeInstanceOf(ResendMailer);
  });

  it('is SMTP when a host and port are set', () => {
    const choice = createMailer(env({ SMTP_HOST: 'smtp.example.edu', SMTP_PORT: 587 }));
    expect(choice.provider).toBe('smtp');
    expect(choice.mailer).toBeInstanceOf(SmtpMailer);
  });

  it('prefers Resend when both are set, as §13.3 lists them', () => {
    const choice = createMailer(
      env({ RESEND_API_KEY: 're_test', SMTP_HOST: 'smtp.example.edu', SMTP_PORT: 587 }),
    );
    expect(choice.provider).toBe('resend');
  });
});

describe('the sender address', () => {
  it('is MAIL_FROM first', () => {
    expect(mailFrom(env({ MAIL_FROM: 'Copilot <hi@x.edu>', SMTP_FROM: 'other@x.edu' }))).toBe(
      'Copilot <hi@x.edu>',
    );
  });

  it('falls back to SMTP_FROM, the older name', () => {
    expect(mailFrom(env({ SMTP_FROM: 'other@x.edu' }))).toBe('other@x.edu');
  });

  it("otherwise is a no-reply address on the app's own host", () => {
    expect(mailFrom(env())).toBe('Thesis Copilot <no-reply@thesis.example.edu>');
  });
});

describe('ResendMailer', () => {
  it('sends from the configured address to every recipient', async () => {
    const send = vi.fn(async () => ({ data: { id: 'em_1' }, error: null }));
    const mailer = new ResendMailer({ emails: { send } }, 'Copilot <no-reply@x.edu>');

    await mailer.send({ to: ['a@x.edu', 'b@x.edu'], subject: 'Hello', text: 'Body' });

    expect(send).toHaveBeenCalledWith({
      from: 'Copilot <no-reply@x.edu>',
      to: ['a@x.edu', 'b@x.edu'],
      subject: 'Hello',
      text: 'Body',
    });
  });

  it('turns a refusal in the response envelope into an error', async () => {
    // The SDK does not throw; it answers `{ data: null, error }`. An unverified sending domain
    // is the refusal a first deployment will meet.
    const send = vi.fn(async () => ({
      data: null,
      error: { name: 'validation_error', message: 'The x.edu domain is not verified.' },
    }));
    const mailer = new ResendMailer({ emails: { send } }, 'no-reply@x.edu');

    await expect(mailer.send({ to: ['a@x.edu'], subject: 's', text: 't' })).rejects.toThrow(
      MailError,
    );
    await expect(mailer.send({ to: ['a@x.edu'], subject: 's', text: 't' })).rejects.toThrow(
      /not verified/,
    );
  });
});

describe('SmtpMailer', () => {
  it('sends one message to all recipients, from the configured address', async () => {
    const sendMail = vi.fn(async () => ({ accepted: ['a@x.edu', 'b@x.edu'] }));
    const mailer = new SmtpMailer({ sendMail }, 'no-reply@x.edu');

    await mailer.send({ to: ['a@x.edu', 'b@x.edu'], subject: 'Hello', text: 'Body' });

    expect(sendMail).toHaveBeenCalledWith({
      from: 'no-reply@x.edu',
      to: 'a@x.edu, b@x.edu',
      subject: 'Hello',
      text: 'Body',
    });
  });

  it('wraps a transport failure so the caller sees which provider failed', async () => {
    const sendMail = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const mailer = new SmtpMailer({ sendMail }, 'no-reply@x.edu');
    await expect(mailer.send({ to: ['a@x.edu'], subject: 's', text: 't' })).rejects.toMatchObject({
      name: 'MailError',
      provider: 'smtp',
    });
  });

  it('builds a real transport from the environment without connecting', () => {
    // Construction is offline; nodemailer only opens a socket on the first send.
    const mailer = SmtpMailer.fromEnv(
      env({ SMTP_HOST: 'smtp.example.edu', SMTP_PORT: 587, SMTP_USER: 'u', SMTP_PASS: 'p' }),
      'no-reply@x.edu',
    );
    expect(mailer).toBeInstanceOf(SmtpMailer);
  });
});

describe('the one-time-code email', () => {
  it('puts the code in the subject and the body, with its lifetime', () => {
    const mail = otpMail({ email: 'student@x.edu', otp: '482913', type: 'sign-in' });
    expect(mail.to).toEqual(['student@x.edu']);
    expect(mail.subject).toContain('482913');
    expect(mail.text).toContain('482913');
    expect(mail.text).toContain(`${OTP_MINUTES} minutes`);
    expect(mail.text).toContain('sign in');
  });

  it('says what the code is for when it is not a sign-in', () => {
    const mail = otpMail({ email: 's@x.edu', otp: '1', type: 'email-verification' });
    expect(mail.text).toContain('confirm your email address');
  });

  it('goes through the mailer when there is a real one', async () => {
    const sent: Array<{ to: readonly string[]; subject: string }> = [];
    const mailer: Mailer = {
      send: async (mail) => {
        sent.push({ to: mail.to, subject: mail.subject });
      },
    };
    await otpSenderFor(mailer)({ email: 'student@x.edu', otp: '482913', type: 'sign-in' });
    expect(sent).toEqual([{ to: ['student@x.edu'], subject: expect.stringContaining('482913') }]);
  });

  it('is printed, not "sent", when the mailer is the console one', async () => {
    // The console mailer logs only the subject line; the code has to be on the console for the
    // developer to read, so the OTP keeps its own printer in that case.
    const mailer = new ConsoleMailer();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await otpSenderFor(mailer)({ email: 'student@x.edu', otp: '482913', type: 'sign-in' });
      expect(mailer.sent).toEqual([]);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('482913'));
    } finally {
      log.mockRestore();
    }
  });
});
