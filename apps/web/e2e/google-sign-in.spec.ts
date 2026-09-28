import { expect, test } from '@playwright/test';

/**
 * Google sign-in, 2026-09-28. On production a double press of "Continue with Google" minted two
 * OAuth states; the second overwrote the first's cookie and Google's reply failed with
 * `state_mismatch`, landing the owner on the home page with nothing but a code in the address.
 * These tests hold the two fixes: one press starts one sign-in, and a failed return says why on
 * the page that can retry it. Google itself is not contacted: the start request is intercepted.
 */

test('a double press starts one Google sign-in, not two', async ({ page }) => {
  let starts = 0;
  await page.route('**/api/v1/auth/sign-in/social', async (route) => {
    starts += 1;
    // Slow, like the real round trip, so a second press lands while the first is in flight.
    await new Promise((r) => setTimeout(r, 1_500));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"redirect":false}',
    });
  });
  await page.route('**/api/v1/auth/methods', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"emailOtp":true,"password":true,"google":true}',
    }),
  );

  await page.goto('/sign-in');
  const google = page.getByTestId('google-sign-in');
  await expect(google).toBeVisible({ timeout: 30_000 });
  await google.dblclick({ force: true });
  await expect(google).toHaveText(/Opening Google/);
  await expect(google).toBeDisabled();
  await page.waitForTimeout(2_000);
  expect(starts).toBe(1);
});

test('a Google sign-in that did not finish says so on the sign-in page', async ({ page }) => {
  await page.goto('/sign-in?error=state_mismatch');
  await expect(page.getByRole('alert').filter({ hasText: 'didn’t finish' })).toBeVisible({
    timeout: 30_000,
  });
});

test('a cancelled Google sign-up says so on the sign-up page', async ({ page }) => {
  await page.goto('/sign-up?error=access_denied');
  await expect(page.getByRole('alert').filter({ hasText: 'cancelled' })).toBeVisible({
    timeout: 30_000,
  });
});
