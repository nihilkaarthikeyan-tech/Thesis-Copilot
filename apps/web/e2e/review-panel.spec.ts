import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The review panel inside the editor — ADR-0017.
 *
 * Every part of this is only true on a rendered page: the highlight is a ProseMirror decoration
 * drawn over a range found in the live document, and "accept" changes the chapter on the server
 * underneath an open editor. An API test would prove none of it.
 *
 * It makes one real model call, through the panel's own "Suggest a revision" button, because a
 * suggestion that was inserted into the database by the test would not prove the button works.
 */

const SENTENCE =
  'Uptake of drip irrigation is uneven across the two surveyed districts of Tamil Nadu.';

test('a comment is drawn on its passage, and accepting the revision changes the chapter', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const session = await establishSession(request, freshEmail('review'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);

  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Review panel ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  expect(created.ok(), `create: ${created.status()}`).toBe(true);
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  // Write the sentence the comment will be about, through the editor, so it is saved the way a
  // student's text is saved.
  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.locator('.thesis-editor p').first().click();
  await page.keyboard.type(SENTENCE);
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });

  const comment = await request.post(`${API_URL}/api/v1/documents/${doc.id}/feedback/comments`, {
    headers: { cookie },
    data: {
      chapterId: doc.firstChapterId,
      // Deliberately something the chapter's own words can satisfy. A comment asking for a fact
      // the thesis does not contain gets `[[NEEDS INPUT: …]]` back, and `ReviewService.accept`
      // refuses to apply it — correctly, and it would make this test about that instead.
      body: 'Tighten this sentence; it is wordier than it needs to be.',
      quotedText: SENTENCE,
    },
  });
  expect(comment.ok(), `comment: ${comment.status()}`).toBe(true);

  await page.reload();
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'review' }).click();

  const panel = page.getByTestId('review-panel');
  await expect(panel).toContainText('1 open comment here', { timeout: 20_000 });
  await expect(panel.getByTestId('review-comment')).toHaveCount(1);

  // The decoration: the passage is underlined in the text, not merely listed in the panel.
  const highlight = page.locator('.thesis-editor .review-anchor');
  await expect(highlight).toHaveCount(1);
  await expect(highlight).toHaveText(SENTENCE);

  // Go to selects exactly the sentence.
  await panel.getByTestId('review-goto').click();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(SENTENCE);

  // The one metered action on this panel, and the thing that gives it something to accept.
  await panel.getByTestId('review-suggest').click();
  await expect(panel.getByTestId('review-diff')).toBeVisible({ timeout: 90_000 });

  // Accepting is a server-side edit; the page reloads onto the new text.
  await panel.getByTestId('review-accept').click();
  // If the server refused, say so here rather than through a confusing text assertion below.
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.thesis-editor')).not.toContainText(SENTENCE, { timeout: 30_000 });

  // And the comment is off the panel, because it is no longer open.
  await page.getByRole('tab', { name: 'review' }).click();
  await expect(page.getByTestId('review-panel')).toContainText('No open comments', {
    timeout: 20_000,
  });
});

test('a comment whose passage has been rewritten says so instead of pointing somewhere wrong', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('review-moved'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);

  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Moved passage ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.locator('.thesis-editor p').first().click();
  await page.keyboard.type('A sentence that will be deleted before the comment is read.');
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });

  await request.post(`${API_URL}/api/v1/documents/${doc.id}/feedback/comments`, {
    headers: { cookie },
    data: {
      chapterId: doc.firstChapterId,
      body: 'This needs a citation.',
      quotedText: 'A sentence that will be deleted before the comment is read.',
    },
  });

  // Replace it with something entirely different — no prefix left to fall back to.
  await page.locator('.thesis-editor p').first().click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Something completely different now occupies this paragraph instead.');
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });

  await page.getByRole('tab', { name: 'review' }).click();
  const panel = page.getByTestId('review-panel');
  await expect(panel).toContainText('That passage has been rewritten', { timeout: 20_000 });
  await expect(panel.getByTestId('review-goto')).toBeDisabled();
  // Nothing is underlined, because there is nothing to underline.
  await expect(page.locator('.thesis-editor .review-anchor')).toHaveCount(0);
});
