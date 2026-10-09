import { execSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { measureLayout } from '../_layout.js';
import { API_URL, establishSession, freshEmail } from '../_session.js';

/**
 * ADR-0116 leftovers (2026-10-09): rename a chat and search the list, in the 288 px panel and the
 * phone drawer. MEASURE=1 only: the chats are rows written straight into the local dev database,
 * so no model is called.
 */
test.skip(!process.env.MEASURE, 'measurement run');

const psql = (sql: string) =>
  execSync(
    `docker exec thesis-copilot-dev-postgres-1 psql -U tc -d tc -At -c "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8' },
  ).trim();

test('rename a chat and find it by searching', async ({ page, request }) => {
  test.setTimeout(180_000);
  const session = await establishSession(request, freshEmail('chat-rename'));
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const doc = (await (
    await request.post(`${API_URL}/api/v1/documents`, {
      headers: { cookie: `${session.cookieName}=${session.cookieValue}` },
      data: { title: 'Untitled thesis', entryPath: 'A_TOPIC' },
    })
  ).json()) as { id: string; firstChapterId: string };
  const titles = [
    'Which survey counted installers in Mandya and Tumakuru districts last year?',
    'Subsidy delays',
    'Cost of credit for small farmers',
    'Net metering rules',
  ];
  titles.forEach((title, i) => {
    psql(
      `INSERT INTO "ChatThread" ("id","documentId","title","questions","turns","updatedAt") VALUES (uuid_generate_v7(), '${doc.id}', '${title}', 1, '[]', now() - interval '${i} minutes')`,
    );
  });

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 860 });
    await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
    await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
    if (width === 390) await page.getByTestId('mobile-bar').getByTestId('mobile-chat').click();
    else await page.getByRole('tab', { name: 'chat', exact: true }).click();
    await expect(page.getByTestId('chat-panel')).toBeVisible();
    await page.getByTestId('chat-threads-toggle').click();
    const panel = page.getByTestId('chat-threads-panel');
    await expect(panel.getByTestId('chat-thread')).toHaveCount(4);

    await panel.getByTestId('chat-threads-search').fill('credit');
    await expect(panel.getByTestId('chat-thread')).toHaveCount(1);
    await panel.getByTestId('chat-threads-search').fill('nothing like this');
    await expect(panel.getByTestId('chat-threads-nomatch')).toBeVisible();
    await panel.getByTestId('chat-threads-search').fill('');

    await panel.getByTestId('chat-thread-rename').first().click();
    const input = panel.getByTestId('chat-thread-rename-input');
    await input.fill(`Installer survey (${width})`);
    await page.screenshot({ path: `../../qa-shots/chat-rename-${width}.png` });
    expect(await page.evaluate(measureLayout, false)).toEqual([]);
    await input.press('Enter');
    await expect(panel.getByTestId('chat-thread').first()).toContainText(
      `Installer survey (${width})`,
    );
    await page.screenshot({ path: `../../qa-shots/chat-renamed-${width}.png` });
    expect(await page.evaluate(measureLayout, false)).toEqual([]);
  }
});
