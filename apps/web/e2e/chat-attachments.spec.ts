import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Attachments to a chat question (ADR-0083): the paperclip, the chip, the request, and the
 * answer's citation of the file. The upload and the `/chat` stream are supplied here, shaped as
 * the API sends them; the API side is `apps/api/test/chat-attachments-api.spec.ts`.
 */

const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const ANSWER =
  'The note names fear of sending money to the wrong account as the commonest reason {{cite:Satt1#c1}}.';

test('attach a file, ask about it, see it cited by name', async ({ page, request, baseURL }) => {
  test.setTimeout(120_000);
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const cors = {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
  };
  const session = await establishSession(request, freshEmail('chat-attach'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Chat attachments ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  const uploads: string[] = [];
  await page.route(`${API_URL}/api/v1/chat/attachments?**`, (route) => {
    uploads.push(route.request().headers()['content-type'] ?? '');
    return route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'application/json' },
      json: {
        id: '01a10000-0000-7000-8000-0000000000a1',
        kind: 'document',
        name: 'field-notes.txt',
        chars: 180,
      },
    });
  });
  const bodies: Array<Record<string, unknown>> = [];
  await page.route(`${API_URL}/api/v1/chat`, (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      status: 200,
      headers: { ...cors, 'content-type': 'text/event-stream' },
      body: [
        frame('start', { turn: 1 }),
        frame('step', { id: 'search', text: 'Searching your library…' }),
        frame('token', { t: ANSWER }),
        frame('done', {
          turnId: '01a10000-0000-7000-8000-00000000a7a1',
          text: ANSWER,
          outcome: 'answered',
          citations: [
            {
              key: 'Satt1#c1',
              sourceId: '',
              chunkId: '',
              label: 'Attached: field-notes.txt',
              attachment: { name: 'field-notes.txt' },
            },
          ],
          passagesUsed: 1,
          latencyMs: 2_000,
        }),
      ].join(''),
    });
  });

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await page.getByRole('tab', { name: 'chat', exact: true }).click();
  const panel = page.getByTestId('chat-panel');

  await panel.getByTestId('chat-attach-input').setInputFiles({
    name: 'field-notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Of the 40 women interviewed, 31 owned a phone.'),
  });
  await expect(panel.getByTestId('chat-attachment-chip')).toHaveCount(1);
  await expect(panel.getByTestId('chat-attachment-chip')).toContainText('field-notes.txt');
  expect(uploads[0]).toMatch(/^multipart\/form-data/);

  await panel.locator('#chat-message').fill('What stops the women, according to the note?');
  await panel.getByRole('button', { name: 'Ask', exact: true }).click();

  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]?.attachmentIds).toEqual(['01a10000-0000-7000-8000-0000000000a1']);

  const answer = panel.locator('[data-role="assistant"]').last();
  await expect(answer).toContainText('fear of sending money');
  await expect(answer.getByTestId('chat-attachment-cite')).toHaveText('Attached: field-notes.txt');
  // The file is not a source: nothing to add to the thesis from this answer.
  await expect(answer.getByRole('button', { name: 'Add to document' })).toHaveCount(0);
  // The chip is gone once the question has been asked.
  await expect(panel.getByTestId('chat-attachment-chip')).toHaveCount(0);
});
