import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from '../_session.js';

/**
 * ADR-0128 on the real models: a new thesis fills its library (the creation search), then one
 * section draft is written; prints how many different papers it cites against the library size.
 * MEASURE=1 only — one real DRAFT unit and one creation search.
 */
test.skip(!process.env.MEASURE, 'measurement run');

test('a section draft cites across the library', async ({ request }) => {
  test.setTimeout(900_000);
  const session = await establishSession(request, freshEmail('spread'));
  const headers = { cookie: `${session.cookieName}=${session.cookieValue}` };
  const doc = (await (
    await request.post(`${API_URL}/api/v1/documents`, {
      headers,
      data: {
        title: 'Barriers to rooftop solar adoption among rural households in Karnataka',
        entryPath: 'A_TOPIC',
      },
    })
  ).json()) as { id: string; firstChapterId: string };

  let progress = { searching: true, found: 0, ready: 0, reading: 1 };
  const started = Date.now();
  while (Date.now() - started < 600_000) {
    progress = await (
      await request.get(`${API_URL}/api/v1/documents/${doc.id}/sources/progress`, { headers })
    ).json();
    if (!progress.searching && progress.reading === 0 && progress.found > 0) break;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  console.log(
    'library',
    JSON.stringify(progress),
    `${Math.round((Date.now() - started) / 1000)} s`,
  );
  expect(progress.ready).toBeGreaterThan(3);

  const chapter = (await (
    await request.get(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, { headers })
  ).json()) as { outlineNodeId: string };
  const res = await request.post(`${API_URL}/api/v1/draft/section`, {
    headers: { ...headers, 'content-type': 'application/json', accept: 'text/event-stream' },
    data: {
      chapterId: doc.firstChapterId,
      outlineNodeId: chapter.outlineNodeId,
      heading: 'Financial and institutional barriers to adoption',
      targetWords: 500,
    },
    timeout: 300_000,
  });
  const body = await res.text();
  const cited = new Set([...body.matchAll(/"sourceId":"([0-9a-f-]{36})"/g)].map((m) => m[1]));
  const citations = [...body.matchAll(/"type":"citation"/g)].length;
  console.log(
    `draft: status ${res.status()}, ${citations} citations, ${cited.size} different papers, library ready ${progress.ready}`,
  );
  console.log(body.slice(-600));
  expect(cited.size).toBeGreaterThan(0);
});
