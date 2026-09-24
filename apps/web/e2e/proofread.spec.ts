import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Spelling and grammar — ADR-0026.
 *
 * A chapter with two planted misspellings. The student proofreads it, accepts one correction and
 * sees exactly that word change, marked as the proofreader's. They fix the other by hand first,
 * and its correction then says the words are no longer there instead of landing somewhere else.
 *
 * CI runs this on the mock and a developer's machine on the real Fast model, so it asserts only
 * what both must do: find the two misspellings, and change nothing the student did not accept.
 */

const CHAPTER = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Findings' }] },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'The farmers recieved the subsidy late in the season, after planting had begun.',
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Dealers described a difficult enviroment for selling drip kits to smallholders.',
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'This chapter examines why adoption was slow in both districts.' },
      ],
    },
  ],
};

test('the student proofreads a chapter and accepts one correction at a time', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const session = await establishSession(request, freshEmail('proofread'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Proofread ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  const chapter = (await (
    await request.get(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, { headers: { cookie } })
  ).json()) as { version: number };
  const saved = await request.put(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
    headers: { cookie },
    data: { content: CHAPTER, baseVersion: chapter.version },
  });
  expect(saved.ok(), `save: ${saved.status()}`).toBe(true);

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'flags' }).click();

  const panel = page.getByTestId('proofread-panel');
  await panel.getByTestId('proofread-run').click();
  await expect(panel.getByTestId('proofread-summary')).toBeVisible({ timeout: 90_000 });

  const corrections = panel.getByTestId('proofread-correction');
  const received = corrections.filter({ hasText: 'recieved' });
  const environment = corrections.filter({ hasText: 'enviroment' });
  await expect(received).toHaveCount(1);
  await expect(environment).toHaveCount(1);
  // Nothing has changed yet: a correction is a suggestion until the student takes it.
  await expect(editor).toContainText('The farmers recieved the subsidy');

  // The student rewrites the second sentence themselves before getting to its correction.
  await editor.locator('p', { hasText: 'Dealers described' }).click({ clickCount: 3 });
  await page.keyboard.type('Dealers described a hard market for drip kits.');
  await expect(editor).toContainText('a hard market for drip kits');

  await received.getByTestId('proofread-accept').click();
  await expect(editor).toContainText('The farmers received the subsidy');
  await expect(editor).not.toContainText('recieved');
  await expect(editor.locator('[data-provenance="COMMAND"]')).toContainText('received');
  await expect(received).toHaveCount(0);

  // Its words are gone, so the correction declines rather than editing something else.
  await environment.getByTestId('proofread-accept').click();
  await expect(environment.getByTestId('proofread-moved')).toBeVisible();
  await expect(editor).toContainText('a hard market for drip kits');
  await expect(editor).not.toContainText('environment');

  await environment.getByTestId('proofread-dismiss').click();
  await expect(environment).toHaveCount(0);
  // The sentence with nothing wrong in it is exactly as it was.
  await expect(editor).toContainText(
    'This chapter examines why adoption was slow in both districts.',
  );
});
