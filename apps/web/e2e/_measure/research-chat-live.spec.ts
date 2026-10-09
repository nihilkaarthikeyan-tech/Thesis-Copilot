import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from '../_session.js';

/**
 * ADR-0132 on the real models: a research question with no thesis (the literature), then the same
 * account with one thesis whose library fills, asked across "All my theses". MEASURE=1 only — two
 * real CHAT units.
 */
test.skip(!process.env.MEASURE, 'measurement run');

const lastData = (body: string) => {
  const line = body
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .pop();
  return line ? (JSON.parse(line.slice(6)) as Record<string, unknown>) : {};
};

test('a research question with no thesis, and across theses', async ({ request }) => {
  test.setTimeout(600_000);
  const session = await establishSession(request, freshEmail('ask-live'));
  const headers = { cookie: `${session.cookieName}=${session.cookieValue}` };
  // "Search beyond my library" on, as a student who answered Always allow.
  await request.put(`${API_URL}/api/v1/settings`, {
    headers,
    data: { searchBeyondLibrary: 'on' },
  });

  const ask = async (message: string, source: 'web' | 'theses') => {
    const started = Date.now();
    const res = await request.post(`${API_URL}/api/v1/research-chats/ask`, {
      headers: { ...headers, 'content-type': 'application/json', accept: 'text/event-stream' },
      data: { message, source },
      timeout: 240_000,
    });
    const body = await res.text();
    writeFileSync(`../../qa-shots/research-chat-${source}.txt`, body);
    const d = lastData(body);
    const citations = (d.citations as Array<Record<string, unknown>> | undefined) ?? [];
    console.log(
      `[${source}] ${res.status()} in ${Math.round((Date.now() - started) / 1000)} s; ` +
        `${citations.length} citations; text: ${String(d.text ?? '').slice(0, 400)}`,
    );
    for (const c of citations.slice(0, 4)) {
      console.log(
        `   cite ${String(c.rendered ?? c.shortRef ?? '')} ${JSON.stringify(c.thesis ?? null)}`,
      );
    }
    return res.status();
  };

  expect(
    await ask('What explains low rooftop solar adoption among rural households in India?', 'web'),
  ).toBe(200);

  const doc = (await (
    await request.post(`${API_URL}/api/v1/documents`, {
      headers,
      data: {
        title: 'Barriers to rooftop solar adoption among rural households in Karnataka',
        entryPath: 'A_TOPIC',
      },
    })
  ).json()) as { id: string };
  const until = Date.now() + 240_000;
  while (Date.now() < until) {
    const p = (await (
      await request.get(`${API_URL}/api/v1/documents/${doc.id}/sources/progress`, { headers })
    ).json()) as { ready: number; searching: boolean; reading: number };
    if (p.ready >= 5 && !p.searching) break;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  expect(
    await ask('Which financial barriers to rooftop solar do my papers report?', 'theses'),
  ).toBe(200);
});
