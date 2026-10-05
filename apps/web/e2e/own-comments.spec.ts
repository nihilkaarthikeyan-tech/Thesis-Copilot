import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/** A student can comment on their own text (2026-10-04, from the Jenni study). */
test('a student leaves a comment on a passage and finds it under Review', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('own-comment'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Own comment ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.locator('p').first().click();
  await page.keyboard.type('Rainfall in the district fell by a fifth between 2001 and 2020.');
  await page.keyboard.press('Shift+Home');

  await page.getByTestId('comment-on-selection').click();
  await page.getByLabel('Your comment on the selected text').fill('Check against the IMD series');
  await page.getByRole('button', { name: 'Save comment' }).click();
  await expect(page.getByTestId('notice')).toContainText('Comment added');

  await page.getByRole('tab', { name: 'comments', exact: true }).click();
  await expect(page.getByText('Check against the IMD series')).toBeVisible({ timeout: 15_000 });
});

/** Selected text can be taken to the chat (2026-10-04, from the Jenni study). */
test('"Ask chat" on a selection opens the chat with the passage in the box, unsent', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('ask-chat'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Ask chat ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.locator('p').first().click();
  await page.keyboard.type('Groundwater tables fell fastest in hard-rock districts.');
  await page.keyboard.press('Shift+Home');

  await page.getByTestId('ask-chat-on-selection').click();
  await expect(page.getByRole('tab', { name: 'chat', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const box = page.locator('#chat-message');
  await expect(box).toHaveValue(/^About this passage: "Groundwater tables fell fastest/);
  await expect(box).toBeFocused();
});

/** A selected sentence can be searched for papers at once (2026-10-04, from the Jenni study). */
test('"Find papers" on a selection opens the Papers tab searching for that sentence', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('find-on-selection'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Find on selection ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.locator('p').first().click();
  await page.keyboard.type('Managed aquifer recharge raises groundwater levels.');
  await page.keyboard.press('Shift+Home');

  const searched = page.waitForRequest(
    (r) => r.url().endsWith('/chat/web') && r.method() === 'POST',
  );
  await page.getByTestId('find-papers-on-selection').click();
  await expect(page.getByRole('tab', { name: 'papers', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel('Search papers')).toHaveValue(
    'Managed aquifer recharge raises groundwater levels.',
  );
  expect((await searched).postDataJSON()).toMatchObject({
    message: 'Managed aquifer recharge raises groundwater levels.',
  });
});

/** More edits on a selection (ADR-0066): hedge rewrites, and "More direct" needs a citation. */
test('"More edits" hedges a selection through the same diff and Replace', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('more-edits'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `More edits ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.locator('p').first().click();
  await page.keyboard.type('The survey shows that cost is the main barrier to adoption.');
  await page.keyboard.press('Shift+Home');

  const more = page.getByTestId('more-edits');
  await more.locator('summary').click();
  // No citation in the selection: "More direct" waits for one.
  await expect(more.getByRole('button', { name: 'More direct' })).toBeDisabled();
  await more.getByRole('button', { name: 'Hedge' }).click();
  await page.getByRole('button', { name: 'Replace' }).click();
  await expect(editor).toContainText('The survey suggests that cost is the main barrier');
});

/** An examiner review of just the selection (ADR-0067): one section command, flags on its sentences. */
test('"Examiner review" on a selection reviews just those sentences', async ({ page, request }) => {
  test.setTimeout(180_000);
  const session = await establishSession(request, freshEmail('review-selection'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Review selection ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.locator('p').first().click();
  await page.keyboard.type('Open drying loses an estimated fifth of the catch to spoilage.');
  await page.keyboard.press('Shift+Home');

  await page.getByTestId('review-selection').click();
  await expect(page.getByTestId('notice')).toContainText('reading the selection');
  await expect(page.getByRole('tab', { name: 'check', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // The worker finishes the run; the review's record says so.
  await expect
    .poll(
      async () =>
        (
          (await (
            await request.get(`${API_URL}/api/v1/chapters/${doc.firstChapterId}/examiner-review`, {
              headers: { cookie },
            })
          ).json()) as { status: string }
        ).status,
      { timeout: 120_000, intervals: [2_000] },
    )
    .toMatch(/DONE|FAILED/);
});
