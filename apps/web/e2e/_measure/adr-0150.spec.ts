import { mkdirSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from '../_session.js';

/**
 * ADR-0150 proof on the mock stack (MEASURE=1): the side-by-side's editor faults, one per step,
 * each with a screenshot in `SHOTS` (default: test-results/adr-0150).
 */

const SHOTS = process.env.SHOTS ?? 'test-results/adr-0150';
mkdirSync(SHOTS, { recursive: true });

const BIB = `@article{jumper,
  title = {Highly accurate protein structure prediction with AlphaFold},
  author = {Jumper, John and Evans, Richard and Pritzel, Alexander},
  journal = {Nature}, year = {2021}, doi = {10.1038/s41586-021-03819-2}
}
`;

type Source = { id: string; status: string; groundingLevel: string };

async function seed(page: Page, request: Parameters<typeof establishSession>[0]) {
  const session = await establishSession(request, freshEmail('adr0150'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `ADR-0150 ${Date.now()}`, entryPath: 'A_TOPIC' },
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
      { timeout: 180_000, intervals: [2_000] },
    )
    .toBe(true);
  return { doc, cookie };
}

async function suggest(page: Page) {
  const shown = page.locator('.thesis-editor span.ghost[data-status="shown"]');
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole('button', { name: 'Suggest', exact: true }).click();
    try {
      await expect(shown).toBeVisible({ timeout: 30_000 });
      return;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}

test('ADR-0150: bar under its text, one layer at a time, styled labels, preview, edit menu', async ({
  page,
  request,
}) => {
  test.setTimeout(400_000);
  const { doc } = await seed(page, request);
  await page.setViewportSize({ width: Number(process.env.WIDTH ?? 1440), height: 900 });
  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.locator('p').first().click();
  await page.keyboard.type(
    'AlphaFold predicts protein structures from amino-acid sequences. Its accuracy ',
  );
  await suggest(page);

  // 1. The bar is anchored and does not cover the suggestion's text.
  const bar = page.getByTestId('suggestion-bar');
  await expect(bar).toHaveAttribute('data-anchored', 'true');
  const ghostBox = await page.locator('.thesis-editor span.ghost').boundingBox();
  const barBox = await bar.boundingBox();
  expect(ghostBox && barBox).toBeTruthy();
  if (ghostBox && barBox) {
    const overlaps =
      barBox.y < ghostBox.y + ghostBox.height && barBox.y + barBox.height > ghostBox.y;
    expect(overlaps, `bar ${JSON.stringify(barBox)} ghost ${JSON.stringify(ghostBox)}`).toBe(false);
  }
  await page.screenshot({ path: `${SHOTS}/1-bar-under-text.png` });

  // 4. The ghost label is the thesis style's label, the same text the node shows once kept.
  const ghostText = await page.locator('.thesis-editor span.ghost').innerText();
  console.log('GHOST', ghostText);

  // 2. Evidence card, then Refine: only the menu is open; a refined suggestion has no card.
  const chips = page.getByTestId('suggestion-evidence').getByRole('button');
  if ((await chips.count()) > 0) {
    await chips.first().click();
    await expect(page.getByTestId('evidence-card')).toBeVisible();
    await bar.getByRole('button', { name: 'Refine', exact: true }).click();
    await expect(page.getByTestId('refine-menu')).toBeVisible();
    await expect(page.getByTestId('evidence-card')).toHaveCount(0);
    const menuBox = await page.getByTestId('refine-menu').boundingBox();
    const vh = page.viewportSize()?.height ?? 0;
    expect(menuBox && menuBox.y >= 0 && menuBox.y + menuBox.height <= vh, 'menu in window').toBe(
      true,
    );
    await page.screenshot({ path: `${SHOTS}/2a-refine-closes-card.png` });
    await page.getByTestId('refine-menu').getByRole('menuitem').first().click();
    await expect(page.locator('.thesis-editor span.ghost[data-status="shown"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('evidence-card')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/2b-refined-no-card.png` });
  } else {
    console.log('NO-EVIDENCE-CHIP');
  }

  const shownNow = await page.locator('.thesis-editor span.ghost').innerText();
  await bar.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(page.locator('.thesis-editor span.citation').first()).toBeVisible();
  // An accepted suggestion may chain the next one; it is not part of this check.
  if ((await bar.count()) > 0)
    await bar.getByRole('button', { name: 'Dismiss', exact: true }).click();
  const nodeLabels = await page.locator('.thesis-editor span.citation').allInnerTexts();
  console.log('SHOWN', shownNow, 'NODES', JSON.stringify(nodeLabels));
  for (const label of nodeLabels) expect(shownNow).toContain(label.trim());
  await page.screenshot({ path: `${SHOTS}/4-accepted-labels.png` });

  // 5. The export preview draws the citation.
  await page.waitForTimeout(2_500); // autosave
  await page.getByTestId('open-export').click();
  const preview = page.getByTestId('export-dialog').getByTestId('layout-preview');
  await expect(preview).toBeVisible({ timeout: 20_000 });
  const previewText = await preview.innerText();
  console.log('PREVIEW', previewText.slice(0, 400));
  for (const label of nodeLabels) expect(previewText).toContain(label.trim());
  expect(previewText).not.toMatch(/\s\./);
  await page.screenshot({ path: `${SHOTS}/5-preview-citation.png` });
  await page.keyboard.press('Escape');

  // 3. The selection edit menu closes on Escape.
  await editor.locator('p').first().click({ clickCount: 3 });
  const toolbar = page.getByTestId('command-toolbar');
  await expect(toolbar).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: `${SHOTS}/3a-edit-menu-open.png` });
  console.log(
    'BEFORE-ESC',
    await page.evaluate(() => ({
      active: `${document.activeElement?.tagName}.${document.activeElement?.className}`,
      ghost:
        document.querySelector('.thesis-editor span.ghost')?.getAttribute('data-status') ?? 'none',
    })),
  );
  await page.evaluate(() => {
    window.addEventListener('keydown', (e) => {
      console.log('WINKEY', e.key, e.defaultPrevented);
    });
  });
  page.on('console', (m) => {
    if (m.text().includes('WINKEY') || m.type() === 'error') console.log('PAGE', m.text());
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  console.log('SEL', await page.evaluate(() => String(window.getSelection())));
  await expect(toolbar).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/3b-edit-menu-closed-escape.png` });
  // …and on Discard after a result.
  await editor.locator('p').first().click({ clickCount: 3 });
  await expect(toolbar).toBeVisible({ timeout: 10_000 });
  await toolbar.getByRole('button', { name: 'Expand' }).click();
  await expect(page.getByTestId('command-diff')).toBeVisible({ timeout: 30_000 });
  await toolbar.getByRole('button', { name: 'Discard' }).click();
  await expect(toolbar).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/3c-edit-menu-closed-discard.png` });

  // 6. The library header.
  await page.goto(`/app/d/${doc.id}/sources`);
  await page.waitForTimeout(3_000);
  await page.screenshot({ path: `${SHOTS}/6-library-header.png` });

  // 8. Undo after typing does not remove headings; the caret starts on a writable line.
  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(editor).toBeVisible({ timeout: 30_000 });
  const headingsBefore = await editor.locator('h2, h3').count();
  await page.keyboard.press('Control+z');
  expect(await editor.locator('h2, h3').count()).toBe(headingsBefore);
});

test('ADR-0150: a chapter with section headings opens with the caret on a writable line', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('adr0150-caret'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `ADR-0150 caret ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  const chapter = (await (
    await request.get(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, { headers: { cookie } })
  ).json()) as { version: number };
  const h = (level: number, text: string) => ({
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }],
  });
  const saved = await request.put(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
    headers: { cookie },
    data: {
      baseVersion: chapter.version,
      content: {
        type: 'doc',
        content: [
          h(1, 'Introduction'),
          h(2, 'Background'),
          { type: 'paragraph' },
          h(2, 'Problem statement'),
          { type: 'paragraph' },
        ],
      },
    },
  });
  expect(saved.ok()).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_500);
  await editor.focus();
  await page.keyboard.type('First typed sentence');
  await expect(editor.locator('p').first()).toHaveText('First typed sentence');
  await expect(editor.locator('h2').first()).toHaveText('Background');
  await page.screenshot({ path: `${SHOTS}/8-caret-under-first-heading.png` });
  // Ctrl+Z undoes the typing and leaves every heading.
  await page.keyboard.press('Control+z');
  await expect(editor.locator('h1, h2')).toHaveCount(3);
});
