import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail, signInAs } from './_session.js';

/**
 * Passwords in the browser — ADR-0033. The API suite proves what the library does; this proves
 * the three screens a person meets: adding a password under Account and signing in with it, and
 * the forgot-password link landing on a page that sets a new one.
 */

const PASSWORD = 'a sentence i will remember';
const NEW_PASSWORD = 'a different sentence for later';

test('an account made with the code adds a password and signs in with it', async ({
  page,
  request,
}) => {
  const session = await signInAs(page, request, freshEmail('pw'));

  await page.goto('/app/account');
  const card = page.getByTestId('password-card');
  await expect(card.getByTestId('password-status')).toContainText('no password', {
    timeout: 30_000,
  });
  await card.getByTestId('add-password').click();
  await card.getByTestId('pw-new').fill(PASSWORD);
  await card.getByTestId('pw-repeat').fill(PASSWORD);
  await card.getByTestId('save-password').click();
  await expect(card.getByTestId('password-notice')).toContainText('Your password is set');
  await expect(card.getByTestId('change-password')).toBeVisible();

  // Signed out, back in through the screen with the password.
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByTestId('mode-password').click();
  await page.getByLabel('University or personal email').fill(session.email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });
});

test('a wrong password says so, and offers the code and the reset', async ({ page }) => {
  await page.goto('/sign-in?mode=password');
  await page.getByLabel('University or personal email').fill(freshEmail('nobody'));
  await page.locator('#password').fill('definitely not it, no');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // Next.js keeps its own route announcer with role=alert on every page; ours has the text.
  const alert = page.getByRole('alert').filter({ hasText: 'do not match' });
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('forgot-password')).toHaveAttribute('href', '/forgot-password');
  await expect(page.getByTestId('mode-code')).toBeVisible();
});

test('forgot password: the emailed link sets a new one', async ({ page, request }) => {
  const session = await establishSession(request, freshEmail('reset'));

  await page.goto('/forgot-password');
  await page.getByTestId('forgot-email').fill(session.email);
  await page.getByTestId('forgot-submit').click();
  await expect(page.getByTestId('forgot-done')).toBeVisible({ timeout: 30_000 });

  const { url, kind } = (await (
    await request.get(
      `${API_URL}/api/v1/auth/dev/last-link?email=${encodeURIComponent(session.email)}`,
    )
  ).json()) as { url: string; kind: string };
  expect(kind).toBe('reset-password');

  // The link goes to the API, which checks the token and sends the browser to the page.
  await page.goto(url);
  await expect(page).toHaveURL(/\/reset-password\?token=/, { timeout: 30_000 });
  await page.getByTestId('reset-password').fill(NEW_PASSWORD);
  await page.getByTestId('reset-repeat').fill(NEW_PASSWORD);
  await page.getByTestId('reset-submit').click();
  await expect(page.getByTestId('reset-done')).toBeVisible({ timeout: 30_000 });

  // This context still carries the (now revoked) session cookie, and Better Auth refuses a
  // cookie-bearing POST with no Origin as a CSRF guard — so say where it comes from, as a
  // browser would.
  const signedIn = await request.post(`${API_URL}/api/v1/auth/sign-in/email`, {
    data: { email: session.email, password: NEW_PASSWORD },
    headers: { origin: 'http://localhost:3000' },
  });
  expect(signedIn.ok(), `sign-in with the new password: ${signedIn.status()}`).toBe(true);

  // A spent link is told apart from a bad password.
  await page.goto(url);
  await expect(page.getByTestId('reset-invalid')).toBeVisible({ timeout: 30_000 });
});
