/**
 * Measurement, not a test (2026-10-05): how long a new student waits in their first session, on
 * the REAL models and live scholarly indexes. Run with the dev stack on api-dev/worker-dev:
 *   pnpm --filter @tc/web exec playwright test e2e/_measure --reporter=list
 * Prints a timeline; asserts nothing beyond reaching the editor. Not part of the suite (the folder
 * is excluded from the normal run by its leading underscore and is run by name only).
 */

import { expect, type Page, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from '../_session.js';

const TOPIC = 'Barriers to rooftop solar adoption among rural households in Karnataka';

function clock() {
  const t0 = Date.now();
  const marks: Array<[string, number]> = [];
  return {
    mark: (label: string) => {
      const s = (Date.now() - t0) / 1000;
      marks.push([label, s]);
      console.log(`  +${s.toFixed(1).padStart(6)} s  ${label}`);
    },
    marks,
  };
}

async function sources(request: Page['request'], cookie: string, documentId: string) {
  const res = await request.get(`${API_URL}/api/v1/documents/${documentId}/sources`, {
    headers: { cookie },
  });
  const rows = (await res.json()) as Array<{ status: string; groundingLevel: string }>;
  return {
    total: rows.length,
    readable: rows.filter(
      (r) => r.groundingLevel === 'ABSTRACT' || r.groundingLevel === 'FULL_TEXT',
    ).length,
  };
}

/** Types an opening, then waits for suggestions (automatic on pause, or Suggest) until one is cited. */
async function untilCitedSuggestion(
  page: Page,
  c: ReturnType<typeof clock>,
  cookie: string,
  documentId: string,
  limitS: number,
) {
  const editor = page.locator('.thesis-editor');
  await editor.locator('p').last().click();
  await page.keyboard.type('Rooftop solar adoption in rural Karnataka remains low. ');
  c.mark('typed the first sentence');
  const end = Date.now() + limitS * 1000;
  let firstAny = false;
  let lastCount = '';
  let lastNotice = '';
  let lastLine = '';
  let lastPress = 0;
  while (Date.now() < end) {
    const shown = page.locator('.thesis-editor span.ghost[data-status="shown"]');
    if (await shown.count()) {
      const cited = (await page.getByTestId('suggestion-evidence').count()) > 0;
      if (!firstAny) {
        firstAny = true;
        c.mark(`first suggestion shown (${cited ? 'cited' : 'no citation'})`);
      }
      if (cited) {
        c.mark('FIRST CITED SUGGESTION');
        return;
      }
      await page.keyboard.press('Escape');
    }
    const s = await sources(page.request, cookie, documentId);
    const now = `${s.total}/${s.readable}`;
    if (now !== lastCount) {
      c.mark(`library: ${s.total} papers, ${s.readable} readable`);
      lastCount = now;
    }
    const line = page.getByTestId('library-filling');
    const lineText = (await line.count()) ? await line.innerText() : '';
    if (lineText !== lastLine) {
      if (lineText) c.mark(`progress line: ${lineText}`);
      lastLine = lineText;
    }
    const notice = page.getByTestId('notice');
    const noticeText = (await notice.count()) ? (await notice.innerText()).slice(0, 90) : '';
    if (noticeText && noticeText !== lastNotice) c.mark(`notice: ${noticeText}`);
    lastNotice = noticeText;
    // Ask once, as a student would, then wait as the editor says to; ask again only if a whole
    // minute passes with nothing.
    if (Date.now() - lastPress > 60_000) {
      lastPress = Date.now();
      await page
        .getByTestId('suggest-button')
        .click()
        .catch(() => undefined);
    }
    await page.waitForTimeout(2_000);
  }
  c.mark(`gave up after ${limitS} s without a cited suggestion`);
}

test('first session, topic path (proposal → editor)', async ({ page, request }) => {
  test.setTimeout(20 * 60_000);
  const session = await establishSession(request, freshEmail('measure-topic'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  await page.goto('/app');
  await page.getByLabel('Working title').fill(TOPIC);
  await page.getByLabel(/A topic/).check();
  const c = clock();
  await page.getByRole('button', { name: 'Create thesis with a proposal' }).click();
  await page.waitForURL(/\/proposal$/);
  c.mark('proposal screen');
  const documentId = /\/app\/d\/([0-9a-f-]{36})\//.exec(page.url())?.[1] ?? '';
  const chat = page.getByTestId('path-a-chat');
  await expect(chat.getByLabel('Your message')).not.toHaveValue('', { timeout: 30_000 });
  await chat.getByRole('button', { name: 'Send' }).click();
  for (let q = 1; q <= 4; q++) {
    const done = page.getByRole('button', { name: 'Continue to the editor' });
    const next = chat.locator('[data-role="assistant"]').nth(q - 1);
    await expect(done.or(next)).toBeVisible({ timeout: 180_000 });
    if (await done.isVisible()) break;
    c.mark(`question ${q} asked`);
    const option = chat.getByTestId('question-options').locator('button').first();
    if (await option.count()) await option.click();
    else {
      await chat.getByLabel('Your message').fill('Household survey in two districts');
      await chat.getByRole('button', { name: 'Send' }).click();
    }
  }
  await expect(page.getByRole('button', { name: 'Continue to the editor' })).toBeVisible({
    timeout: 180_000,
  });
  c.mark('proposal skeleton ready');
  await page.getByRole('button', { name: 'Continue to the editor' }).click();
  await page.waitForURL(/\/write\//);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 60_000 });
  c.mark('IN THE EDITOR');
  await untilCitedSuggestion(page, c, cookie, documentId, 8 * 60);
  const chapters = await page.locator('aside').first().innerText();
  console.log(`  chapters rail at the end: ${chapters.replace(/\s+/g, ' ').slice(0, 160)}`);
});

test('first session, Start writing now', async ({ page, request }) => {
  test.setTimeout(15 * 60_000);
  const session = await establishSession(request, freshEmail('measure-quick'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  await page.goto('/app');
  await page.getByLabel('Working title').fill(TOPIC);
  const c = clock();
  await page.getByTestId('start-writing-now').click();
  await page.waitForURL(/\/write\//);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 60_000 });
  c.mark('IN THE EDITOR');
  const documentId = /\/app\/d\/([0-9a-f-]{36})\//.exec(page.url())?.[1] ?? '';
  await untilCitedSuggestion(page, c, cookie, documentId, 8 * 60);
});
