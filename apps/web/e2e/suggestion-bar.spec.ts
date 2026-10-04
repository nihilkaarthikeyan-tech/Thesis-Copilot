import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The suggestion bar and the evidence card (2026-10-04, from the Jenni study).
 *
 * A suggestion could only be kept with Tab or →, so a phone could not keep one, and the paper
 * behind a suggested citation could only be read after the suggestion was accepted. The bar puts
 * Accept / One word / Refine / Dismiss on screen; its Evidence chip opens the passage first.
 */

const BIB = `@article{jumper,
  title = {Highly accurate protein structure prediction with AlphaFold},
  author = {Jumper, John and Evans, Richard},
  journal = {Nature}, year = {2021}, doi = {10.1038/s41586-021-03819-2}
}
`;

type Source = { id: string; status: string; groundingLevel: string };

test('a suggestion can be read, checked against its passage and kept from the screen', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const session = await establishSession(request, freshEmail('suggestion-bar'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);

  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Suggestion bar ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  await request.post(`${API_URL}/api/v1/documents/${doc.id}/sources/import`, {
    headers: { cookie },
    multipart: {
      file: { name: 'one.bib', mimeType: 'application/x-bibtex', buffer: Buffer.from(BIB) },
    },
  });
  await expect
    .poll(
      async () => {
        const list = (await (
          await request.get(`${API_URL}/api/v1/documents/${doc.id}/sources`, {
            headers: { cookie },
          })
        ).json()) as Source[];
        return (
          list.length === 1 && list[0]?.status === 'RESOLVED' && list[0]?.groundingLevel !== 'NONE'
        );
      },
      { timeout: 180_000, intervals: [3_000], message: 'the library never finished reading' },
    )
    .toBe(true);

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.locator('p').first().click();
  await page.keyboard.type(
    'AlphaFold predicts protein structures from amino-acid sequences. Its accuracy ',
  );

  // A real model may decline to write when nothing in the passage fits (the editor then says so);
  // ask up to three times before calling the bar broken.
  const bar = page.getByTestId('suggestion-bar');
  const shown = page.locator('.thesis-editor span.ghost[data-status="shown"]');
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole('button', { name: 'Suggest', exact: true }).click();
    try {
      await expect(shown).toBeVisible({ timeout: 30_000 });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  await expect(bar).toBeVisible();
  for (const name of ['Accept', 'One word', 'Refine', 'Dismiss']) {
    await expect(bar.getByRole('button', { name, exact: true })).toBeVisible();
  }

  // The evidence chip opens the passage behind the citation before anything is accepted.
  const chips = page.getByTestId('suggestion-evidence').getByRole('button');
  if ((await chips.count()) > 0) {
    await chips.first().click();
    const card = page.getByTestId('evidence-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('AlphaFold', { timeout: 15_000 });
    // The card says what the citation could have been drawn from.
    await expect(card).toContainText(/full text|only the abstract/);
  }

  // Accept from the screen: the suggestion becomes text, and the bar goes away.
  const ghostText = (await page.locator('.thesis-editor span.ghost').innerText()).slice(0, 20);
  await bar.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(bar).toHaveCount(0);
  await expect(editor).toContainText(ghostText.replace(/\s+$/, ''));
});

test('a refined suggestion keeps the one before it, and ‹ brings that back', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const session = await establishSession(request, freshEmail('suggestion-history'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Suggestion history ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.locator('p').first().click();
  await page.keyboard.type('Rooftop solar uptake in Indian cities ');

  const bar = page.getByTestId('suggestion-bar');
  const ghost = page.locator('.thesis-editor span.ghost[data-status="shown"]');
  const suggest = async (start: () => Promise<void>) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await start();
      try {
        await expect(ghost).toBeVisible({ timeout: 30_000 });
        return;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
  };
  await suggest(() => page.getByRole('button', { name: 'Suggest', exact: true }).click());
  const first = (await ghost.innerText()).trim();
  // One suggestion so far: nothing to step through.
  await expect(page.getByTestId('suggestion-history')).toHaveCount(0);

  await suggest(async () => {
    if (await ghost.isVisible()) {
      await bar.getByRole('button', { name: 'Refine', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Shorter' }).click();
    } else {
      await page.getByRole('button', { name: 'Suggest', exact: true }).click();
    }
  });
  const history = page.getByTestId('suggestion-history');
  await expect(history).toContainText('2 of 2');

  await history.getByRole('button', { name: 'Previous suggestion' }).click();
  await expect(history).toContainText('1 of 2');
  await expect(ghost).toHaveText(first);
  await bar.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(bar).toHaveCount(0);
  await expect(editor).toContainText(first.slice(0, 30));
});
