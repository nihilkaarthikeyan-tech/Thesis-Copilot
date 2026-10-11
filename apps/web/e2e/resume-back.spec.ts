import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The owner (2026-10-11): signing in should land on the theses list, as it used to, not jump into
 * the chapter last open (ADR-0073's resume, removed), and the browser's Back from a chapter must
 * come back to that list. The "Continue writing" card is the one-click way to the last chapter.
 */
test('arriving shows the theses list with Continue writing, and Back from a chapter returns to it', async ({
  page,
  request,
}) => {
  const session = await establishSession(request, freshEmail('resume-back'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const title = `Resume and back ${Date.now()}`;
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title, entryPath: 'A_TOPIC' },
  });
  expect(created.ok()).toBe(true);
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  // A browser that has opened this chapter before, coming back another day.
  await page.addInitScript(
    ([id, chapterId, name]) => {
      if (!localStorage.getItem('tc:last-chapter')) {
        localStorage.setItem(
          'tc:last-chapter',
          JSON.stringify({
            documentId: id,
            chapterId,
            documentTitle: name,
            chapterTitle: 'Chapter 1',
            at: new Date().toISOString(),
          }),
        );
      }
    },
    [doc.id, doc.firstChapterId, title],
  );

  // Arriving: the list stays, with the shortcut to the last chapter at the top.
  await page.goto('/app');
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_500);
  await expect(page).toHaveURL(/\/app\/?$/);
  const resume = page.getByTestId('continue-writing');
  await expect(resume).toBeVisible();

  // Into the chapter by the card, then Back: the list again.
  await resume.getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/app/d/${doc.id}/write/${doc.firstChapterId}`), {
    timeout: 30_000,
  });
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/?$/, { timeout: 30_000 });
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 30_000 });
});
