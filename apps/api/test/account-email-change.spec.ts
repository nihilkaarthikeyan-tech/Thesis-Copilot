/**
 * Changing the address an account signs in with — ADR-0015.
 *
 * Driven through HTTP against the real application, because almost everything that could be wrong
 * here is wrong at a seam rather than inside a function: the session cookie has to survive the
 * change, Better Auth's OTP has to be single-use, the row has to actually move, and the audit
 * trail has to end up with both addresses on it. A mocked `auth.api` would assert that we call the
 * library and prove nothing about what the library then does to the database.
 *
 * `POST /account/email` is reachable by anyone holding a session, which is why several of these
 * tests are about what it *refuses* and what it declines to reveal rather than about what it does.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConsoleMailer, MAILER } from '../src/common/mailer.js';
import { maskEmail } from '../src/modules/account/email-change.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;

const EMAIL = 'email-change@example.edu';
const NEW_EMAIL = 'graduated@personal.example';

/** The code Better Auth just sent, read out of the dev sink the E2E sign-in also uses. */
async function codeFor(email: string): Promise<string> {
  const response = await h.api(`/auth/dev/last-otp?email=${encodeURIComponent(email)}`);
  expect(response.status, 'a code should have been sent to that address').toBe(200);
  return ((await response.json()) as { otp: string }).otp;
}

const request = (newEmail: string) =>
  h.api('/account/email', { method: 'POST', body: JSON.stringify({ newEmail }) });

const confirm = (newEmail: string, otp: string) =>
  h.api('/account/email/verify', { method: 'POST', body: JSON.stringify({ newEmail, otp }) });

const emailOf = async (): Promise<string> =>
  (await h.prisma.user.findUniqueOrThrow({ where: { id: h.userId }, select: { email: true } }))
    .email;

function mailer(): ConsoleMailer {
  const found = h.app.get(MAILER);
  // The harness configures no transport, so this is the console one and its `sent` array is the
  // record. If that ever changes, fail loudly rather than silently assert nothing.
  expect(found).toBeInstanceOf(ConsoleMailer);
  return found as ConsoleMailer;
}

beforeAll(async () => {
  h = await startHarness(EMAIL);
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(async () => {
  // Each test starts from the signed-in address, whatever the last one did to it.
  await h.prisma.user.update({
    where: { id: h.userId },
    data: { email: EMAIL, deletionRequestedAt: null },
  });
  await h.prisma.auditEvent.deleteMany({ where: { userId: h.userId, kind: 'EMAIL_CHANGED' } });
  mailer().sent.length = 0;
});

describe('masking the destination', () => {
  it('shows enough to recognise and not enough to be a new fact', () => {
    expect(maskEmail('karthik@gmail.com')).toBe('ka•••••@gmail.com');
    // A two-character local part is masked too: showing it in full would be the whole of it.
    expect(maskEmail('ab@x.io')).toBe('a•••@x.io');
    expect(maskEmail('a@x.io')).toBe('a•••@x.io');
  });

  it('does not throw on something that is not an address', () => {
    expect(maskEmail('nonsense')).toBe('•••');
  });
});

describe('requesting the change', () => {
  it('sends a code to the new address and changes nothing yet', async () => {
    const response = await request(NEW_EMAIL);

    expect(response.status).toBe(200);
    expect(await codeFor(NEW_EMAIL)).toMatch(/^\d{6}$/);
    expect(await emailOf(), 'the row must not move before the code is used').toBe(EMAIL);
  });

  it('warns the address being left, while the change can still be stopped', async () => {
    await request(NEW_EMAIL);

    const warning = mailer().sent.find((mail) => mail.to.includes(EMAIL));
    expect(warning, 'the old address should have been told').toBeTruthy();
    expect(warning?.text).toContain(maskEmail(NEW_EMAIL));
    // The whole point of masking: the warning may be read by someone who did not ask for this.
    expect(warning?.text).not.toContain(NEW_EMAIL);
  });

  it('refuses the address already on the account', async () => {
    const response = await request(EMAIL.toUpperCase());

    expect(response.status).toBe(400);
    expect(await emailOf()).toBe(EMAIL);
  });

  it('refuses while the account is scheduled for deletion', async () => {
    await h.prisma.user.update({
      where: { id: h.userId },
      data: { deletionRequestedAt: new Date() },
    });

    const response = await request(NEW_EMAIL);

    expect(response.status).toBe(409);
    expect(mailer().sent, 'a refused request should send nothing').toHaveLength(0);
  });
});

describe('confirming it', () => {
  it('moves the address, keeps the session, and records both on one audit row', async () => {
    await request(NEW_EMAIL);
    const response = await confirm(NEW_EMAIL, await codeFor(NEW_EMAIL));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: NEW_EMAIL });
    expect(await emailOf()).toBe(NEW_EMAIL);

    // Signing the student out would be the obvious thing to do and the wrong one: they are the
    // one who just proved the new mailbox, and the address is the only way back in.
    const stillIn = await h.api('/account/deletion');
    expect(stillIn.status).toBe(200);

    const audit = await h.prisma.auditEvent.findFirstOrThrow({
      where: { userId: h.userId, kind: 'EMAIL_CHANGED' },
    });
    expect(audit.detail).toEqual({ from: EMAIL, to: NEW_EMAIL });
  });

  it('refuses a wrong code and leaves the address alone', async () => {
    await request(NEW_EMAIL);

    const response = await confirm(NEW_EMAIL, '000000');

    // 400, not 500. Better Auth throws its own APIError; before it was translated, a mistyped
    // digit told the student the server was broken.
    expect(response.status).toBe(400);
    expect(((await response.json()) as { type: string }).type).toBe('VALIDATION_FAILED');
    expect(await emailOf()).toBe(EMAIL);
  });

  it('will not spend the same code twice', async () => {
    await request(NEW_EMAIL);
    const otp = await codeFor(NEW_EMAIL);
    expect((await confirm(NEW_EMAIL, otp)).status).toBe(200);

    // Back to the original address, then replay the code that moved it the first time.
    await h.prisma.user.update({ where: { id: h.userId }, data: { email: EMAIL } });
    const replay = await confirm(NEW_EMAIL, otp);

    expect(replay.status).toBe(400);
    expect(await emailOf()).toBe(EMAIL);
  });
});

describe('an address that already belongs to someone', () => {
  const TAKEN = 'someone-else@example.edu';

  beforeEach(async () => {
    await h.prisma.user.deleteMany({ where: { email: TAKEN } });
    await h.prisma.user.create({ data: { email: TAKEN, emailVerified: true } });
  });

  it('answers exactly as it would for a free one — the endpoint is not an account oracle', async () => {
    const response = await request(TAKEN);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: true });
  });

  it('sends that address nothing at all', async () => {
    await request(TAKEN);

    const code = await h.api(`/auth/dev/last-otp?email=${encodeURIComponent(TAKEN)}`);
    expect(code.status, 'no code should exist for an address already in use').toBe(404);
  });

  it('cannot be completed, so the collision is caught before two rows share an address', async () => {
    await request(TAKEN);

    const response = await confirm(TAKEN, '123456');

    expect(response.status).toBe(400);
    expect(await emailOf()).toBe(EMAIL);
  });
});
