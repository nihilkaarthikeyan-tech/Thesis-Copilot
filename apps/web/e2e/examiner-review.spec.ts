import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The examiner review on the Flags tab (ADR-0056): one press, a running state with the time it
 * has taken, then the result in one line — and the coherence check beside it still there.
 *
 * Needs the whole dev stack, worker included: the review is a job, and it is the worker that
 * writes its result. With `AI_PROVIDER=mock` the examiner reports only pitfall-bank matches, so
 * the test asserts that the review finishes and says so, not what it found.
 */
test('a chapter is reviewed by the examiner from the flags tab', async ({ page, request }) => {
  test.setTimeout(180_000);
  const session = await establishSession(request, freshEmail('examiner'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Solar drying of fish ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const saved = await request.put(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
    headers: { cookie },
    data: {
      baseVersion: 1,
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Chapter 1' }] },
          paragraph('Solar drying removes moisture using solar heat in an enclosed cabinet.'),
          paragraph('Open drying loses an estimated fifth of the catch to spoilage every season.'),
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Aim' }] },
          paragraph('This thesis measures the losses of three dryer designs on the Kerala coast.'),
        ],
      },
    },
  });
  expect(saved.ok(), `save: ${saved.status()}`).toBe(true);

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'flags', exact: true }).click();

  const review = page.getByTestId('examiner-review');
  await expect(review).toContainText('A strict examiner reads each section');
  await review.getByTestId('run-examiner-review').click();
  // Running: the button says so, with the time it has taken.
  await expect(review.getByTestId('run-examiner-review')).toHaveText(/Reviewing… \d+:\d{2}/);
  // Done: the result in one line, written by the worker.
  await expect(review.getByTestId('examiner-review-result')).toContainText('The examiner', {
    timeout: 150_000,
  });

  // Unchanged since a complete review: a second press is refused, for nothing.
  await review.getByTestId('run-examiner-review').click();
  await expect(review.getByRole('alert')).toContainText('has not changed');

  // The coherence check is still beside it.
  await expect(page.getByTestId('run-coherence')).toBeVisible();
});
