import { type Browser, expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The supervisor's live progress view (2026-09-25).
 *
 * The student writes; the supervisor, with the thesis open, sees it without reloading: the
 * chapter being written is marked, the words-over-time line is drawn from what autosave kept,
 * and a chapter saved while they watch joins "changed" on the next refresh. The page's clock is
 * run forward rather than waiting out the minute.
 */

async function signedIn(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const session = await establishSession(context.request, email);
  await context.addCookies([
    { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
  ]);
  return { page, context, cookie: `${session.cookieName}=${session.cookieValue}` };
}

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

test('a supervisor watching the thesis sees the student write, without reloading', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const student = await signedIn(browser, freshEmail('student-live-progress'));
  const guideEmail = freshEmail('guide-live-progress');

  const created = await student.context.request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie: student.cookie },
    data: { title: `Live progress ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  const save = (version: number, words: string) =>
    student.context.request.put(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
      headers: { cookie: student.cookie },
      data: { baseVersion: version, content: { type: 'doc', content: [paragraph(words)] } },
    });
  expect((await save(1, 'Households delay adoption because the subsidy arrives late.')).ok()).toBe(
    true,
  );

  const shared = await student.context.request.post(
    `${API_URL}/api/v1/documents/${doc.id}/feedback/shares`,
    { headers: { cookie: student.cookie }, data: { guideEmail } },
  );
  expect(shared.ok(), `share: ${shared.status()}`).toBe(true);
  const share = (await shared.json()) as { url: string };

  const guide = await signedIn(browser, guideEmail);
  await guide.page.clock.install();
  await guide.page.goto(new URL(share.url).pathname);
  const panel = guide.page.getByTestId('guide-progress');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel).toContainText('This is the first time you have opened it');
  await expect(guide.page.getByTestId('guide-live')).toContainText('Live');
  // Saved seconds ago: the student is writing it now.
  await expect(guide.page.getByTestId('guide-writing-now')).toBeVisible();
  await expect(guide.page.getByTestId('guide-words-over-time')).toContainText(
    'Words, week by week',
  );
  await expect(guide.page.getByTestId('guide-changed')).toHaveCount(0);

  // The student keeps writing while the supervisor has the page open.
  expect(
    (
      await save(
        2,
        'Households delay adoption because the subsidy arrives late, and they must borrow meanwhile.',
      )
    ).ok(),
  ).toBe(true);
  await guide.page.clock.fastForward(61_000);
  await expect(guide.page.getByTestId('guide-changed')).toHaveCount(1, { timeout: 15_000 });
  await expect(panel).toContainText('1 chapter changed since you last looked');
  await guide.page.screenshot({ path: 'test-results/guide-live.png' });
});
