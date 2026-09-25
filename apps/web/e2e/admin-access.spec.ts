import { expect, test } from '@playwright/test';
import { establishSession, freshEmail } from './_session.js';

/**
 * Who sees the admin screens (2026-09-25). The API refuses every admin request without a
 * superadmin session; this is about what the page does with that: a signed-out visitor is sent
 * to sign in and comes back afterwards, and a signed-in student is told plainly.
 */

test('a signed-out visit to /admin goes to sign-in, and comes back after', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fadmin$/, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
});

test('a signed-in student is told the screens are not theirs, with a way back', async ({
  page,
  request,
}) => {
  const session = await establishSession(request, freshEmail('not-an-admin'));
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  await page.goto('/admin');
  const notice = page.getByTestId('admin-not-admin');
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(notice).toContainText(session.email);
  await expect(notice).toContainText('not an administrator');
  await expect(notice.getByRole('link', { name: 'your theses' })).toHaveAttribute('href', '/app');
  // No data sections for a student.
  await expect(page.getByTestId('admin-costs')).toHaveCount(0);
  await expect(page.getByTestId('admin-flags')).toHaveCount(0);
});
