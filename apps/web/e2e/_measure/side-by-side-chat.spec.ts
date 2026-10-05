/**
 * The chat leg of the side-by-side journey on the real models (2026-10-05). Not a test: a recorder.
 *   MEASURE=1 npx playwright test e2e/_measure/side-by-side-chat.spec.ts --reporter=list
 */

import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from '../_session.js';

const TOPIC = 'Barriers to rooftop solar adoption among rural households in Karnataka';
const QUESTION =
  'What are the main financial barriers to rooftop solar adoption for rural households in India, according to my sources?';
const OUT = process.env.SIDE_BY_SIDE_OUT ?? 'side-by-side-chat.json';

test('chat, recorded', async ({ page, request }) => {
  test.setTimeout(15 * 60_000);
  const record: Record<string, unknown> = {};
  const s = await establishSession(request, freshEmail('sbs-chat'));
  const cookie = `${s.cookieName}=${s.cookieValue}`;
  await page
    .context()
    .addCookies([{ name: s.cookieName, value: s.cookieValue, domain: 'localhost', path: '/' }]);
  await page.goto('/app');
  await page.getByLabel('Working title').fill(TOPIC);
  await page.getByTestId('start-writing-now').click();
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 60_000 });
  const documentId = /\/app\/d\/([0-9a-f-]{36})\//.exec(page.url())?.[1] ?? '';

  // Wait for the automatic search to fill the library, as a student would have by now.
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    const res = await request.get(`${API_URL}/api/v1/documents/${documentId}/sources/progress`, {
      headers: { cookie },
    });
    const p = (await res.json()) as { ready: number; searching: boolean; reading: number };
    record.library = p;
    if (p.ready >= 3 && !p.searching && p.reading === 0) break;
    await page.waitForTimeout(2_000);
  }

  await page.getByRole('tab', { name: 'chat', exact: true }).click();
  await page.locator('#chat-message').fill(QUESTION);
  const at = Date.now();
  await page.getByTestId('chat-panel').getByRole('button', { name: 'Ask', exact: true }).click();
  const seen: string[] = [];
  const end = Date.now() + 240_000;
  while (Date.now() < end) {
    const steps = page.getByTestId('chat-steps');
    if (await steps.count()) {
      for (const line of (await steps.innerText()).split('\n')) {
        const t = line.replace(/^[✓·]\s*/, '').trim();
        if (t.length > 2 && !seen.includes(t)) seen.push(t);
      }
    }
    if (await page.getByTestId('chat-rating').count()) break;
    await page.waitForTimeout(400);
  }
  record.chatSeconds = Number(((Date.now() - at) / 1000).toFixed(1));
  record.chatSteps = seen;
  const answer = page.getByTestId('chat-panel').locator('[data-role="assistant"]').last();
  record.chatAnswer = await answer.innerText().catch(() => null);
  record.chatHeadings = await page.getByTestId('chat-answer-heading').count();
  writeFileSync(OUT, JSON.stringify(record, null, 2));
});
