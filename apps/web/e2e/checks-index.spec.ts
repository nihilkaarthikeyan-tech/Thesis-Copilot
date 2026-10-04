import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/** Every check named in one list in the editor (2026-10-04, from the Jenni study). */
test('the flags tab lists every check with a way to open it', async ({ page, request }) => {
  const session = await establishSession(request, freshEmail('checks-index'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Checks ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'flags', exact: true }).click();

  const index = page.getByTestId('checks-index');
  await index.getByText('Every check, in one list').click();
  for (const name of [
    'Coherence and claim support',
    'Examiner review',
    'Proofreading',
    'Too close to a source',
    'Citation report',
    'Originality',
    'Formatting and front matter',
    'Viva practice',
    "Your guide's comments",
  ]) {
    await expect(index.getByText(name, { exact: true })).toBeVisible();
  }
  const hrefs = await index
    .getByRole('link', { name: 'Open' })
    .evaluateAll((links) => links.map((a) => a.getAttribute('href')));
  expect(hrefs).toEqual([
    `/app/d/${doc.id}/citations`,
    `/app/d/${doc.id}/originality`,
    `/app/d/${doc.id}/submit`,
    `/app/d/${doc.id}/viva`,
  ]);

  // The guide's comments open in the same panel.
  await index.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('tab', { name: 'review', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
