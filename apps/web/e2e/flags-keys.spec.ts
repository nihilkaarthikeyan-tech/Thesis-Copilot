import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Working through flags from the keyboard (2026-10-04, from the Jenni study). The mock AI's
 * checks rarely find anything, so the flags list is supplied here in the shape
 * `GET /documents/:id/coherence/flags` returns; the resolve / ignore requests are captured.
 */
test('J and K move between flags, and R resolves the focused one', async ({ page, request }) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('flags-keys'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Flags keys ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  const flag = (id: string, description: string) => ({
    id,
    chapterId: doc.firstChapterId,
    chapterTitle: 'Chapter 1',
    relatedChapterId: null,
    relatedChapterTitle: null,
    type: 'UNSUPPORTED_CLAIM',
    severity: 'WARN',
    description,
    suggestion: null,
    from: 1,
    to: 2,
    status: 'OPEN',
    ignoreReason: null,
    createdAt: new Date().toISOString(),
    positionTrusted: false,
  });
  let flags = [
    flag('f1', 'First claim has no citation.'),
    flag('f2', 'Second claim has no citation.'),
  ];
  const actions: Array<{ id: string; action: string }> = [];
  const cors = {
    'access-control-allow-origin': 'http://localhost:3000',
    'access-control-allow-credentials': 'true',
  };
  await page.route(`${API_URL}/api/v1/documents/${doc.id}/coherence/flags**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          ...cors,
          'access-control-allow-headers': 'content-type',
          'access-control-allow-methods': 'GET,POST',
        },
      });
      return;
    }
    if (req.method() === 'POST') {
      const id = req.url().split('/').pop() ?? '';
      actions.push({ id, action: (req.postDataJSON() as { action: string }).action });
      flags = flags.filter((f) => f.id !== id);
      await route.fulfill({ status: 200, headers: cors, json: { ok: true } });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: cors,
      json: {
        flags,
        counts: { total: flags.length, UNSUPPORTED_CLAIM: flags.length },
        lastRunAt: null,
      },
    });
  });

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'check', exact: true }).click();
  const rows = page.getByTestId('flag');
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId('flags-keys')).toBeVisible();

  await rows.first().focus();
  await page.keyboard.press('j');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('k');
  await expect(rows.first()).toBeFocused();

  await page.keyboard.press('r');
  await expect(rows).toHaveCount(1);
  expect(actions).toEqual([{ id: 'f1', action: 'RESOLVE' }]);
  await expect(rows.first()).toContainText('Second claim');

  // Row 54 (2026-10-05): an unsupported claim can go looking for a source — the Papers tab opens
  // with the flagged sentence as the search.
  await rows.first().getByTestId('flag-find-source').click();
  await expect(page.getByTestId('find-papers')).toBeVisible();
  await expect(page.getByLabel('Search papers')).toHaveValue('Second claim has no citation.');
  await page.getByRole('tab', { name: 'check', exact: true }).click();

  // Row 59: Y and N as proofreading has them. N asks why (the prompt is dismissed) and ignores.
  page.on('dialog', (dialog) => void dialog.dismiss());
  await rows.first().focus();
  await page.keyboard.press('n');
  await expect(rows).toHaveCount(0);
  expect(actions.at(-1)).toEqual({ id: 'f2', action: 'IGNORE' });
});
