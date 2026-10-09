import { expect, test } from '@playwright/test';
import { type LayoutFault, measureLayout, settle } from './_layout.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * R29 (ADR-0114) in a browser: archive a thesis from its More menu (it leaves the list, Undo
 * brings it straight back), find it under "Archived theses", restore it, and the archive fits its
 * box at every width the owner checks — with a long title, the case that breaks a row.
 */

test('archive a thesis, undo, archive again, and restore it from the archive', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const session = await establishSession(request, freshEmail('archive'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const stamp = Date.now();
  const keep = `Groundwater recharge in hard-rock aquifers ${stamp}`;
  const shelve = `Night-time urban heat islands and heat illness among outdoor workers in coastal Indian cities ${stamp}`;
  for (const title of [keep, shelve]) {
    const created = await request.post(`${API_URL}/api/v1/documents`, {
      headers: { cookie },
      data: { title, entryPath: 'A_TOPIC' },
    });
    expect(created.ok()).toBe(true);
  }

  await page.goto('/app');
  const card = page.locator('li', { hasText: shelve }).first();
  await card.getByText('More', { exact: true }).click();
  await card.getByTestId('archive-thesis').click();

  // Off the list, with Undo.
  await expect(page.getByTestId('archived-notice')).toContainText('nothing deleted');
  await expect(page.locator('li', { hasText: shelve })).toHaveCount(0);
  await expect(page.locator('li', { hasText: keep })).toHaveCount(1);
  await page.getByTestId('archive-undo').click();
  await expect(page.locator('li', { hasText: shelve })).toHaveCount(1);
  await expect(page.getByTestId('archived-theses')).toHaveCount(0);

  // Archived again; the archive lists it, folded until asked for.
  const again = page.locator('li', { hasText: shelve }).first();
  await again.getByText('More', { exact: true }).click();
  await again.getByTestId('archive-thesis').click();
  await expect(page.getByTestId('archived-toggle')).toHaveText('Archived theses (1)');
  await page.getByTestId('archived-toggle').click();
  const row = page.getByTestId('archived-row');
  await expect(row).toContainText(shelve);
  await expect(row).toContainText('archived');

  // The archive open, at every width.
  const found: Array<{ where: string } & LayoutFault> = [];
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await settle(page);
    for (const fault of await page.evaluate(measureLayout, false)) {
      found.push({ where: `${width} thesis list, archive open`, ...fault });
    }
  }
  expect(
    found
      .map((f) => `${f.where}: ${f.kind} ${f.by ?? ''}px ${f.el ?? ''} in ${f.box ?? ''}`)
      .join('\n'),
  ).toBe('');
  await page.setViewportSize({ width: 1280, height: 900 });

  // Still opens by its link while archived.
  await row.getByRole('link', { name: 'Open' }).click();
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });

  await page.goto('/app');
  await page.getByTestId('archived-toggle').click();
  await page.getByTestId('restore-thesis').click();
  await expect(page.locator('li', { hasText: shelve })).toHaveCount(1);
  await expect(page.getByTestId('archived-theses')).toHaveCount(0);

  // Restoring the last one emptied the archive, so it folded: the next archive starts folded.
  const third = page.locator('li', { hasText: shelve }).first();
  await third.getByText('More', { exact: true }).click();
  await third.getByTestId('archive-thesis').click();
  await expect(page.getByTestId('archived-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('archived-list')).toHaveCount(0);
});
