import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Version history — every saved version readable, restorable, and the restore undoable.
 *
 * Snapshots were written from week 2 onwards and nothing could read one back. This drives the whole
 * loop a student actually goes through: write something, replace it, regret it, get it back — and
 * then change their mind about getting it back, which is the part that makes trying safe.
 */

const FIRST = 'The first version of this paragraph argued that cost was the main barrier.';
const SECOND = 'A rewritten paragraph that argues something else entirely about adoption.';

test('an old version can be read, restored, and the restore undone', async ({ page, request }) => {
  test.setTimeout(180_000);
  const session = await establishSession(request, freshEmail('history'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);

  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `History ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });

  // Version one, saved with Ctrl+S — which is also a MANUAL snapshot.
  await editor.locator('p').first().click();
  await page.keyboard.type(FIRST);
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });

  // Version two replaces it. A triple click selects the paragraph; Home then Shift+End would only
  // select to the end of the first *visual* line, and this sentence wraps at some widths.
  await editor.locator('p').first().click({ clickCount: 3 });
  await page.keyboard.type(SECOND);
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(editor).toContainText(SECOND);
  await expect(editor).not.toContainText(FIRST);

  // Open History and find the version that still says the first thing.
  await page.getByTestId('open-history').click();
  const history = page.getByTestId('version-history');
  await expect(history).toBeVisible();
  const rows = history.getByTestId('version-row');
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  expect(await rows.count()).toBeGreaterThanOrEqual(2);
  // Every row says how long the chapter was, which is what tells two timestamps apart.
  await expect(rows.first()).toContainText('words');

  const preview = history.getByTestId('version-preview');
  let found = false;
  for (let i = 0; i < (await rows.count()); i++) {
    await rows.nth(i).click();
    // Not "the preview is visible": the previous version's preview is visible until the fetch for
    // this one lands, and reading it then picks the wrong row to restore. A row is only marked
    // current once the preview holds that version.
    await expect(rows.nth(i)).toHaveAttribute('aria-current', 'true', { timeout: 20_000 });
    if ((await preview.textContent())?.includes(FIRST)) {
      found = true;
      break;
    }
  }
  expect(found, 'no saved version contained the first text').toBe(true);

  // Reading a version changes nothing — the chapter behind the sheet is untouched.
  await expect(editor).toContainText(SECOND);

  // Restore asks first, and says it is undoable.
  await history.getByTestId('version-restore').click();
  await expect(history).toContainText('so this can be undone');
  await history.getByTestId('version-restore-confirm').click();

  // The page reloads onto the old text, and offers to put the new one back.
  const banner = page.getByTestId('restore-banner');
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.thesis-editor')).toContainText(FIRST, { timeout: 20_000 });
  await expect(page.locator('.thesis-editor')).not.toContainText(SECOND);

  // Undo is itself a restore, of the snapshot the first restore wrote.
  await banner.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('restore-banner')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.thesis-editor')).toContainText(SECOND, { timeout: 20_000 });
  await expect(page.locator('.thesis-editor')).not.toContainText(FIRST);
});

test('a version that is not yours reads as absent, and a malformed id is not a server error', async ({
  request,
  playwright,
}) => {
  const owner = await establishSession(request, freshEmail('history-owner'));
  // Its own request context: the `request` fixture keeps the cookies it is sent, so a second
  // sign-in through it goes out already signed in as the first account and is refused (403).
  const strangerContext = await playwright.request.newContext();
  const stranger = await establishSession(strangerContext, freshEmail('history-stranger'));
  const ownerCookie = `${owner.cookieName}=${owner.cookieValue}`;
  const strangerCookie = `${stranger.cookieName}=${stranger.cookieValue}`;

  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie: ownerCookie },
    data: { title: `Private ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  const snap = await request.post(`${API_URL}/api/v1/chapters/${doc.firstChapterId}/snapshot`, {
    headers: { cookie: ownerCookie },
    data: { reason: 'MANUAL' },
  });
  const { id: versionId } = (await snap.json()) as { id: string };

  // §12.1: someone else's version is not forbidden, it simply is not there.
  const read = await request.get(`${API_URL}/api/v1/versions/${versionId}`, {
    headers: { cookie: strangerCookie },
  });
  expect(read.status()).toBe(404);
  const restore = await request.post(`${API_URL}/api/v1/versions/${versionId}/restore`, {
    headers: { cookie: strangerCookie },
    data: {},
  });
  expect(restore.status()).toBe(404);

  // A malformed id used to reach Postgres as an invalid UUID and come back a 500.
  const malformed = await request.get(`${API_URL}/api/v1/versions/not-a-uuid`, {
    headers: { cookie: ownerCookie },
  });
  expect(malformed.status()).toBe(404);
  await strangerContext.dispose();
});
