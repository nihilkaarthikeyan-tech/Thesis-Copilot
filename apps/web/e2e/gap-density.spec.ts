/**
 * ADR-0046 — the gap map shows each theme's real publication density and reads most-open-gap
 * first. The search runs against the real OpenAlex (the worker uses it in every mode), so the
 * numbers on screen are OpenAlex's; the assertions check their shape, not their values.
 */

import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session';

test('discover shows a density line per theme, checkable on OpenAlex, open gaps first', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const s = await establishSession(request, freshEmail('density'));
  await page
    .context()
    .addCookies([{ name: s.cookieName, value: s.cookieValue, domain: 'localhost', path: '/' }]);
  const headers = { cookie: `${s.cookieName}=${s.cookieValue}` };

  const title = 'Solar drying of marine fish in coastal Tamil Nadu';
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers,
    data: { title, entryPath: 'A_TOPIC' },
  });
  const { id } = (await created.json()) as { id: string };
  const scope = await request.put(`${API_URL}/api/v1/documents/${id}/memory/scope`, {
    headers,
    data: {
      workingTitle: title,
      problemStatement: 'Open-air drying on the coast loses a fifth of the landed catch.',
      objectives: ['Design a forced-convection solar dryer', 'Measure drying curves'],
      whyOpen: 'Published dryer designs assume inland humidity and report no coastal results.',
    },
  });
  expect(scope.ok(), 'saving the proposal').toBe(true);

  const started = await request.post(`${API_URL}/api/v1/documents/${id}/search`, {
    headers,
    data: { mode: 'discover' },
  });
  expect(started.ok(), `search: ${started.status()}`).toBe(true);
  const { runId } = (await started.json()) as { runId: string };

  type View = {
    status: string;
    error: string | null;
    themes: Array<{
      name: string;
      density?: { query: string; total: number };
      signal?: { gapScore: number };
    }>;
  };
  let view: View | null = null;
  await expect
    .poll(
      async () => {
        view = (await (
          await request.get(`${API_URL}/api/v1/documents/${id}/search/${runId}`, { headers })
        ).json()) as View;
        return view.status;
      },
      { timeout: 240_000, intervals: [3_000], message: 'the search never finished' },
    )
    .toBe('DONE');

  const themes = (view as View | null)?.themes ?? [];
  const named = themes.filter((t) => t.name.toLowerCase() !== 'other');
  expect(named.length).toBeGreaterThan(0);
  // Every named theme carries a query built from the thesis title and a real count.
  for (const t of named) {
    expect(t.density?.query.startsWith('solar drying marine'), t.name).toBe(true);
    expect(typeof t.density?.total).toBe('number');
  }
  // Most open gap first; "Other", if any, last.
  const scores = named.map((t) => t.signal?.gapScore ?? 0);
  expect(scores).toEqual([...scores].sort((a, b) => b - a));
  if (themes.some((t) => t.name.toLowerCase() === 'other')) {
    expect(themes.at(-1)?.name.toLowerCase()).toBe('other');
  }

  await page.goto(`/app/d/${id}/sources`);
  await page
    .getByRole('button', { name: /discover/i })
    .first()
    .click();
  const lines = page.getByTestId('theme-density');
  await expect(lines.first()).toBeVisible({ timeout: 30_000 });
  await expect(lines.first()).toContainText('in the title or abstract');
  await expect(lines.first().getByRole('link')).toHaveAttribute(
    'href',
    /^https:\/\/openalex\.org\/works\?filter=title_and_abstract\.search%3Asolar%20drying%20marine/,
  );
});
