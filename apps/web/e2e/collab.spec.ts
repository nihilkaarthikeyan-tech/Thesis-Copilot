import { type Browser, expect, type Page, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Live co-authoring — ADR-0028, in two browsers.
 *
 * The student invites a co-author with "edit with me, live"; the co-author opens the chapter from
 * the guide page; each sees what the other types, and the chapter in the database has both.
 *
 * The `collaboration` flag is off in a seeded database, so the test turns it on as the seeded
 * superadmin and off again after. Only a document with a co-author goes live, so the other specs
 * running alongside keep their autosave editors.
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';

async function setFlag(request: Parameters<typeof establishSession>[0], enabled: boolean) {
  const admin = await establishSession(request, ADMIN_EMAIL);
  const response = await request.put(`${API_URL}/api/v1/admin/flags/collaboration`, {
    headers: { cookie: `${admin.cookieName}=${admin.cookieValue}` },
    data: { enabled },
  });
  expect(response.ok(), `flag: ${response.status()}`).toBe(true);
}

async function signedInPage(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const session = await establishSession(context.request, email);
  await context.addCookies([
    { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
  ]);
  return { page, context, cookie: `${session.cookieName}=${session.cookieValue}` };
}

const editorText = (page: Page) => page.locator('.thesis-editor').innerText();

test.afterAll(async ({ request }) => {
  await setFlag(request, false);
});

test('two people write one chapter and see each other', async ({ browser, request }) => {
  test.setTimeout(180_000);
  await setFlag(request, true);

  const ownerEmail = freshEmail('owner-live');
  const coauthorEmail = freshEmail('coauthor-live');
  const owner = await signedInPage(browser, ownerEmail);
  const created = await owner.context.request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie: owner.cookie },
    data: { title: `Live ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  // The invitation, as the share panel sends it.
  const shared = await owner.context.request.post(
    `${API_URL}/api/v1/documents/${doc.id}/feedback/shares`,
    { headers: { cookie: owner.cookie }, data: { guideEmail: coauthorEmail, canEdit: true } },
  );
  expect(shared.ok(), `share: ${shared.status()}`).toBe(true);
  const share = (await shared.json()) as { url: string; canEdit: boolean };
  expect(share.canEdit).toBe(true);

  // The owner's editor is live now that there is someone to write with.
  await owner.page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(owner.page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await expect(owner.page.getByTestId('autosave-status')).toHaveText(/^Live/, {
    timeout: 20_000,
  });

  // The co-author comes in through the guide page, as the e-mail would send them.
  const coauthor = await signedInPage(browser, coauthorEmail);
  await coauthor.page.goto(new URL(share.url).pathname);
  await coauthor.page.getByTestId('guide-edit-live').click();
  await expect(coauthor.page.getByTestId('coauthor-editor')).toBeVisible({ timeout: 30_000 });
  await expect(coauthor.page.getByTestId('live-status')).toHaveText(/Live with/, {
    timeout: 20_000,
  });
  await expect(owner.page.getByTestId('autosave-status')).toHaveText(/Live with/, {
    timeout: 20_000,
  });

  await owner.page.locator('.thesis-editor').click();
  await owner.page.keyboard.press('Control+End');
  await owner.page.keyboard.type('The owner wrote this. ');
  await expect
    .poll(() => editorText(coauthor.page), { timeout: 15_000 })
    .toContain('The owner wrote this.');

  await coauthor.page.locator('.thesis-editor p').last().click();
  await coauthor.page.keyboard.press('Control+End');
  await coauthor.page.keyboard.type('And the co-author added this.');
  // Landed in their own editor first; then it is the room's job.
  await expect(coauthor.page.locator('.thesis-editor')).toContainText(
    'And the co-author added this.',
  );
  await expect
    .poll(() => editorText(owner.page), { timeout: 15_000 })
    .toContain('And the co-author added this.');

  // Each other's cursor is drawn with a name on it.
  await expect(owner.page.locator('.collaboration-cursor__label').first()).toBeVisible();

  // The room wrote it all to the chapter, through the ordinary save.
  await expect
    .poll(
      async () => {
        const chapter = await owner.context.request.get(
          `${API_URL}/api/v1/chapters/${doc.firstChapterId}`,
          { headers: { cookie: owner.cookie } },
        );
        return JSON.stringify(await chapter.json());
      },
      { timeout: 15_000 },
    )
    .toMatch(/The owner wrote this\..*And the co-author added this\./s);

  await owner.page.screenshot({ path: 'test-results/collab-owner.png' });
  await coauthor.page.screenshot({ path: 'test-results/collab-coauthor.png' });
  await coauthor.context.close();
  await owner.context.close();
});

test('a comment-only guide is not offered the live editor', async ({ browser, request }) => {
  await setFlag(request, true);
  const owner = await signedInPage(browser, freshEmail('owner-ro'));
  const created = await owner.context.request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie: owner.cookie },
    data: { title: `Read only ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  const guideEmail = freshEmail('guide-ro');
  const shared = await owner.context.request.post(
    `${API_URL}/api/v1/documents/${doc.id}/feedback/shares`,
    { headers: { cookie: owner.cookie }, data: { guideEmail } },
  );
  const share = (await shared.json()) as { url: string };

  const guide = await signedInPage(browser, guideEmail);
  await guide.page.goto(new URL(share.url).pathname);
  await expect(guide.page.getByTestId('guide-chapter')).toBeVisible({ timeout: 30_000 });
  await expect(guide.page.getByTestId('guide-edit-live')).toHaveCount(0);
  // Typing the address of the live page does not help either.
  await guide.page.goto(`${new URL(share.url).pathname}/write/${doc.firstChapterId}`);
  await expect(guide.page.getByText('read and comment, not edit')).toBeVisible();
  await guide.context.close();
  await owner.context.close();
});
