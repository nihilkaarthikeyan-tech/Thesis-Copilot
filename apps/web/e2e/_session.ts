/**
 * The one sign-in helper the E2E suite uses — PRD §12.1.
 *
 * Four spec files had a copy of this, and a copy drifts. It also has to do something none of the
 * copies did: **wait out the rate limit**. §12.1 allows twenty sign-in attempts a minute per IP,
 * which is right for the internet and lower than a fully parallel suite needs when every test
 * mints a fresh account. That limit is not a thing to weaken for the tests, so the tests behave
 * like a person who was told to try again in a moment.
 */

import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** An address nobody else in the run will use. */
export function freshEmail(prefix: string): string {
  return `e2e-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

export type Session = { email: string; cookieName: string; cookieValue: string };

/**
 * Signs `email` in through the real OTP flow, retrying while the rate limiter is holding the door.
 * Anything else fails immediately — a 500 is a bug, not a queue.
 */
export async function establishSession(
  request: APIRequestContext,
  email = freshEmail('user'),
): Promise<Session> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const sent = await request.post(`${API_URL}/api/v1/auth/email-otp/send-verification-otp`, {
      data: { email, type: 'sign-in' },
    });
    if (sent.status() === 429) {
      await wait(attempt);
      continue;
    }
    expect(sent.ok(), `send-otp for ${email}: ${sent.status()}`).toBe(true);

    const { otp } = (await (
      await request.get(`${API_URL}/api/v1/auth/dev/last-otp?email=${encodeURIComponent(email)}`)
    ).json()) as { otp: string };

    const signedIn = await request.post(`${API_URL}/api/v1/auth/sign-in/email-otp`, {
      data: { email, otp },
    });
    if (signedIn.status() === 429) {
      await wait(attempt);
      continue;
    }
    expect(signedIn.ok(), `sign-in for ${email}: ${signedIn.status()}`).toBe(true);

    const pair = (signedIn.headers()['set-cookie'] ?? '').split(';')[0] ?? '';
    const eq = pair.indexOf('=');
    expect(eq, `no session cookie for ${email}`).toBeGreaterThan(0);
    return { email, cookieName: pair.slice(0, eq), cookieValue: pair.slice(eq + 1) };
  }
  throw new Error(`sign-in for ${email} was rate-limited for the whole of its window`);
}

/** The limiter's window is a minute, so the waits climb towards it and stop. */
function wait(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.min(2_000 * 2 ** attempt, 20_000)));
}

/** Signs in and puts the session cookie on the page, which is what a test actually wants. */
export async function signInAs(
  page: Page,
  request: APIRequestContext,
  email?: string,
): Promise<Session> {
  const session = await establishSession(request, email);
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  return session;
}

/**
 * Signs in through the sign-in screen itself, the way a person does.
 *
 * `editor.spec.ts` is the one place that exercises the real form rather than injecting a cookie,
 * so it also meets the real rate limiter: the send is retried while the screen says to wait.
 */
export async function signInThroughTheScreen(
  page: Page,
  request: APIRequestContext,
  email = freshEmail('screen'),
): Promise<string> {
  await page.goto('/sign-in');
  await page.getByLabel('University or personal email').fill(email);

  const codeField = page.getByLabel('Six-digit code');
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.getByRole('button', { name: 'Email me a code' }).click();
    try {
      await codeField.waitFor({ state: 'visible', timeout: 5_000 });
      break;
    } catch {
      // The screen reports the limit; wait it out and press the button again.
      await wait(attempt);
    }
  }
  await expect(codeField, `the sign-in screen never asked ${email} for a code`).toBeVisible();

  const { otp } = (await (
    await request.get(`${API_URL}/api/v1/auth/dev/last-otp?email=${encodeURIComponent(email)}`)
  ).json()) as { otp: string };
  await codeField.fill(otp);
  await page.getByRole('button', { name: 'Sign in' }).click();
  return email;
}
