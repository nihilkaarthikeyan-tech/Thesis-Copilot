/**
 * The shared mailer (2026-10-04). Its behaviour is covered in depth by apps/api/test/mailer.spec.ts,
 * which imports it through the API; this checks what is new here: the console mailer's line is the
 * caller's to route, and the worker's choice falls back to it when no provider is configured.
 */

import type { Env } from '@tc/config';
import { describe, expect, it } from 'vitest';
import { type ConsoleMailer, createMailer } from '../src/index.js';

const env = (over: Partial<Env> = {}) => ({ APP_URL: 'https://a.example.edu', ...over }) as Env;

describe('@tc/mail', () => {
  it('falls back to the console mailer, which records and logs through the given function', async () => {
    const lines: string[] = [];
    const choice = createMailer(env({ SMTP_HOST: '' as never }), {
      log: (event, msg) => lines.push(`${msg} ${event.subject}`),
    });
    expect(choice.provider).toBe('console');
    await choice.mailer.send({ to: ['s@x.edu'], subject: 'Hello', text: 'Body' });
    expect((choice.mailer as ConsoleMailer).sent).toHaveLength(1);
    expect(lines).toEqual(['mail (console mailer) Hello']);
  });

  it('picks SMTP when a host and port are set', () => {
    expect(createMailer(env({ SMTP_HOST: 'smtp.x.edu', SMTP_PORT: 587 })).provider).toBe('smtp');
  });
});
