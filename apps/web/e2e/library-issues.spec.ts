import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Library hygiene on the real Sources screen (2026-10-04, from the Jenni study).
 *
 * One paper imported twice from a reference manager — once with its DOI, once without one under
 * another spelling of its title — shows up as a possible duplicate once the second is looked up,
 * and "Merge" leaves one record. (Since ADR-0139 two entries with the same DOI are added once, so
 * the duplicate that reaches the student is the one only resolution can recognise.) Then the "Without full
 * text" view lists what the AI can only read the abstract of, says why, and offers "Add the PDF".
 *
 * Needs the dev stack: web, API, the worker (to resolve against Crossref) and Compose.
 */

const BIB = `@article{lecun,
  title = {Deep learning},
  author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},
  journal = {Nature},
  year = {2015},
  doi = {10.1038/nature14539}
}
@article{lecun-again,
  title = {Deep Learning.},
  author = {LeCun, Y. and Bengio, Y. and Hinton, G.},
  journal = {Nature},
  year = {2015}
}
`;

test('a paper imported twice can be merged, and a source without full text takes a PDF', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const session = await establishSession(request, freshEmail('library-issues'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);

  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Library issues ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string };

  await page.goto(`/app/d/${doc.id}/sources`);
  await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('possible-duplicates')).toHaveCount(0);

  await page.locator('input[type=file][accept=".bib,.bibtex,.ris"]').setInputFiles({
    name: 'twice.bib',
    mimeType: 'application/x-bibtex',
    buffer: Buffer.from(BIB, 'utf8'),
  });

  await expect
    .poll(
      async () => {
        await page.reload();
        return (await page.locator('main, body').first().textContent()) ?? '';
      },
      { timeout: 150_000, intervals: [3_000], message: 'the imported references never resolved' },
    )
    .toMatch(/2 in the library(?!.*still looking up)/);

  const panel = page.getByTestId('possible-duplicates');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('duplicate-pair')).toHaveCount(1);
  await expect(panel).toContainText('Same DOI');

  await panel.getByTestId('merge-duplicate').click();
  await expect(page.getByRole('status')).toContainText('Merged');
  await expect(page.getByTestId('possible-duplicates')).toHaveCount(0);
  await expect(page.getByText(/^1 in the library/)).toBeVisible();

  // "Without full text" lists what the AI can only read the abstract of, with the reason and an
  // upload. Whether this paper is in it depends on what Unpaywall finds today, so the view is
  // checked against the badge rather than assumed.
  const missingFilter = page.getByRole('button', { name: /^Without full text/ });
  const missing = Number((await missingFilter.textContent())?.match(/\d+/)?.[0] ?? '0');
  await missingFilter.click();
  if (missing === 1) {
    await expect(page.getByTestId('no-full-text-reason')).toHaveCount(1);
    await expect(page.getByTestId('attach-pdf')).toContainText('Add the PDF');
  } else {
    await expect(page.getByText('Nothing matches that filter.')).toBeVisible();
  }
});
