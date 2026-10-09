import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from '../_session.js';

/**
 * ADR-0133 on the real models: one AI edit with "Search the literature" on, on a thesis whose
 * library is deliberately thin (an untitled thesis, so nothing is added at creation). Prints what
 * was added and what the edit cites. MEASURE=1 only — one real COMMAND unit.
 */
test.skip(!process.env.MEASURE, 'measurement run');

test('an edit with Search the literature adds papers, then cites them', async ({ request }) => {
  test.setTimeout(300_000);
  const session = await establishSession(request, freshEmail('edit-lit'));
  const headers = { cookie: `${session.cookieName}=${session.cookieValue}` };
  const doc = (await (
    await request.post(`${API_URL}/api/v1/documents`, {
      headers,
      data: { title: 'Untitled thesis', entryPath: 'A_TOPIC' },
    })
  ).json()) as { id: string; firstChapterId: string };
  const selection =
    'Many rural households in Karnataka have not installed rooftop solar panels even though subsidies exist. The upfront cost and access to credit appear to matter.';
  const started = Date.now();
  const res = await request.post(`${API_URL}/api/v1/commands/run`, {
    headers: { ...headers, 'content-type': 'application/json', accept: 'text/event-stream' },
    data: {
      chapterId: doc.firstChapterId,
      command: 'custom',
      selection,
      instruction: 'Add evidence from published studies for each claim',
      useLibrary: true,
      searchLiterature: true,
    },
    timeout: 240_000,
  });
  const body = await res.text();
  writeFileSync('../../qa-shots/edit-literature-body.txt', body);
  console.log(`status ${res.status()} in ${Math.round((Date.now() - started) / 1000)} s`);
  const done =
    body
      .split('\n')
      .filter((l) => l.startsWith('data: ') && l.includes('runId'))
      .pop()
      ?.slice(6) ?? '';
  const parsed = done ? (JSON.parse(done) as Record<string, unknown>) : {};
  console.log('literature:', JSON.stringify(parsed.literature ?? null).slice(0, 800));
  console.log('text:', String(parsed.text ?? parsed.result ?? '').slice(0, 900));
  console.log('citations:', JSON.stringify(parsed.citations ?? null).slice(0, 600));
  if (!done) console.log(body.slice(-800));
  const sources = (await (
    await request.get(`${API_URL}/api/v1/documents/${doc.id}/sources`, { headers })
  ).json()) as Array<{ id: string; title: string }>;
  console.log(`library now ${sources.length} papers`);
  expect(res.status()).toBe(200);
});
