import { expect, test } from '@playwright/test';
import { openHeaderMenu } from './_editor.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * ADR-0061: Hindi chosen in Settings changes the editor's labels, survives a reload, and does not
 * touch the thesis text. English stays the default, so every other spec reads what it always did.
 */
test('switching the interface to Hindi relabels the editor and survives a reload', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('hindi'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Hindi ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  // English first: the default, and the labels the rest of the suite relies on.
  await page.goto('/app/settings');
  const picker = page.getByTestId('interface-language');
  await expect(picker).toHaveValue('en');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();

  // The screen changes at once; the account is saved alongside. Wait for that save, or leaving
  // the page could cancel it.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/settings') && r.request().method() === 'PUT',
    ),
    picker.selectOption('hi'),
  ]);
  await expect(page.getByRole('heading', { name: 'सेटिंग्स', level: 1 })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('tab', { name: 'चैट', exact: true })).toBeVisible();
  // ADR-0137: History lives in the header's ⋯ menu.
  await openHeaderMenu(page);
  await expect(
    page.getByRole('menuitem', { name: 'इतिहास' }).or(page.getByRole('button', { name: 'इतिहास' })),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'बोल्ड (Ctrl+B)' })).toBeVisible();

  // Reloaded: the server renders Hindi from the cookie, and the account agrees.
  await page.reload();
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('tab', { name: 'चैट', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  const settings = await request.get(`${API_URL}/api/v1/settings`, { headers: { cookie } });
  expect(((await settings.json()) as { interfaceLanguage?: string }).interfaceLanguage).toBe('hi');

  // And back, so nothing else this browser context does is in Hindi.
  await page.goto('/app/settings');
  await page.getByTestId('interface-language').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
});

test('the sign-in page offers Hindi and keeps it for the next visit', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: 'Sign in or create an account' })).toBeVisible();
  await page.getByRole('button', { name: 'हिन्दी (बीटा)' }).click();
  await expect(page.getByRole('heading', { name: 'साइन इन करें या अकाउंट बनाएँ' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'साइन इन करें या अकाउंट बनाएँ' })).toBeVisible();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in or create an account' })).toBeVisible();
});
