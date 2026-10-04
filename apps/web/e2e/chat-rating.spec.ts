import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Thumbs on a chat answer (2026-10-04, from the Jenni study).
 *
 * Under the mock AI the relevance floor refuses most questions (mock embeddings are not
 * meaningful), and a refusal is not stored, so it has no thumbs. The answer stream is therefore
 * supplied here, shaped exactly as `ChatService.ask` sends it; the rating request goes to the real
 * API and its 404 for an unknown turn is part of what is checked. `chat-rating.spec.ts` in the API
 * tests covers storing the rating.
 */
test('a stored answer carries thumbs; pressing one sends the rating for that answer', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('chat-rating'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Chat rating ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  const turnId = '01a10000-0000-7000-8000-00000000c0de';
  await page.route(`${API_URL}/api/v1/chat`, (route) =>
    route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'access-control-allow-origin': 'http://localhost:3000',
        'access-control-allow-credentials': 'true',
      },
      body: [
        'event: start\ndata: {"turn":1}\n\n',
        'event: token\ndata: {"t":"Cost was the main barrier."}\n\n',
        `event: done\ndata: ${JSON.stringify({ turnId, text: 'Cost was the main barrier.', outcome: 'answered', citations: [], passagesUsed: 1, latencyMs: 5 })}\n\n`,
      ].join(''),
    }),
  );

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'chat', exact: true }).click();
  await page.locator('#chat-message').fill('What limited uptake?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();

  const answer = page.locator('[data-role=assistant]').last();
  await expect(answer).toContainText('Cost was the main barrier.');
  const useful = answer.getByRole('button', { name: 'Useful answer', exact: true });
  await expect(useful).toBeVisible();

  const rated = page.waitForRequest((r) => r.url().includes(`/turns/${turnId}/rating`));
  await useful.click();
  const sent = await rated;
  expect(sent.method()).toBe('POST');
  expect(sent.postDataJSON()).toEqual({ rating: 1 });
  // The real API has no such turn stored, so it refuses, and the button goes back.
  await expect(useful).toHaveAttribute('aria-pressed', 'false');
});
