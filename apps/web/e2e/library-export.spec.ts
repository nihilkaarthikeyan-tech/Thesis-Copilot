import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The library's way out — a round trip through the real screen.
 *
 * Import has existed since FR-2.9; export did not, so a library built here could not leave. This
 * imports two real references the way a student arriving from Zotero would, lets the worker look
 * them up, and then downloads the library through the same links the student clicks — and opens
 * the files, which is the part that matters.
 */

const BIB = `@article{lecun,
  title = {Deep learning},
  author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},
  journal = {Nature},
  year = {2015},
  doi = {10.1038/nature14539}
}
@article{jumper,
  title = {Highly accurate protein structure prediction with AlphaFold},
  author = {Jumper, John and Evans, Richard},
  journal = {Nature},
  year = {2021},
  doi = {10.1038/s41586-021-03819-2}
}
`;

test('a library imported from Zotero can be exported again as .bib and .csv', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const session = await establishSession(request, freshEmail('library-export'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);

  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Library export ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string };

  await page.goto(`/app/d/${doc.id}/sources`);
  await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible({ timeout: 30_000 });
  // Nothing to export yet, so nothing offered.
  await expect(page.getByTestId('library-export')).toHaveCount(0);

  await page.locator('input[type=file][accept=".bib,.bibtex,.ris"]').setInputFiles({
    name: 'from-zotero.bib',
    mimeType: 'application/x-bibtex',
    buffer: Buffer.from(BIB, 'utf8'),
  });

  // Both looked up against Crossref by the worker. The count line says when that is done.
  await expect
    .poll(
      async () => {
        await page.reload();
        return (await page.locator('main, body').first().textContent()) ?? '';
      },
      { timeout: 150_000, intervals: [3_000], message: 'the imported references never resolved' },
    )
    .toMatch(/2 in the library(?!.*still looking up)/);

  const exportBar = page.getByTestId('library-export');
  await expect(exportBar).toBeVisible();

  // .bib, through the link the student clicks.
  const [bibDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('library-export-bib').click(),
  ]);
  expect(bibDownload.suggestedFilename()).toMatch(/-library\.bib$/);
  const bib = readFileSync((await bibDownload.path()) as string, 'utf8');
  expect(bib).toMatch(/@article\{LeCun2015Deep,/);
  expect(bib).toMatch(/@article\{Jumper2021Highly,/);
  expect(bib).toContain('10.1038/nature14539');
  expect(bib).toContain('10.1038/s41586-021-03819-2');

  // .csv, which a spreadsheet will open.
  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('library-export-csv').click(),
  ]);
  expect(csvDownload.suggestedFilename()).toMatch(/-library\.csv$/);
  const csv = readFileSync((await csvDownload.path()) as string, 'utf8');
  const rows = csv.replace(/^﻿/, '').split('\r\n').filter(Boolean);
  expect(rows[0]).toMatch(/^Key,Title,Authors,Year,Venue,DOI/);
  expect(rows).toHaveLength(3);
  expect(csv).toContain('LeCun2015Deep');
  expect(csv).toContain('Jumper2021Highly');
});

test('someone else cannot export your library', async ({ request, playwright }) => {
  const owner = await establishSession(request, freshEmail('library-owner'));
  const strangerContext = await playwright.request.newContext();
  const stranger = await establishSession(strangerContext, freshEmail('library-stranger'));

  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie: `${owner.cookieName}=${owner.cookieValue}` },
    data: { title: `Private library ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string };

  const response = await strangerContext.get(
    `${API_URL}/api/v1/documents/${doc.id}/sources/export?format=bib`,
    { headers: { cookie: `${stranger.cookieName}=${stranger.cookieValue}` } },
  );
  expect(response.status()).toBe(404);

  const badFormat = await request.get(
    `${API_URL}/api/v1/documents/${doc.id}/sources/export?format=docx`,
    { headers: { cookie: `${owner.cookieName}=${owner.cookieValue}` } },
  );
  expect(badFormat.status()).toBe(400);
  await strangerContext.dispose();
});
