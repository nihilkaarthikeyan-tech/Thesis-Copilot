import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Pins per section (ADR-0085): under a heading the Sources tab offers "This section", and a pin
 * set there is saved for that heading alone. The library and the pins endpoints are supplied
 * here; the API side is `apps/api/test/section-pins-api.spec.ts`.
 */

test('under a heading, pins can be set for that section alone', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const cors = {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'content-type': 'application/json',
  };
  const session = await establishSession(request, freshEmail('section-pins'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Section pins ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  const sourceId = '01a10000-0000-7000-8000-0000000000e1';
  await page.route(`${API_URL}/api/v1/documents/${doc.id}/sources`, (route) =>
    route.fulfill({
      status: 200,
      headers: cors,
      json: [
        {
          id: sourceId,
          title: 'Household frictions in rooftop solar adoption',
          rawReference: null,
          year: 2026,
          status: 'RESOLVED',
          groundingLevel: 'FULL_TEXT',
        },
      ],
    }),
  );
  const puts: Array<Record<string, unknown>> = [];
  let sectionPins: string[] = [];
  await page.route(`${API_URL}/api/v1/chapters/${doc.firstChapterId}/pins**`, (route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      const body = req.postDataJSON() as { sourceIds: string[]; section?: string };
      puts.push(body);
      if (body.section) sectionPins = body.sourceIds;
      return route.fulfill({ status: 200, headers: cors, json: { sourceIds: body.sourceIds } });
    }
    const url = new URL(req.url());
    const section = url.searchParams.get('section');
    return route.fulfill({
      status: 200,
      headers: cors,
      json: {
        sourceIds: [],
        ...(section ? { section: { title: section, sourceIds: sectionPins } } : {}),
      },
    });
  });

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });

  // A heading, then a paragraph under it where the cursor rests.
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('## Financial constraints');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Upfront cost comes first.');

  await page.getByRole('tab', { name: 'sources', exact: true }).click();
  const scope = page.getByTestId('pins-scope');
  await expect(scope).toBeVisible();
  await expect(scope).toContainText('Financial constraints');
  await page.getByTestId('pins-scope-section').check();
  await expect(page.getByText(/This section has no pins of its own/)).toBeVisible();

  await page.locator(`#pin-${sourceId}`).check();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]).toEqual({ sourceIds: [sourceId], section: 'Financial constraints' });
  await expect(
    page.getByText(/Under this heading, suggestions draw only on its 1 pinned source/),
  ).toBeVisible();

  // Back to the chapter's scope: the box is unticked there, because the chapter has no pins.
  await page.getByRole('radio', { name: 'This chapter' }).check();
  await expect(page.locator(`#pin-${sourceId}`)).not.toBeChecked();
});
