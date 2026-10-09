import { expect, test } from '@playwright/test';
import { freshEmail, signInAs } from './_session.js';

/**
 * ADR-0142: "Email me about comments and replies" under Account — on for a new account, and the
 * choice survives a reload (it is `User.settings.emailOnComments`, which the worker reads).
 */
test('the comment-email switch is on by default and stays off once turned off', async ({
  page,
  request,
}) => {
  await signInAs(page, request, freshEmail('comment-mail'));
  await page.goto('/app/account');
  const toggle = page.getByTestId('comment-email-toggle');
  await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
  await expect(toggle).toBeEnabled();

  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/settings') && r.request().method() === 'PUT',
  );
  await toggle.click();
  expect((await saved).ok()).toBe(true);
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  await page.reload();
  await expect(page.getByTestId('comment-email-toggle')).toHaveAttribute('aria-checked', 'false', {
    timeout: 30_000,
  });
});
