import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { establishSession, freshEmail } from './_session.js';
import { setUpQuickly, writeFirstLine } from './_setup.js';

/**
 * "Start writing now" — ADR-0062 (ADR-0059 row 2), set up in the editor since ADR-0145.
 *
 * A third way in, beside the two proposal paths: the thesis is made and opens on its first
 * chapter with the "Set up this thesis" card, and the proposal stays one click away — on the list
 * and in the editor — for a thesis that has none. The existing paths are untouched (their specs
 * are unchanged).
 */

async function signIn(page: Page, request: APIRequestContext, prefix: string): Promise<void> {
  const session = await establishSession(request, freshEmail(prefix));
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
}

test('from the thesis list, with no title typed: an untitled thesis opens in the editor', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await signIn(page, request, 'start-writing-list');

  await page.goto('/app');
  const form = page.getByTestId('new-thesis-form');
  await expect(form).toBeVisible({ timeout: 30_000 });
  await form.getByTestId('start-writing-now').click();

  await expect(page).toHaveURL(/\/app\/d\/[0-9a-f-]{36}\/write\/[0-9a-f-]{36}$/, {
    timeout: 30_000,
  });
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  // ADR-0145: the card asks for the title first; nothing is searched for "Untitled thesis".
  await expect(page.getByTestId('setup-card')).toHaveAttribute('data-step', 'title');
  await expect(page.getByTestId('setup-title-input')).toHaveValue('');
  await expect(page.getByTestId('setup-title-next')).toBeDisabled();

  // The student can still just write.
  await page.getByTestId('setup-finish-later').click();
  await editor.locator('p').first().click();
  await page.keyboard.type('Fish drying in coastal villages loses a fifth of the catch.');
  await expect(editor).toContainText('Fish drying in coastal villages');
  await expect(page.getByTestId('status-line-text')).toContainText('set up 1 of 5');

  // Back on the list, the thesis is "Untitled thesis" and still offers the proposal.
  await page.goto('/app');
  const card = page.getByRole('listitem').filter({ hasText: 'Untitled thesis' });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByTestId('add-proposal')).toContainText('No proposal yet');
  await card.getByRole('link', { name: 'Add a proposal' }).click();
  await expect(page).toHaveURL(/\/app\/d\/[0-9a-f-]{36}\/proposal$/, { timeout: 30_000 });
});

test('from /app/new, a typed title is kept, and once set up the guide and the proposal prompt follow', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await signIn(page, request, 'start-writing-new');

  await page.goto('/app/new');
  await expect(page.getByRole('heading', { name: 'Where does this thesis start?' })).toBeVisible({
    timeout: 30_000,
  });
  const title = `Solar dryers for fish in coastal Kerala ${Date.now()}`;
  await page.getByLabel('Working title').fill(title);
  await page.getByTestId('start-writing-now').click();

  await expect(page).toHaveURL(/\/app\/d\/[0-9a-f-]{36}\/write\/[0-9a-f-]{36}$/, {
    timeout: 30_000,
  });
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('setup-title-input')).toHaveValue(title);
  // ADR-0145: while the card is unfinished, the guide and the proposal prompt wait.
  await expect(page.getByTestId('add-proposal')).toHaveCount(0);
  await setUpQuickly(page);
  await writeFirstLine(page, 'Solar dryers cut losses.');

  // ADR-0073: the guide, whose last step is planning, stands in for the proposal prompt.
  await page.getByTestId('status-line-toggle').click();
  const guide = page.getByTestId('first-session-guide');
  await expect(guide).toBeVisible();
  await expect(page.getByTestId('add-proposal')).toHaveCount(0);
  await guide.getByRole('button', { name: 'Hide' }).click();

  // The proposal is offered, gently, and goes where the proposal lives.
  const prompt = page.getByTestId('add-proposal');
  await expect(prompt).toContainText('This thesis has no proposal yet');
  const id = /\/app\/d\/([0-9a-f-]{36})\//.exec(page.url())?.[1];
  await expect(prompt.getByRole('link', { name: 'Add a proposal' })).toHaveAttribute(
    'href',
    `/app/d/${id}/proposal`,
  );
  // "Not now" puts it away for this thesis, in this browser.
  await prompt.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByTestId('add-proposal')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('add-proposal')).toHaveCount(0);

  await page.goto('/app');
  await expect(page.getByRole('link', { name: title }).first()).toBeVisible({ timeout: 30_000 });
});
