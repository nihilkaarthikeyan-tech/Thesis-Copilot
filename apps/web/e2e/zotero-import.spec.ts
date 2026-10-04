import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * "From Zotero" on the Library tab — ADR-0062.
 *
 * The API's two Zotero routes are route-mocked here: Zotero is called by the API, never by the
 * browser, and the API side (the real fetch to Zotero, the resolve pipeline, the key kept out of
 * every table and log) is `apps/api/test/zotero-import.spec.ts`. This proves the screen: the key
 * goes in the body of a POST to our API and nowhere else, the collections arrive in a dropdown,
 * the chosen one is sent, and the result is reported like a file import.
 */
test('a student imports one Zotero collection by key', async ({ page, request }) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('zotero-import'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Zotero import ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string };

  const KEY = 'Zk7Lq2Wm9Xp4Rt6Yv8Bn3Cd5';
  const sent: Array<{ path: string; body: Record<string, unknown> }> = [];
  const zoteroHosts: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('zotero.org')) zoteroHosts.push(r.url());
  });
  await page.route(`${API_URL}/api/v1/documents/${doc.id}/sources/zotero/*`, async (route) => {
    const path = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    sent.push({ path, body: route.request().postDataJSON() as Record<string, unknown> });
    if (path === 'collections') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cap: 500,
          collections: [
            { key: 'BCDF2345', name: 'Thesis', parentKey: null, numItems: 40 },
            { key: 'GHJK6789', name: 'Chapter 2', parentKey: 'BCDF2345', numItems: 12 },
          ],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entries: 12,
        skipped: 1,
        notReferences: 2,
        queued: 10,
        alreadyPresent: 2,
      }),
    });
  });

  await page.goto(`/app/d/${doc.id}/sources`);
  await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('zotero-open').click();
  const dialog = page.getByTestId('zotero-dialog');
  await expect(dialog.getByRole('link', { name: 'zotero.org/settings/keys' })).toHaveAttribute(
    'href',
    'https://www.zotero.org/settings/keys',
  );
  await dialog.getByLabel('Zotero user ID').fill('4419137');
  await dialog.getByLabel('API key (read-only)').fill(KEY);
  await dialog.getByRole('button', { name: 'Check key' }).click();

  const choice = dialog.getByTestId('zotero-collection');
  await expect(choice.locator('option')).toHaveText([
    'The whole library',
    'Thesis (40)',
    'Thesis / Chapter 2 (12)',
  ]);
  await choice.selectOption('GHJK6789');
  await dialog.getByTestId('zotero-import').click();

  await expect(page.getByRole('status').first()).toContainText(
    'Imported 10 of 12 references from Zotero; they are being looked up. 2 were already in the library. 1 had no title and no DOI',
  );
  await expect(dialog).not.toBeVisible();
  expect(sent).toEqual([
    { path: 'collections', body: { userId: '4419137', apiKey: KEY } },
    { path: 'import', body: { userId: '4419137', apiKey: KEY, collectionKey: 'GHJK6789' } },
  ]);
  // The browser never talks to Zotero itself; the key goes only to our API, in a body.
  expect(zoteroHosts).toEqual([]);

  // Opening the dialog again starts empty: the key went with it.
  await page.getByTestId('zotero-open').click();
  await expect(dialog.getByLabel('API key (read-only)')).toHaveValue('');
});

test('a refused key is explained in the dialog', async ({ page, request }) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('zotero-refused'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Zotero refused ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string };
  await page.route(`${API_URL}/api/v1/documents/${doc.id}/sources/zotero/collections`, (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'ZOTERO_REFUSED',
        title: 'Zotero refused the key',
        status: 400,
        detail:
          'Zotero refused that key. Check the user ID (the number on the keys page, not your username) and that the key is allowed to read your library.',
      }),
    }),
  );

  await page.goto(`/app/d/${doc.id}/sources`);
  await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('zotero-open').click();
  const dialog = page.getByTestId('zotero-dialog');
  await dialog.getByLabel('Zotero user ID').fill('4419137');
  await dialog.getByLabel('API key (read-only)').fill('WrongKey000000000000000');
  await dialog.getByRole('button', { name: 'Check key' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Zotero refused that key');
  await expect(dialog.getByTestId('zotero-import')).toHaveCount(0);
});
