/**
 * The side-by-side journey, re-run on the real models (2026-10-05). Not a test: a recorder.
 * Run with the dev stack on api-dev/worker-dev and the production flags on:
 *   MEASURE=1 npx playwright test e2e/_measure/side-by-side.spec.ts --reporter=list
 * Writes every timing and every AI output to SIDE_BY_SIDE_OUT (JSON) for the report.
 */

import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { establishSession, freshEmail } from '../_session.js';

const TOPIC = 'Barriers to rooftop solar adoption among rural households in Karnataka';
const OPENING =
  'Rooftop solar adoption among rural households in Karnataka remains low despite state subsidies. ';
const QUESTION =
  'What are the main financial barriers to rooftop solar adoption for rural households in India, according to my sources?';
const OUT = process.env.SIDE_BY_SIDE_OUT ?? 'side-by-side.json';

test('the journey, recorded', async ({ page, request }) => {
  test.setTimeout(30 * 60_000);
  const record: Record<string, unknown> = { at: new Date().toISOString() };
  const save = () => writeFileSync(OUT, JSON.stringify(record, null, 2));
  const t0 = Date.now();
  const mark = (key: string) => {
    record[key] = Number(((Date.now() - t0) / 1000).toFixed(1));
    console.log(`  +${record[key]} s  ${key}`);
    save();
  };

  const s = await establishSession(request, freshEmail('side-by-side'));
  await page
    .context()
    .addCookies([{ name: s.cookieName, value: s.cookieValue, domain: 'localhost', path: '/' }]);
  await page.goto('/app');
  await page.getByLabel('Working title').fill(TOPIC);
  const start = Date.now();
  await page.getByTestId('start-writing-now').click();
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 60_000 });
  record.editorSeconds = Number(((Date.now() - start) / 1000).toFixed(1));
  mark('inEditor');

  // What the student sees above the page.
  record.guide = await page
    .getByTestId('first-session-guide')
    .innerText()
    .catch(() => null);

  // Type the opening sentence and wait for the first cited suggestion (asked once; the editor
  // asks again itself when papers are ready).
  const editor = page.locator('.thesis-editor');
  await editor.locator('p').last().click();
  await page.keyboard.type(OPENING);
  const typedAt = Date.now();
  // Ask, then ask again every 20 s if no cited suggestion is showing, as a student would.
  const cited = page.getByTestId('suggestion-evidence');
  const attempts: string[] = [];
  const deadline = Date.now() + 240_000;
  let lastAsk = 0;
  while (Date.now() < deadline && !(await cited.count())) {
    if (Date.now() - lastAsk > 20_000) {
      lastAsk = Date.now();
      await editor.locator('p').last().click();
      await page.keyboard.press('End');
      await page.getByTestId('suggest-button').click();
      attempts.push(`asked at +${((Date.now() - typedAt) / 1000).toFixed(1)} s`);
    }
    await page.waitForTimeout(1_000);
    const notice = page.getByTestId('notice');
    if (await notice.count()) attempts.push(`notice: ${(await notice.innerText()).slice(0, 120)}`);
  }
  record.suggestionAttempts = [...new Set(attempts)];
  await expect(cited).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.thesis-editor span.ghost[data-status="shown"]')).toBeVisible();
  record.firstCitedSuggestionSeconds = Number(((Date.now() - typedAt) / 1000).toFixed(1));
  record.firstSuggestion = await page.locator('.thesis-editor span.ghost').innerText();
  record.firstSuggestionNotice = await page
    .getByTestId('notice')
    .innerText()
    .catch(() => null);
  mark('firstCitedSuggestion');
  await page.keyboard.press('Tab');

  // The chapter plan from the title (ADR-0072): wait for the Sections panel to fill.
  const sections = page.getByTestId('section-guide-sections');
  await expect(sections)
    .toBeVisible({ timeout: 240_000 })
    .catch(() => undefined);
  record.sectionPlan = await page
    .getByTestId('section-guide')
    .innerText()
    .catch(() => null);
  record.chapterRail = await page
    .locator('aside')
    .first()
    .innerText()
    .catch(() => null);
  mark('sectionPlan');

  // Draft a section under a heading.
  await editor.locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Financial constraints');
  await page.getByRole('combobox', { name: 'Text' }).selectOption('Heading');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  const draftAt = Date.now();
  await page.getByTestId('draft-section-button').click();
  const status = page.getByTestId('draft-status');
  await expect(status).toContainText(/Draft inserted|nothing to draft|Say what/, {
    timeout: 300_000,
  });
  record.draftSeconds = Number(((Date.now() - draftAt) / 1000).toFixed(1));
  record.draftStatus = await status.innerText();
  record.draft = await editor
    .locator('[data-draft="true"]')
    .innerText()
    .catch(() => null);
  mark('draft');

  // Chat.
  await page.getByRole('tab', { name: 'chat', exact: true }).click();
  const box = page.getByTestId('chat-panel').locator('textarea').first();
  await box.fill(QUESTION);
  const chatAt = Date.now();
  await page.getByTestId('chat-panel').getByRole('button', { name: 'Ask', exact: true }).click();
  const answer = page.getByTestId('chat-panel').locator('[data-role="assistant"]').last();
  const seenSteps = new Set<string>();
  const end = Date.now() + 240_000;
  while (Date.now() < end) {
    const steps = page.getByTestId('chat-steps');
    if (await steps.count())
      for (const line of (await steps.innerText()).split('\n')) seenSteps.add(line);
    if ((await answer.count()) && (await page.getByTestId('chat-rating').count())) break;
    await page.waitForTimeout(500);
  }
  record.chatSeconds = Number(((Date.now() - chatAt) / 1000).toFixed(1));
  record.chatSteps = [...seenSteps].filter((l) => l.trim().length > 1);
  record.chatAnswer = await answer.innerText().catch(() => null);
  record.chatHeadings = await page.getByTestId('chat-answer-heading').count();
  mark('chat');
});
