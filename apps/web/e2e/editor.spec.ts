import { expect, test } from '@playwright/test';
import { signInThroughTheScreen } from './_session.js';

/**
 * PRD Appendix B.9 test 9 — the week-1 end-to-end proof:
 * type a sentence, press Ctrl+/ against the mocked provider, see ghost text, press Tab, reload,
 * the text persists with ASSIST provenance.
 */
test('B.9 #9: suggestion streams, Tab accepts, text survives a reload with provenance', async ({
  page,
  request,
}) => {
  // Sign in through the real screen and the real OTP flow; the dev sink exposes the code outside
  // production. This is the only spec that drives the form rather than injecting a cookie.
  await signInThroughTheScreen(page, request);
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });

  // Create a thesis and open its first chapter.
  await page.getByLabel('Working title').fill('E2E thesis');
  await page.getByRole('button', { name: 'Create thesis' }).click();
  // Creating opens the new thesis's proposal (2026-10-04); this test continues from the list.
  await expect(page).toHaveURL(/\/app\/d\/[0-9a-f-]{36}\/proposal$/, { timeout: 20_000 });
  await page.goto('/app');
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
  await expect(page.locator('.thesis-editor span.ghost[data-status="shown"]')).toBeVisible();

  // Tab → accepted as real text with ASSIST provenance; ghost widget gone; usage meter moved.
  await page.keyboard.press('Tab');
  await expect(ghost).toHaveCount(0);
  await expect(editor).toContainText('Evidence from rural Karnataka indicates');
  await expect(editor.locator('[data-provenance="ASSIST"]').first()).toContainText('Evidence');
  // This thesis has no indexed sources, so the prompt carried no passages and the model (mock or
  // real, under A.0 rule 3) cited nothing; §10.6 has nothing to strip. The pins E2E in
  // proposal-sources.spec.ts covers the case with a library. A.1 step 3 cut the third sentence.
  await expect(editor.locator('span.citation')).toHaveCount(0);
  await expect(editor).not.toContainText('The following section therefore');
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
  await signInThroughTheScreen(page, request);
  await page.getByLabel('Working title').fill('Dismiss test');
  await page.getByRole('button', { name: 'Create thesis' }).click();
  // Creating opens the new thesis's proposal (2026-10-04); this test continues from the list.
  await expect(page).toHaveURL(/\/app\/d\/[0-9a-f-]{36}\/proposal$/, { timeout: 20_000 });
  await page.goto('/app');
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
