/**
 * Passwords — ADR-0033.
 *
 * Driven through HTTP against the real application, like the email-change suite, because what
 * matters is what Better Auth does to the database and the cookie, not that we called it: the
 * hash lands on a `credential` account, a sign-up with a password stays signed out until the
 * link is opened, the reset token is single-use, and a reset signs every other device out.
 *
 * Order matters inside this file: the last block resets the harness user's password, which
 * revokes the harness session, so nothing may follow it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConsoleMailer, MAILER } from '../src/common/mailer.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;

const EMAIL = 'password@example.edu';
/** The harness's APP_URL — the only origin a redirect may point at. */
const APP = 'http://localhost:3000';
const PASSWORD = 'correct horse battery staple';
const SECOND = 'a different sentence entirely';
const THIRD = 'set by the reset link today';

/** No cookie: what an anonymous visitor's browser sends. */
const anonymous = { cookie: '' };

const json = (body: unknown) => JSON.stringify(body);

function mailer(): ConsoleMailer {
  const found = h.app.get(MAILER);
  expect(found).toBeInstanceOf(ConsoleMailer);
  return found as ConsoleMailer;
}

/**
 * The last link mailed to `email`, read from the console mailer rather than the dev sink: every
 * `/auth/*` request counts against the twenty-a-minute sign-in limit (PRD §12.1), and this suite
 * has no calls to spare on lookups.
 */
function lastLink(email: string): { kind: string; url: string } {
  const mail = [...mailer().sent]
    .reverse()
    .find((m) => m.to.includes(email) && /https?:\/\//.test(m.text));
  expect(mail, `a link should have been sent to ${email}`).toBeTruthy();
  const url = /https?:\/\/\S+/.exec(mail?.text ?? '')?.[0] ?? '';
  return { kind: url.includes('/verify-email') ? 'verify-email' : 'reset-password', url };
}

const signInWithPassword = (email: string, password: string) =>
  h.api('/auth/sign-in/email', {
    method: 'POST',
    headers: anonymous,
    body: json({ email, password }),
  });

/**
 * Better Auth builds its links on the configured `API_URL`, which is the dev port; the harness
 * listens on a random one. Same path, this process's origin.
 */
const followable = (url: string): string => url.replace(/^https?:\/\/[^/]+/, h.baseUrl);

/** The `name=value` of the session cookie a response set, for sending back. */
const firstCookie = (response: Response): string =>
  (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

/** The harness cookie dies when the password changes; the tests after that use this one. */
let keptCookie = '';

const sessionCookie = (response: Response): string | null => {
  const header = response.headers.get('set-cookie') ?? '';
  return header.includes('better-auth.session_token=') ? header : null;
};

beforeAll(async () => {
  h = await startHarness(EMAIL);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

describe('the sign-in methods', () => {
  it('advertise the password next to the code', async () => {
    const response = await h.api('/auth/methods');
    expect(await response.json()).toMatchObject({ emailOtp: true, password: true });
  });
});

describe('adding a password to an account made with the code', () => {
  it('starts without one', async () => {
    const response = await h.api('/account/password');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hasPassword: false });
  });

  it('refuses a short one with a sentence, not a 500', async () => {
    const response = await h.api('/account/password', {
      method: 'POST',
      body: json({ newPassword: 'short' }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { type: string; detail: string };
    expect(body.type).toBe('VALIDATION_FAILED');
    expect(body.detail).toContain('at least 10');
  });

  it('cannot be set by someone without a session', async () => {
    const response = await h.api('/account/password', {
      method: 'POST',
      headers: anonymous,
      body: json({ newPassword: PASSWORD }),
    });
    expect(response.status).toBe(401);
  });

  it('sets it, records it, tells the address, and it signs in', async () => {
    mailer().sent.length = 0;
    const response = await h.api('/account/password', {
      method: 'POST',
      body: json({ newPassword: PASSWORD }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    expect(await (await h.api('/account/password')).json()).toEqual({ hasPassword: true });

    const account = await h.prisma.account.findFirstOrThrow({
      where: { userId: h.userId, providerId: 'credential' },
    });
    expect(account.password, 'the password must be stored hashed').not.toBe(PASSWORD);
    expect(account.password?.length ?? 0).toBeGreaterThan(40);

    const audit = await h.prisma.auditEvent.findFirst({
      where: { userId: h.userId, kind: 'PASSWORD_SET' },
    });
    expect(audit).toBeTruthy();

    const notice = mailer().sent.find((mail) => mail.to.includes(EMAIL));
    expect(notice?.subject).toBe('Your Thesis Copilot password was changed');

    const signedIn = await signInWithPassword(EMAIL, PASSWORD);
    expect(signedIn.status).toBe(200);
    expect(sessionCookie(signedIn)).toBeTruthy();
  });

  it('refuses a second first-password', async () => {
    const response = await h.api('/account/password', {
      method: 'POST',
      body: json({ newPassword: SECOND }),
    });
    expect(response.status).toBe(400);
  });

  it('refuses the wrong password with 401 and no cookie', async () => {
    const response = await signInWithPassword(EMAIL, 'not the password at all');
    expect(response.status).toBe(401);
    expect(sessionCookie(response)).toBeNull();
  });

  it('changes it only with the current one, keeps this device and signs the others out', async () => {
    const wrong = await h.api('/account/password/change', {
      method: 'POST',
      body: json({ currentPassword: 'wrong', newPassword: SECOND }),
    });
    expect(wrong.status).toBe(400);
    const other = await signInWithPassword(EMAIL, PASSWORD);
    expect(other.status).toBe(200);
    const otherCookie = firstCookie(other);

    const right = await h.api('/account/password/change', {
      method: 'POST',
      body: json({ currentPassword: PASSWORD, newPassword: SECOND }),
    });
    expect(right.status).toBe(200);
    expect((await signInWithPassword(EMAIL, SECOND)).status).toBe(200);

    // The other device is out; the device that made the change carries on with the fresh
    // cookie the response handed it (the old cookie is gone with the rest).
    expect((await h.api('/account/password', { headers: { cookie: otherCookie } })).status).toBe(
      401,
    );
    const fresh = firstCookie(right);
    expect(fresh).toContain('better-auth.session_token=');
    expect((await h.api('/account/password', { headers: { cookie: fresh } })).status).toBe(200);
    keptCookie = fresh;

    const audit = await h.prisma.auditEvent.findFirst({
      where: { userId: h.userId, kind: 'PASSWORD_CHANGED' },
    });
    expect(audit).toBeTruthy();
  });
});

describe('a sign-up with a password', () => {
  const NEW = 'new-by-password@example.edu';

  it('creates the account signed out, emails a link, and the link signs it in', async () => {
    await h.prisma.user.deleteMany({ where: { email: NEW } });

    const created = await h.api('/auth/sign-up/email', {
      method: 'POST',
      headers: anonymous,
      body: json({ name: 'Asha', email: NEW, password: PASSWORD, callbackURL: `${APP}/app` }),
    });
    expect(created.status).toBe(200);
    expect(sessionCookie(created), 'no session before the address is confirmed').toBeNull();

    const user = await h.prisma.user.findUniqueOrThrow({ where: { email: NEW } });
    expect(user.emailVerified).toBe(false);

    const first = lastLink(NEW);
    expect(first.kind).toBe('verify-email');
    expect(first.url).toContain('/api/v1/auth/verify-email?token=');
    expect(first.url).toContain(`callbackURL=${encodeURIComponent(`${APP}/app`)}`);

    // Until the link is opened the password does not get in either — and trying re-sends the
    // link, with the return address the sign-in screen passes along.
    const refused = await h.api('/auth/sign-in/email', {
      method: 'POST',
      headers: anonymous,
      body: json({ email: NEW, password: PASSWORD, callbackURL: `${APP}/app` }),
    });
    expect(refused.status).toBe(403);
    const link = lastLink(NEW);
    expect(link.url).toContain(`callbackURL=${encodeURIComponent(`${APP}/app`)}`);

    const opened = await fetch(followable(link.url), { redirect: 'manual' });
    expect(opened.status).toBe(302);
    expect(opened.headers.get('location')).toBe(`${APP}/app`);
    expect(sessionCookie(opened), 'opening the link is the sign-in').toBeTruthy();

    const verified = await h.prisma.user.findUniqueOrThrow({ where: { email: NEW } });
    expect(verified.emailVerified).toBe(true);
    expect((await signInWithPassword(NEW, PASSWORD)).status).toBe(200);
  });

  // 2026-09-28: the owner signed in with Google, then tried to sign up with a password, saw
  // "Check your email" and received nothing. The screen must still not say the address is taken;
  // the owner's inbox must say what happened and how to get in.
  it('with a taken address answers like a new one, makes nothing, and tells the owner by email', async () => {
    const before = await h.prisma.user.count({ where: { email: EMAIL } });
    mailer().sent.length = 0;

    const response = await h.api('/auth/sign-up/email', {
      method: 'POST',
      headers: anonymous,
      body: json({ name: 'Someone', email: EMAIL, password: SECOND, callbackURL: `${APP}/app` }),
    });
    expect(response.status).toBe(200);
    expect(sessionCookie(response), 'a taken address signs nobody in').toBeNull();
    expect(await h.prisma.user.count({ where: { email: EMAIL } })).toBe(before);

    // Better Auth may run the hook after answering (`runInBackgroundOrAwait`).
    const findNotice = () => mailer().sent.find((m) => m.to.includes(EMAIL));
    await expect.poll(findNotice, { timeout: 5_000 }).toBeTruthy();
    const notice = findNotice();
    expect(notice?.subject).toBe('You already have a Thesis Copilot account');
    expect(notice?.text).toContain(`${APP}/sign-in`);
    expect(notice?.text).toContain(`${APP}/forgot-password`);
    expect(notice?.text, 'no verification link: it must not sign anyone in').not.toContain(
      'verify-email',
    );
  });
});

describe('forgot password', () => {
  it('answers the same for an unknown address, and sends it nothing', async () => {
    const response = await h.api('/auth/request-password-reset', {
      method: 'POST',
      headers: anonymous,
      body: json({ email: 'nobody@example.edu', redirectTo: `${APP}/reset-password` }),
    });
    expect(response.status).toBe(200);
    expect(mailer().sent.some((m) => m.to.includes('nobody@example.edu'))).toBe(false);
  });

  // Last on purpose: this revokes the harness session.
  it('emails a link that sets a new password once and signs every other device out', async () => {
    mailer().sent.length = 0;
    const asked = await h.api('/auth/request-password-reset', {
      method: 'POST',
      headers: anonymous,
      body: json({ email: EMAIL, redirectTo: `${APP}/reset-password` }),
    });
    expect(asked.status).toBe(200);

    const link = lastLink(EMAIL);
    expect(link.kind).toBe('reset-password');
    expect(link.url).toContain('/api/v1/auth/reset-password/');
    const mail = mailer().sent.find((m) => m.subject === 'Reset your Thesis Copilot password');
    expect(mail?.to).toEqual([EMAIL]);

    const opened = await fetch(followable(link.url), { redirect: 'manual' });
    expect(opened.status).toBe(302);
    const location = opened.headers.get('location') ?? '';
    expect(location.startsWith(`${APP}/reset-password?token=`)).toBe(true);
    const token = new URL(location).searchParams.get('token') ?? '';
    expect(token.length).toBeGreaterThan(10);

    const reset = await h.api('/auth/reset-password', {
      method: 'POST',
      headers: anonymous,
      body: json({ newPassword: THIRD, token }),
    });
    expect(reset.status).toBe(200);

    expect((await signInWithPassword(EMAIL, SECOND)).status).toBe(401);
    expect((await signInWithPassword(EMAIL, THIRD)).status).toBe(200);

    const audit = await h.prisma.auditEvent.findFirst({
      where: { userId: h.userId, kind: 'PASSWORD_RESET' },
    });
    expect(audit).toBeTruthy();
    const notice = mailer().sent.find(
      (m) => m.subject === 'Your Thesis Copilot password was changed' && m.to.includes(EMAIL),
    );
    expect(notice?.text).toContain('reset by link');

    // Every session went with it — the one the device kept at the last change included.
    expect((await h.api('/account/password', { headers: { cookie: keptCookie } })).status).toBe(
      401,
    );

    // The token was spent.
    const replay = await h.api('/auth/reset-password', {
      method: 'POST',
      headers: anonymous,
      body: json({ newPassword: 'yet another sentence here', token }),
    });
    expect(replay.status).toBe(400);
  });
});
