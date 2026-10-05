/**
 * The same-topic writing comparison (2026-10-05): one thesis title, written in Jenni and in
 * Thesis Copilot, every AI output recorded for side-by-side reading. Not a test: a recorder.
 * Run with the dev stack on real models and the production flags on:
 *   MEASURE=1 SAME_TOPIC_OUT=out.json npx playwright test e2e/_measure/same-topic.spec.ts
 */

import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { establishSession, freshEmail } from '../_session.js';

const TOPIC = 'Mobile banking and the financial inclusion of rural women in Tamil Nadu';
const SECTION = 'Barriers to adoption';
const QUESTION =
  'What stops rural women in India from using mobile banking, according to the research?';
const OUT = process.env.SAME_TOPIC_OUT ?? 'same-topic.json';

test('the same topic, recorded', async ({ page, request }) => {
  test.setTimeout(30 * 60_000);
  const record: Record<string, unknown> = { at: new Date().toISOString(), topic: TOPIC };
  const save = () => writeFileSync(OUT, JSON.stringify(record, null, 2));
  const t0 = Date.now();
  const at = () => Number(((Date.now() - t0) / 1000).toFixed(1));
  const step = (name: string) => {
    console.log(`  +${at()} s  ${name}`);
    save();
  };

  const s = await establishSession(request, freshEmail('same-topic'));
  await page
    .context()
    .addCookies([{ name: s.cookieName, value: s.cookieValue, domain: 'localhost', path: '/' }]);
  await page.goto('/app');
  await page.getByLabel('Working title').fill(TOPIC);
  await page.getByTestId('start-writing-now').click();
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 60_000 });
  step('editor');

  // 1. Before typing: the opening sentence for the new chapter.
  const shown = page.locator('.thesis-editor span.ghost[data-status="shown"]');
  record.openerText = await shown
    .waitFor({ timeout: 60_000 })
    .then(() => shown.innerText())
    .catch(() => null);
  record.openerSeconds = at();
  step('opener');
  if (record.openerText) await page.keyboard.press('Tab');

  // 2. Three suggestions in a row, each kept, as a student building a paragraph would.
  const suggestions: string[] = [];
  for (let i = 0; i < 3; i++) {
    await editor.locator('p').last().click();
    await page.keyboard.press('Control+End');
    const asked = Date.now();
    await page.getByTestId('suggest-button').click();
    const ok = await shown
      .waitFor({ timeout: 90_000 })
      .then(() => true)
      .catch(() => false);
    if (!ok) break;
    suggestions.push(`${await shown.innerText()}  [${((Date.now() - asked) / 1000).toFixed(1)} s]`);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(1_500);
  }
  record.suggestions = suggestions;
  record.paragraph = await editor.locator('p').first().innerText();
  step('suggestions');

  // 3. The chapter plan from the title.
  await expect(page.getByTestId('section-guide-sections'))
    .toBeVisible({ timeout: 240_000 })
    .catch(() => undefined);
  record.chapterRail = await page
    .locator('aside')
    .first()
    .innerText({ timeout: 5_000 })
    .catch(() => null);
  record.sectionPlan = await page
    .getByTestId('section-guide')
    .innerText({ timeout: 5_000 })
    .catch(() => null);
  step('plan');

  // 4. A section under a heading: the opener, then the draft.
  await editor.locator('p').last().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText(SECTION);
  await page.getByRole('combobox', { name: 'Text' }).selectOption('Heading');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  record.sectionOpener = await shown
    .waitFor({ timeout: 60_000 })
    .then(() => shown.innerText())
    .catch(() => null);
  record.sectionOpenerSeconds = at();
  step('section opener');
  // WRITE_ONLY: the suggestions and openers again, without spending a draft and a chat.
  if (process.env.WRITE_ONLY) return;
  if (record.sectionOpener) await page.keyboard.press('Escape');
  const draftAt = Date.now();
  await page.getByTestId('draft-section-button').click();
  const status = page.getByTestId('draft-status');
  await expect(status).toContainText(/Draft inserted|nothing to draft|Say what|could not/i, {
    timeout: 300_000,
  });
  record.draftSeconds = Number(((Date.now() - draftAt) / 1000).toFixed(1));
  record.draftStatus = await status.innerText();
  record.draftText = await editor
    .locator('[data-draft="true"]')
    .innerText()
    .catch(() => null);
  step('draft');

  // 5. One research question in chat.
  await page.getByRole('tab', { name: 'chat', exact: true }).click();
  await page.locator('#chat-message').fill(QUESTION);
  const chatAt = Date.now();
  await page.getByTestId('chat-panel').getByRole('button', { name: 'Ask', exact: true }).click();
  const answer = page.getByTestId('chat-panel').locator('[data-role="assistant"]').last();
  const end = Date.now() + 240_000;
  while (Date.now() < end) {
    if ((await answer.count()) && (await page.getByTestId('chat-rating').count())) break;
    await page.waitForTimeout(500);
  }
  record.chatSeconds = Number(((Date.now() - chatAt) / 1000).toFixed(1));
  record.chatAnswer = await answer.innerText().catch(() => null);
  step('chat');

  // 6. The library the answers were drawn from.
  await page
    .getByRole('tab', { name: 'sources', exact: true })
    .click()
    .catch(() => undefined);
  record.library = await page
    .locator('[role="tabpanel"]')
    .first()
    .innerText({ timeout: 5_000 })
    .catch(() => null);
  step('done');
});
