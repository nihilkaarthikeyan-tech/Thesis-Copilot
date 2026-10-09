import { execSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from '../_session.js';

/**
 * QA 2026-10-09 (R37, ADR-0124): theme edits in the literature-review planner were sent only by
 * "Write", so leaving the page lost them. MEASURE=1 only: it turns the flag on in the local dev
 * database for the run (and off again) and gives the account one unit; it never presses Write.
 */
test.skip(!process.env.MEASURE, 'measurement run');

const psql = (sql: string) =>
  execSync(
    `docker exec thesis-copilot-dev-postgres-1 psql -U tc -d tc -At -c "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8' },
  ).trim();

const values = (l: import('@playwright/test').Locator) =>
  l.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

test('renamed and reordered themes survive a reload', async ({ page, request }) => {
  test.setTimeout(240_000);
  const email = freshEmail('litreview');
  const session = await establishSession(request, email);
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const doc = (await (
    await request.post(`${API_URL}/api/v1/documents`, {
      headers: { cookie },
      data: {
        title: `Rooftop solar adoption in rural Karnataka ${Date.now()}`,
        entryPath: 'A_TOPIC',
      },
    })
  ).json()) as { id: string };

  // An outline with a literature review chapter and three sections: the planner's first themes.
  const outline = ['Introduction', 'Literature review', 'Methodology'].map((title, i) => ({
    id: `ch${i + 1}`,
    title,
    scopeNote: `What chapter ${i + 1} must cover.`,
    children:
      i === 1
        ? ['Cost and credit barriers', 'Installer networks', 'Subsidy delivery'].map((s, j) => ({
            id: `ch2-sec${j + 1}`,
            title: s,
            scopeNote: '',
            children: [],
          }))
        : [],
  }));
  const saved = await request.put(`${API_URL}/api/v1/documents/${doc.id}/memory/outline`, {
    headers: { cookie },
    data: { outline },
  });
  expect(saved.ok(), `outline: ${saved.status()}`).toBe(true);

  psql(`UPDATE "FeatureFlag" SET enabled = true WHERE key = 'literatureReviewBuild'`);
  const period = new Date().toISOString().slice(0, 7);
  psql(
    `INSERT INTO "UsageLedger" ("id","userId","period","action","count","bonus") SELECT uuid_generate_v7(), id, '${period}', 'LIT_REVIEW_BUILD', 0, 1 FROM "User" WHERE email = '${email}'`,
  );
  try {
    // The flag is cached for 60 s by the API.
    await page.waitForTimeout(62_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/app/d/${doc.id}/build`);
    await expect(page.getByTestId('litreview-card')).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: '../../qa-shots/litreview-card.png' });
    await page.getByTestId('litreview-plan').click();
    const editor = page.getByTestId('litreview-plan-editor');
    await expect(editor).toBeVisible({ timeout: 60_000 });

    const titles = editor.locator('input[id^="theme-"]:not([id^="theme-note-"])');
    const count = await titles.count();
    console.log('themes', count, await values(titles));
    if (count === 0) {
      await page.getByTestId('litreview-add-theme').click();
      await page.getByTestId('litreview-add-theme').click();
    }
    await titles.nth(0).fill('Cost and credit barriers (renamed)');
    await expect(page.getByTestId('litreview-saved')).toHaveText('Changes saved.', {
      timeout: 10_000,
    });
    // A second save after the first (the ids the server renumbered): move the second theme up,
    // then rename the one now second.
    await editor.getByRole('button', { name: 'Move up' }).nth(1).click();
    await expect(page.getByTestId('litreview-saved')).toHaveText('Changes saved.', {
      timeout: 10_000,
    });
    await titles.nth(1).fill('Cost, credit and finance');
    await page.waitForTimeout(200);
    await expect(page.getByTestId('litreview-saved')).toHaveText('Changes saved.', {
      timeout: 10_000,
    });
    const before = await values(titles);
    await page.reload();
    await expect(page.getByTestId('litreview-plan-editor')).toBeVisible({ timeout: 30_000 });
    const after = await page
      .getByTestId('litreview-plan-editor')
      .locator('input[id^="theme-"]:not([id^="theme-note-"])')
      .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    console.log('before', before, 'after', after);
    expect(after).toEqual(before.filter((t) => t.trim()));
    await page.screenshot({ path: '../../qa-shots/litreview-after-reload.png', fullPage: true });
  } finally {
    psql(`UPDATE "FeatureFlag" SET enabled = false WHERE key = 'literatureReviewBuild'`);
    psql(
      `DELETE FROM "UsageLedger" WHERE action = 'LIT_REVIEW_BUILD' AND "userId" IN (SELECT id FROM "User" WHERE email = '${email}')`,
    );
  }
});
