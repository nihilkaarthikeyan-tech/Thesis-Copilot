import { expect, test } from '@playwright/test';
import { docxEntry } from './_docx.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The citation locale (ADR-0065): chosen in the Citations tab beside the style, it changes the
 * bibliography, the style preview and the export together. Harvard (Cite Them Right) shows it
 * plainly: en-US writes “Deep learning,” and en-GB ‘Deep learning’.
 */

const BIB = `@article{lecun,
  title = {Deep learning},
  author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},
  journal = {Nature},
  year = {2015},
  doi = {10.1038/nature14539}
}
`;

test('the citation language changes the bibliography, the preview and the export', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const session = await establishSession(request, freshEmail('locale'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);

  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Locale ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  await request.put(`${API_URL}/api/v1/documents/${doc.id}/citation-style`, {
    headers: { cookie },
    data: { style: 'harvard' },
  });

  const imported = await request.post(`${API_URL}/api/v1/documents/${doc.id}/sources/import`, {
    headers: { cookie },
    multipart: {
      file: { name: 'one.bib', mimeType: 'application/x-bibtex', buffer: Buffer.from(BIB) },
    },
  });
  expect(imported.ok(), `import: ${imported.status()}`).toBe(true);
  let sourceId = '';
  await expect
    .poll(
      async () => {
        const list = (await (
          await request.get(`${API_URL}/api/v1/documents/${doc.id}/sources`, {
            headers: { cookie },
          })
        ).json()) as Array<{ id: string; status: string }>;
        sourceId = list[0]?.id ?? '';
        return list[0]?.status;
      },
      { timeout: 120_000, intervals: [2_000], message: 'the source never resolved' },
    )
    .toBe('RESOLVED');

  const saved = await request.put(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
    headers: { cookie },
    data: {
      baseVersion: 1,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Deep networks learn representations ' },
              { type: 'citation', attrs: { key: 'c1', sourceId } },
              { type: 'text', text: '.' },
            ],
          },
        ],
      },
    },
  });
  expect(saved.ok(), `save: ${saved.status()}`).toBe(true);

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'citations' }).click();
  const panel = page.getByTestId('citations-panel');
  const bibliography = panel.getByTestId('bibliography');

  // Automatic: an English thesis renders as it always has.
  const locale = panel.getByTestId('locale-switcher');
  await expect(locale).toHaveValue('');
  await expect(locale.locator('option').first()).toHaveText(/Automatic: English \(US\)/);
  await expect(bibliography).toContainText('“Deep learning,”', { timeout: 20_000 });
  await expect(panel.getByTestId('style-preview-bibliography')).toContainText('“An example');

  // British English: the bibliography and the preview change together; no chapter is touched.
  await locale.selectOption('en-GB');
  await expect(bibliography).toContainText('‘Deep learning’', { timeout: 20_000 });
  await expect(panel.getByTestId('style-preview-bibliography')).toContainText('‘An example', {
    timeout: 20_000,
  });
  await expect(panel.getByRole('alert')).toHaveCount(0);

  // The export prints what the panel shows.
  const exported = await request.post(`${API_URL}/api/v1/documents/${doc.id}/export`, {
    headers: { cookie },
    data: { chapterId: doc.firstChapterId, format: 'docx' },
  });
  expect(exported.ok(), `export: ${exported.status()}`).toBe(true);
  const { url } = (await exported.json()) as { url: string };
  const bytes = Buffer.from(await (await request.get(url)).body());
  expect(docxEntry(bytes, 'word/document.xml')).toContain('‘Deep learning’');

  // Back to automatic.
  await locale.selectOption('');
  await expect(bibliography).toContainText('“Deep learning,”', { timeout: 20_000 });
});
