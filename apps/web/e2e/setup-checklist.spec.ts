import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The setup checklist on `/app` — "3 of 5 set up".
 *
 * Two things are worth proving in a browser rather than in a unit test, because both are about
 * what the student actually sees on a screen the day they arrive:
 *
 *   1. **A brand-new thesis reads 0 of 5.** Every document is created with a placeholder chapter
 *      so the editor has somewhere to land. Counting chapters would have ticked "build the outline"
 *      the moment the thesis was named — a checklist that lies on its first render is worse than
 *      no checklist.
 *   2. **A step ticks when the thing is done.** Saving the proposal moves it to 1 of 5.
 */

test('a new thesis starts at nothing done, and ticks when the proposal is saved', async ({
  page,
  request,
}) => {
  const session = await establishSession(request, freshEmail('setup'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);

  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Checklist ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  expect(created.ok(), `create: ${created.status()}`).toBe(true);
  const { id } = (await created.json()) as { id: string };

  await page.goto('/app');
  const checklist = page.getByTestId('setup-checklist');
  await expect(checklist).toBeVisible({ timeout: 20_000 });
  await expect(checklist).toContainText('0 of 5');
  // The single call to action is the first undone step, which on a new thesis is the proposal.
  await expect(checklist.getByRole('link', { name: 'Say what the thesis is about' })).toBeVisible();

  await checklist.getByTestId('setup-toggle').click();
  const steps = checklist.getByTestId('setup-steps').getByRole('listitem');
  await expect(steps).toHaveCount(5);
  // Nothing struck through: the placeholder chapter has not ticked the outline step.
  await expect(checklist.getByTestId('setup-steps').locator('.line-through')).toHaveCount(0);

  const saved = await request.put(`${API_URL}/api/v1/documents/${id}/memory/scope`, {
    headers: { cookie },
    data: {
      workingTitle: 'Drip irrigation uptake among smallholders',
      problemStatement: 'Uptake is uneven across districts and the reason is not established.',
      objectives: ['Measure uptake by district'],
      whyOpen: 'No survey has covered both districts.',
    },
  });
  expect(saved.ok(), `save scope: ${saved.status()}`).toBe(true);

  await page.reload();
  await expect(checklist).toContainText('1 of 5', { timeout: 20_000 });
  // It now points at the next thing rather than repeating the one just finished.
  await expect(checklist.getByRole('link', { name: 'Add some sources' })).toBeVisible();
});
