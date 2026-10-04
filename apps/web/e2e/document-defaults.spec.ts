import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/** A default citation style for new theses, set once in Settings (2026-10-04, Jenni study). */
test('a default style chosen in Settings is pre-selected for a new thesis, and used', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('doc-defaults'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);

  await page.goto('/app/settings');
  const select = page.getByTestId('default-citation-style');
  await expect(select).toBeEnabled({ timeout: 20_000 });
  await select.selectOption('vancouver');
  await expect(select).toHaveValue('vancouver');

  await page.goto('/app/new');
  const styles = page.getByTestId('starting-style');
  await expect(styles.getByRole('radio', { name: 'Vancouver' })).toBeChecked({ timeout: 20_000 });
  await page.getByLabel(/Start from a topic/).check();
  await page.getByLabel('Working title').fill(`Defaults ${Date.now()}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/app\/d\/[0-9a-f-]{36}\/proposal$/, { timeout: 20_000 });
  const id = /\/app\/d\/([0-9a-f-]{36})\//.exec(page.url())?.[1] ?? '';
  const rendered = (await (
    await request.get(`${API_URL}/api/v1/documents/${id}/citations`, { headers: { cookie } })
  ).json()) as { style: string };
  expect(rendered.style).toBe('vancouver');

  // Back to the default: nothing is pre-selected.
  await page.goto('/app/settings');
  await page.getByTestId('default-citation-style').selectOption('');
  await expect(page.getByTestId('default-citation-style')).toHaveValue('');
});

/** The long-job email switch (ADR-0058): on by default, and it stays off once turned off. */
test('the long-job email can be turned off in Settings', async ({ page, request }) => {
  const session = await establishSession(request, freshEmail('job-email'));
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  await page.goto('/app/settings');
  const toggle = page.getByRole('switch', { name: 'Email me when a long job finishes' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.reload();
  await expect(
    page.getByRole('switch', { name: 'Email me when a long job finishes' }),
  ).toHaveAttribute('aria-checked', 'false', { timeout: 20_000 });
});
