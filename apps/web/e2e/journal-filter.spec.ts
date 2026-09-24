import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The journal figure — ADR-0022 — from resolution to the chat filter.
 *
 * Two real papers: AlphaFold in Nature, a journal OpenAlex scores, and an arXiv preprint, which it
 * does not score as a journal. The library shows the figure for the first and nothing for the
 * second; a chat filter the Nature paper clears still answers, and one it cannot clear leaves
 * nothing to answer from — said plainly, before any model is called.
 */

const BIB = `@article{jumper,
  title = {Highly accurate protein structure prediction with AlphaFold},
  author = {Jumper, John and Evans, Richard},
  journal = {Nature}, year = {2021}, doi = {10.1038/s41586-021-03819-2}
}
@misc{twin,
  title = {A Generative AI Technique for Synthesizing a Digital Twin for U.S. Residential Solar Adoption and Generation},
  author = {Ghosh, Aparna},
  year = {2024}, doi = {10.48550/arXiv.2410.08098}
}
`;

type Source = {
  id: string;
  status: string;
  year: number | null;
  groundingLevel: string;
  venueCitedness: number | null;
};

test('a journal figure is shown, and the chat filter keeps to it', async ({ page, request }) => {
  test.setTimeout(300_000);
  const session = await establishSession(request, freshEmail('journal-filter'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);

  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Journal filter ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  await request.post(`${API_URL}/api/v1/documents/${doc.id}/sources/import`, {
    headers: { cookie },
    multipart: {
      file: { name: 'two.bib', mimeType: 'application/x-bibtex', buffer: Buffer.from(BIB) },
    },
  });

  let library: Source[] = [];
  await expect
    .poll(
      async () => {
        library = (await (
          await request.get(`${API_URL}/api/v1/documents/${doc.id}/sources`, {
            headers: { cookie },
          })
        ).json()) as Source[];
        return (
          library.length === 2 &&
          library.every((s) => s.status === 'RESOLVED' && s.groundingLevel !== 'NONE')
        );
      },
      { timeout: 180_000, intervals: [3_000], message: 'the library never finished reading' },
    )
    .toBe(true);

  const nature = library.find((s) => s.year === 2021);
  const preprint = library.find((s) => s.year === 2024);
  // Nature is scored as a journal; a preprint server is not a journal, whatever OpenAlex says.
  expect(nature?.venueCitedness).toBeGreaterThan(5);
  expect(preprint?.venueCitedness).toBeNull();

  await page.goto(`/app/d/${doc.id}/sources`);
  await expect(page.getByTestId('journal-citedness')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId('journal-citedness')).toContainText('journal citedness');

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'chat', exact: true }).click();
  const panel = page.getByTestId('chat-panel');
  await panel.getByRole('button', { name: 'Filters' }).click();
  const filter = panel.getByTestId('filter-journal-citedness');

  // A bar only Nature clears: the question is answered from Nature alone.
  await filter.fill('5');
  const box = panel.getByRole('textbox', { name: 'Ask about your library' });
  await box.fill('What accuracy does AlphaFold reach in protein structure prediction?');
  const sent = page.waitForRequest(
    (req) => req.url().endsWith('/api/v1/chat') && req.method() === 'POST',
  );
  await panel.getByRole('button', { name: 'Ask', exact: true }).click();
  const body = JSON.parse((await sent).postData() ?? '{}') as {
    filters?: { minJournalCitedness?: number };
  };
  expect(body.filters?.minJournalCitedness).toBe(5);
  const first = panel.locator('[data-role=assistant]').last();
  await expect(first).not.toBeEmpty({ timeout: 120_000 });
  await expect(first).not.toContainText('Your filters left nothing');

  // A bar nothing clears: nothing to answer from, and it says which control to change.
  await filter.fill('1000');
  await box.fill('What accuracy does AlphaFold reach in protein structure prediction?');
  await panel.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(panel.locator('[data-role=assistant]').last()).toContainText(
    'Your filters left nothing',
    { timeout: 60_000 },
  );
});
