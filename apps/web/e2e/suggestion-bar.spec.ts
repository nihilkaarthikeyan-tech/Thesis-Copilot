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

  // Thumbs: recorded on the server, and pressed again to take back.
  const useful = bar.getByRole('button', { name: 'Useful suggestion', exact: true });
  const rated = page.waitForResponse(
    (r) => r.url().endsWith('/assist/rating') && r.request().method() === 'POST',
  );
  await useful.click();
  expect((await rated).status()).toBe(201);
  await expect(useful).toHaveAttribute('aria-pressed', 'true');
  await useful.click();
  await expect(useful).toHaveAttribute('aria-pressed', 'false');

  await history.getByRole('button', { name: 'Previous suggestion' }).click();
  await expect(history).toContainText('1 of 2');
  await expect(ghost).toHaveText(first);
  await bar.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(bar).toHaveCount(0);
  await expect(editor).toContainText(first.slice(0, 30));
});

/**
 * ADR-0155 item 9 (the Word test, 2026-10-16): the bar sat over the next heading. The block the
 * suggestion is in now makes room for the bar, so at every width the bar covers no line of text:
 * not the heading below, not the suggestion, not the paragraph above.
 */
for (const width of [360, 430, 768, 1024, 1440]) {
  test.describe(`the bar covers no text at ${width}`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('with a heading straight after the paragraph', async ({ page, request }) => {
      test.setTimeout(180_000);
      const session = await establishSession(request, freshEmail(`bar-${width}`));
      await page
        .context()
        .addCookies([
          { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
        ]);
      const created = await request.post(`${API_URL}/api/v1/documents`, {
        headers: { cookie: `${session.cookieName}=${session.cookieValue}` },
        data: { title: `Bar over heading ${Date.now()}`, entryPath: 'A_TOPIC' },
      });
      const doc = (await created.json()) as { id: string; firstChapterId: string };
      await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
      const editor = page.locator('.thesis-editor');
      await expect(editor).toBeVisible({ timeout: 30_000 });
      await editor.locator('p').first().click();
      await page.keyboard.type(
        'Rooftop solar adoption among rural households remains low despite subsidies. ',
      );
      await page.keyboard.press('Enter');
      await page.keyboard.type('Objectives and research questions');
      await page.getByRole('combobox', { name: 'Text' }).selectOption('Heading');
      // Back to the end of the paragraph, right above the heading.
      await editor.locator('h2').click({ position: { x: 4, y: 6 } });
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowLeft');

      const bar = page.getByTestId('suggestion-bar');
      const shown = page.locator('.thesis-editor span.ghost[data-status="shown"]');
      for (let attempt = 0; attempt < 3; attempt++) {
        await page.keyboard.press('Control+/');
        try {
          await expect(shown).toBeVisible({ timeout: 30_000 });
          break;
        } catch (error) {
          if (attempt === 2) throw error;
        }
      }
      await expect(bar).toBeVisible();
      await page.waitForTimeout(300);

      const covered = await page.evaluate(() => {
        const box = document
          .querySelector('[data-testid="suggestion-bar"]')
          ?.getBoundingClientRect();
        if (!box) return ['no bar'];
        const out: string[] = [];
        const root = document.querySelector('.thesis-editor');
        if (!root) return ['no editor'];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent?.trim() ?? '';
          if (!text) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const r of Array.from(range.getClientRects())) {
            const overlaps =
              r.width > 0 &&
              r.height > 0 &&
              r.left < box.right &&
              r.right > box.left &&
              r.top < box.bottom &&
              r.bottom > box.top;
            if (overlaps) out.push(text.slice(0, 40));
          }
        }
        return out;
      });
      expect(covered, `the bar covers: ${covered.join(' | ')}`).toEqual([]);
    });
  });
}
