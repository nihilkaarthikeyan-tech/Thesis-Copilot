import { expect, test } from '@playwright/test';
import { onePagePdf } from './_pdf.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Collections (folders) in the library, on the real Sources screen (2026-10-04, from the Jenni
 * study): make one, tick a paper into it, filter by it, rename it, and delete it — the paper stays.
 *
 * Needs the dev stack: web, API and Compose (the uploads are stored in MinIO).
 */
test('a student groups papers into a collection, filters by it, renames and deletes it', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('collections'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Collections ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string };

  for (const name of ['Aquifer recharge methods', 'Groundwater policy in India']) {
    const uploaded = await request.post(`${API_URL}/api/v1/documents/${doc.id}/sources/upload`, {
      headers: { cookie },
      multipart: {
        file: {
          name: `${name}.pdf`,
          mimeType: 'application/pdf',
          buffer: onePagePdf([name, 'A short paper used by the collections test.']),
        },
      },
    });
    expect(uploaded.ok()).toBe(true);
  }

  await page.goto(`/app/d/${doc.id}/sources`);
  await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible({ timeout: 30_000 });
  const strip = page.getByTestId('collections-strip');
  await expect(strip).toBeVisible();
  await expect(page.getByTestId('library-row')).toHaveCount(2);

  // Make "Methods"; the strip switches to it, and it is empty.
  await page.getByTestId('new-collection').click();
  await page.getByTestId('collection-name').fill('  Methods ');
  await page.getByTestId('collection-save').click();
  await expect(strip.getByTestId('collection-chip')).toHaveText(['Methods 0']);
  await expect(page.getByText('This collection is empty.')).toBeVisible();

  // A second "methods" is refused before it reaches the server.
  await page.getByTestId('new-collection').click();
  await page.getByTestId('collection-name').fill('methods');
  await page.getByTestId('collection-save').click();
  await expect(strip.getByRole('alert')).toContainText('already a collection called "Methods"');
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Tick the methods paper under All and add it.
  await strip.getByRole('button', { name: /^All papers 2$/ }).click();
  const row = page.getByTestId('library-row').filter({ hasText: 'Aquifer recharge methods' });
  await row.getByTestId('select-source').check();
  await expect(page.getByTestId('selection-bar')).toContainText('1 selected');
  await page.getByTestId('add-to-collection').selectOption({ label: 'Methods' });
  await expect(page.getByRole('status')).toContainText('Added 1 paper to Methods.');
  await expect(strip.getByTestId('collection-chip')).toHaveText(['Methods 1']);
  await expect(row.getByTestId('row-collections')).toContainText('Methods');

  // Filtering by it shows just that paper; the full-text filters still apply on top.
  await strip.getByTestId('collection-chip').click();
  await expect(page.getByTestId('library-row')).toHaveCount(1);
  await expect(page.getByTestId('library-row')).toContainText('Aquifer recharge methods');
  await expect(strip.getByRole('button', { name: /^Not in a collection 1$/ })).toBeVisible();

  // Rename it.
  await page.getByTestId('collection-rename').click();
  await page.getByTestId('collection-name').fill('Methods and data');
  await page.getByTestId('collection-save').click();
  await expect(strip.getByTestId('collection-chip')).toHaveText(['Methods and data 1']);

  // Take the paper out, put it back, then delete the collection: the paper stays.
  await page.getByTestId('select-source').check();
  await page.getByTestId('remove-from-collection').click();
  await expect(page.getByRole('status')).toContainText('still in your library');
  await expect(page.getByTestId('library-row')).toHaveCount(0);

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('collection-delete').click();
  await expect(strip.getByTestId('collection-chip')).toHaveCount(0);
  await expect(page.getByTestId('library-row')).toHaveCount(2);
  await expect(page.getByText(/^2 in the library/)).toBeVisible();
});
