import { expect, test } from '@playwright/test';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * PRD Appendix B.9 test 9 — the week-1 end-to-end proof:
 * type a sentence, press Ctrl+/ against the mocked provider, see ghost text, press Tab, reload,
 * the text persists with ASSIST provenance.
 */
test('B.9 #9: suggestion streams, Tab accepts, text survives a reload with provenance', async ({
  page,
  request,
}) => {
  const email = `e2e-${Date.now()}@example.com`;

  // Sign in through the real OTP flow; the dev sink exposes the code outside production.
  await page.goto('/sign-in');
  await page.getByLabel('University or personal email').fill(email);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByLabel('Six-digit code')).toBeVisible();
  const otpRes = await request.get(
    `${API_URL}/api/v1/auth/dev/last-otp?email=${encodeURIComponent(email)}`,
  );
  expect(otpRes.ok()).toBe(true);
  const { otp } = (await otpRes.json()) as { otp: string };
  await page.getByLabel('Six-digit code').fill(otp);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });

  // Create a thesis and open its first chapter.
  await page.getByLabel('Working title').fill('E2E thesis');
  await page.getByRole('button', { name: 'Create thesis' }).click();
  const link = page.getByRole('link', { name: 'E2E thesis' });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/write\/[0-9a-f-]{36}$/, { timeout: 20_000 });

  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('usage-meter')).toContainText('Assist 0/');

  // Type into the empty paragraph after the chapter heading.
  await editor.locator('p').first().click();
  await page.keyboard.type('Prior studies in Karnataka found ');

  // Ctrl+/ → ghost text appears; it is a decoration, not document text.
  await page.keyboard.press('Control+/');
  const ghost = editor.locator('span.ghost');
  await expect(ghost).toBeVisible({ timeout: 10_000 });
  await expect(ghost).toContainText('Evidence from rural Karnataka', { timeout: 10_000 });
  await expect(page.getByTestId('dev-timing')).toContainText('shown');

  // Tab → accepted as real text with ASSIST provenance; ghost widget gone; usage meter moved.
  await page.keyboard.press('Tab');
  await expect(ghost).toHaveCount(0);
  await expect(editor).toContainText('Evidence from rural Karnataka indicates');
  await expect(editor.locator('[data-provenance="ASSIST"]').first()).toContainText('Evidence');
  await expect(editor.locator('span.citation')).toHaveCount(1);
  await expect(page.getByTestId('usage-meter')).toContainText('Assist 1/');

  // Autosave (2 s debounce), then reload: the accepted text and its provenance persist.
  await expect(page.getByTestId('autosave-status')).toHaveText('Saved', { timeout: 6_000 });
  await page.reload();
  const again = page.locator('.thesis-editor');
  await expect(again).toContainText('Prior studies in Karnataka found', { timeout: 10_000 });
  await expect(again).toContainText('Evidence from rural Karnataka indicates');
  await expect(again.locator('[data-provenance="ASSIST"]').first()).toBeVisible();
  await expect(again.locator('span.ghost')).toHaveCount(0);
});

test('typing while a suggestion is shown dismisses it; Tab in a list indents', async ({
  page,
  request,
}) => {
  const email = `e2e-b-${Date.now()}@example.com`;
  await page.goto('/sign-in');
  await page.getByLabel('University or personal email').fill(email);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  const { otp } = (await (
    await request.get(`${API_URL}/api/v1/auth/dev/last-otp?email=${encodeURIComponent(email)}`)
  ).json()) as { otp: string };
  await page.getByLabel('Six-digit code').fill(otp);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Working title').fill('Dismiss test');
  await page.getByRole('button', { name: 'Create thesis' }).click();
  await page.getByRole('link', { name: 'Dismiss test' }).click();

  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await editor.locator('p').first().click();
  await page.keyboard.type('Some context ');
  await page.keyboard.press('Control+/');
  await expect(editor.locator('span.ghost')).toBeVisible({ timeout: 10_000 });
  await page.keyboard.type('x');
  await expect(editor.locator('span.ghost')).toHaveCount(0);
  await expect(editor).not.toContainText('Evidence from rural');

  // A list: Tab without a suggestion indents (B.9 test 4, in the real browser).
  await page.keyboard.press('Enter');
  await page.keyboard.type('- first');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second');
  await page.keyboard.press('Tab');
  await expect(editor.locator('ul ul li')).toHaveCount(1);
});
