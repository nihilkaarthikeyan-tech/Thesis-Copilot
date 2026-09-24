import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Ten thousand citation styles — found by search, and actually rendered.
 *
 * The part worth a browser is the part that crosses the network: a style that does not ship with
 * the product is fetched from the CSL repository at a pinned commit the first time a student picks
 * it, stored, and rendered. This picks one, and reads the bibliography it produces.
 */

const BIB = `@article{lecun,
  title = {Deep learning},
  author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},
  journal = {Nature},
  year = {2015},
  doi = {10.1038/nature14539}
}
`;

test('a style is found by search, fetched if it does not ship, and renders the bibliography', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const session = await establishSession(request, freshEmail('styles'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);

  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Styles ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  // One real source, resolved against Crossref by the worker.
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

  // A chapter that cites it, saved the way the editor saves.
  const saved = await request.put(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
    headers: { cookie },
    data: {
      baseVersion: 1,
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Chapter 1' }] },
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
  await expect(panel).toBeVisible();

  // APA by default, rendered properly.
  await expect(panel).toContainText('LeCun, Y., Bengio, Y., & Hinton, G. (2015)', {
    timeout: 20_000,
  });
  const search = panel.getByTestId('style-search');
  await expect(search.getByRole('searchbox')).toHaveAttribute('placeholder', /10,\d{3} styles/);

  // A journal's own style, which borrows a shipped parent — nothing to fetch.
  await search.getByRole('searchbox').fill('cleaner production');
  await search
    .getByTestId('style-result')
    .filter({ hasText: 'Journal of Cleaner Production' })
    .click();
  await expect(panel.getByTestId('style-switcher')).toHaveValue('journal-of-cleaner-production', {
    timeout: 20_000,
  });

  // A style that does not ship: fetched from the CSL repository, stored, rendered.
  await search.getByRole('searchbox').fill('Anglia Ruskin');
  const anglia = search.getByTestId('style-result').filter({ hasText: 'Anglia Ruskin' }).first();
  await expect(anglia).toBeVisible({ timeout: 20_000 });
  await anglia.click();
  await expect(panel.getByTestId('style-switcher')).toHaveValue(
    'harvard-anglia-ruskin-university',
    { timeout: 30_000 },
  );
  await expect(panel.getByRole('alert')).toHaveCount(0);
  // Its bibliography is its own, not APA's: Anglia Ruskin joins the last author with "and" and
  // puts the year after the names with a comma — "Bengio, Y. and Hinton, G., 2015."
  await expect(panel).toContainText('Bengio, Y. and Hinton, G., 2015', { timeout: 20_000 });
  await expect(panel).not.toContainText('LeCun, Y., Bengio, Y., & Hinton, G. (2015)');

  // Footnote styles are listed, and say why they cannot be chosen.
  await search.getByRole('searchbox').fill('chicago notes');
  const notes = search.getByTestId('style-result').filter({ hasText: 'Chicago' }).first();
  await expect(notes).toBeVisible({ timeout: 20_000 });
  await expect(notes).toBeDisabled();
  await expect(notes).toContainText('Footnote style');
});
