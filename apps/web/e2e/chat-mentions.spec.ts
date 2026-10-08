import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * `@` in chat: naming the papers a question is about.
 *
 * Two real papers go into the library. AlphaFold's record carries an abstract, so it has text to
 * answer from; LeCun 2015's does not. Naming each shows both halves of the feature — an answer
 * drawn from the named paper alone, and an honest refusal when the named paper has nothing to read.
 */

const BIB = `@article{lecun,
  title = {Deep learning},
  author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},
  journal = {Nature}, year = {2015}, doi = {10.1038/nature14539}
}
@article{jumper,
  title = {Highly accurate protein structure prediction with AlphaFold},
  author = {Jumper, John and Evans, Richard},
  journal = {Nature}, year = {2021}, doi = {10.1038/s41586-021-03819-2}
}
`;

type Source = { id: string; status: string; groundingLevel: string; year: number | null };

test('a question can be confined to the papers named with @', async ({
  page,
  request,
  context,
}) => {
  test.setTimeout(300_000);
  const session = await establishSession(request, freshEmail('mentions'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);

  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Mentions ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  await request.post(`${API_URL}/api/v1/documents/${doc.id}/sources/import`, {
    headers: { cookie },
    multipart: {
      file: { name: 'two.bib', mimeType: 'application/x-bibtex', buffer: Buffer.from(BIB) },
    },
  });

  // Both resolved, and AlphaFold's abstract indexed.
  let jumperId = '';
  await expect
    .poll(
      async () => {
        const list = (await (
          await request.get(`${API_URL}/api/v1/documents/${doc.id}/sources`, {
            headers: { cookie },
          })
        ).json()) as Source[];
        jumperId = list.find((s) => s.year === 2021)?.id ?? '';
        return (
          list.length === 2 &&
          list.every((s) => s.status === 'RESOLVED') &&
          list.find((s) => s.year === 2021)?.groundingLevel !== 'NONE'
        );
      },
      { timeout: 180_000, intervals: [3_000], message: 'the library never finished reading' },
    )
    .toBe(true);

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'chat', exact: true }).click();
  const panel = page.getByTestId('chat-panel');
  const box = panel.getByRole('textbox');

  // Naming a paper with no text: an honest refusal, before any model is called.
  await box.fill('What does @LeC');
  const picker = panel.getByTestId('chat-mention-picker');
  await expect(picker).toBeVisible();
  await expect(picker).toContainText('no readable text yet');
  await picker.getByTestId('chat-mention-option').first().click();
  await expect(panel.getByTestId('chat-mention')).toHaveCount(1);
  await expect(panel.getByTestId('chat-mention')).toContainText('LeCun 2015');
  // The `@LeC` was only a way to choose; it has left the question.
  await expect(box).toHaveValue('What does ');
  await box.fill('What does it say about depth?');
  await panel.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(panel.locator('[data-role=assistant]').last()).toContainText(
    'no readable text yet',
    { timeout: 60_000 },
  );

  // Naming the paper that has text: the answer comes from it, and only it.
  await panel.getByRole('button', { name: /Stop answering from LeCun/ }).click();
  await expect(panel.getByTestId('chat-mention')).toHaveCount(0);
  await box.fill('@Jum');
  await picker.getByTestId('chat-mention-option').first().click();
  await expect(panel.getByTestId('chat-mention')).toContainText('Jumper 2021');
  await box.fill('What accuracy does this paper report for protein structure prediction?');

  const sent = page.waitForRequest(
    (req) => req.url().endsWith('/api/v1/chat') && req.method() === 'POST',
  );
  await panel.getByRole('button', { name: 'Ask', exact: true }).click();
  const body = JSON.parse((await sent).postData() ?? '{}') as { sourceIds?: string[] };
  expect(body.sourceIds).toEqual([jumperId]);

  const answer = panel.locator('[data-role=assistant]').last();
  await expect(answer).not.toContainText('no readable text yet', { timeout: 120_000 });
  await expect(answer).not.toBeEmpty();
  // Every citation in it points at the named paper — none at the one that was not named.
  const labels = (await answer.locator('button').allTextContents()).filter(
    (l) =>
      l.trim() !== '' &&
      l !== 'Add to document' &&
      l !== 'Copy' &&
      !l.startsWith('Search beyond your library') &&
      // R30 (ADR-0116): the inline offer under a refusal; buttons, not answer text.
      !['Allow this time', 'Always allow', 'Skip'].includes(l.trim()),
  );
  for (const label of labels) expect(label).not.toContain('LeCun');

  // Copy gives plain text: the citation labels the student sees, never a `{{cite:…}}` marker.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await answer.getByTestId('chat-copy').click();
  await expect(answer.getByTestId('chat-copy')).toHaveText('Copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.length).toBeGreaterThan(0);
  expect(copied).not.toContain('{{cite');
  for (const label of labels) expect(copied).toContain(label);

  // Thumbs on an answer the server stored (a refusal is not stored, and has none).
  const thumbsDown = answer.getByRole('button', { name: 'Not a useful answer' });
  if ((await thumbsDown.count()) > 0) {
    const rated = page.waitForResponse((r) => r.url().includes('/rating'));
    await thumbsDown.click();
    expect((await rated).status()).toBe(200);
    await expect(thumbsDown).toHaveAttribute('aria-pressed', 'true');
  }

  // 2026-10-04: the answer goes into the chapter on one press, its citations as real nodes, as
  // AI-written text.
  const editor = page.locator('.thesis-editor');
  await answer.getByTestId('chat-add-to-document').click();
  await expect(page.getByTestId('notice')).toContainText('Added to the chapter');
  await expect(editor.locator('[data-provenance="ASSIST"]').first()).toBeVisible();
  await expect(editor.locator('span.citation')).toHaveCount(labels.length);
  await expect(editor).not.toContainText('{{cite');
});
