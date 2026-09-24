import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { establishSession, freshEmail, type Session } from './_session.js';

/**
 * Error and empty states — PRD §6.2, §6.4, PHASES 5.2.
 *
 *   "Done when: a Playwright test forces each state via the mock and asserts the copy."
 *
 * Each state is forced the way it would actually arise, through the real API against the mock
 * provider: an empty library, a provider failure the mock is told to produce, fifty accepted
 * suggestions, a stale save, a file that is not a PDF. The assertions are on the words a student
 * reads, because that is what §6.4 specifies.
 */

let session: Session | null = null;

async function signIn(page: Page, request: APIRequestContext) {
  session ??= await establishSession(request, freshEmail('states'));
  const { cookieName, cookieValue } = session;
  await page
    .context()
    .addCookies([{ name: cookieName, value: cookieValue, domain: 'localhost', path: '/' }]);
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Your theses' })).toBeVisible({
    timeout: 20_000,
  });
}

/** A fresh thesis with no library, opened in the editor. */
async function openFreshChapter(page: Page, title: string): Promise<void> {
  await page.getByLabel('Working title').fill(title);
  await page.getByRole('button', { name: 'Create thesis' }).click();
  await page.getByRole('link', { name: title }).click();
  await expect(page).toHaveURL(/\/write\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 20_000 });
}

test.describe('§6.2 states, forced through the mock', () => {
  test.setTimeout(240_000);

  test('empty grounding: a suggestion with no sources says so and points at the panel', async ({
    page,
    request,
  }) => {
    await signIn(page, request);
    await openFreshChapter(page, `States empty ${Date.now()}`);

    await page.locator('.thesis-editor p').first().click();
    await page.keyboard.type('Prior studies in Karnataka found ');
    await page.keyboard.press('Control+/');
    await expect(page.locator('.thesis-editor span.ghost[data-status="shown"]')).toBeVisible({
      timeout: 15_000,
    });

    // Not an error: the suggestion arrived, and the hint says what would make the next one cited.
    await expect(page.getByTestId('notice')).toContainText('no sources to draw on');
    await expect(page.getByTestId('notice')).toContainText('Pin some in the Sources panel');
    await expect(page.locator('.thesis-editor span.ghost')).toBeVisible();
  });

  test('provider error: one failure is retried silently, two in a row are reported', async ({
    page,
    request,
  }) => {
    await signIn(page, request);
    await openFreshChapter(page, `States provider ${Date.now()}`);
    const editor = page.locator('.thesis-editor');
    await editor.locator('p').first().click();

    // Only the mock knows this marker. In the guided instruction it affects one request: the
    // retry goes out without it and succeeds, so the student sees a suggestion, not an error.
    await page.keyboard.type('Rooftop solar uptake ');
    await page.keyboard.press('Shift+ArrowRight');
    const guided = page.getByTestId('guided-input');
    await expect(guided).toBeVisible();
    await guided.getByLabel('Guide this suggestion').fill('[[mock:error]]');
    await page.keyboard.press('Enter');
    await expect(editor.locator('span.ghost')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('notice')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // In the chapter text itself it travels with every request, including the retry.
    await page.keyboard.type(' [[mock:error]] ');
    await page.keyboard.press('Control+/');
    await expect(page.getByTestId('notice')).toContainText('did not answer twice in a row', {
      timeout: 15_000,
    });
    await expect(page.getByTestId('notice')).toContainText('Your writing is saved');
  });

  test('cap exceeded: the fifty-first Assist says when the cap resets, in local time', async ({
    page,
    request,
  }) => {
    // Its own account, not the file's shared one: spending fifty Assist units is most of §12.1's
    // sixty-a-minute per-user burst guard, and sharing the session with the other tests here
    // trips that guard before the cap this test is about.
    const own = await establishSession(request, freshEmail('states-cap'));
    await page
      .context()
      .addCookies([
        { name: own.cookieName, value: own.cookieValue, domain: 'localhost', path: '/' },
      ]);
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: 'Your theses' })).toBeVisible({
      timeout: 20_000,
    });
    await openFreshChapter(page, `States cap ${Date.now()}`);
    const editor = page.locator('.thesis-editor');
    await editor.locator('p').first().click();
    await page.keyboard.type('Prior studies found ');

    // FREE_TRIAL allows 50 Assist actions a month (PRD §11.3). Dismissing still counts: the
    // tokens were generated.
    const meter = page.getByTestId('usage-meter');
    await expect(meter).toContainText(/Assist \d+\/50/);
    const used = Number(/Assist (\d+)\/50/.exec((await meter.textContent()) ?? '')?.[1] ?? 0);
    for (let i = used; i < 50; i++) {
      await page.keyboard.press('Control+/');
      await expect(page.locator('.thesis-editor span.ghost[data-status="shown"]')).toBeVisible({
        timeout: 15_000,
      });
      await page.keyboard.press('Escape');
      await expect(editor.locator('span.ghost')).toHaveCount(0);
    }
    await expect(page.getByTestId('usage-meter')).toContainText('Assist 50/50');

    await page.keyboard.press('Control+/');
    const notice = page.getByTestId('notice');
    await expect(notice).toContainText('used all 50', { timeout: 15_000 });
    // The reset moment is 00:00 UTC on the 1st, rendered through Intl in the browser's timezone:
    // a real date, not the ISO string the API sent.
    await expect(notice).toContainText(/resets on .*\d{4}/);
    await expect(notice).not.toContainText('T00:00:00');
    await expect(notice).toContainText('nothing you type is affected');
  });

  test('autosave conflict: a stale save shows the 409 screen rather than overwriting', async ({
    page,
    request,
    context,
  }) => {
    await signIn(page, request);
    await openFreshChapter(page, `States conflict ${Date.now()}`);
    const url = page.url();

    // A second tab on the same chapter saves first.
    const other = await context.newPage();
    await other.goto(url);
    await expect(other.locator('.thesis-editor')).toBeVisible({ timeout: 20_000 });
    await other.locator('.thesis-editor p').first().click();
    await other.keyboard.type('Written in the other tab. ');
    await expect(other.getByText('Saved', { exact: true })).toBeVisible({ timeout: 15_000 });

    // The first tab's next save carries a stale base version.
    await page.locator('.thesis-editor p').first().click();
    await page.keyboard.type('Written here afterwards. ');
    await expect(page.getByTestId('autosave-status')).toHaveText('Changed elsewhere', {
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: /Reload/ })).toBeVisible();
    await other.close();
  });

  test('upload failure: a file that is not a PDF is refused with a reason', async ({
    page,
    request,
  }) => {
    await signIn(page, request);
    await page.getByLabel('Working title').fill(`States upload ${Date.now()}`);
    await page.getByRole('button', { name: 'Create thesis' }).click();
    const proposal = page
      .getByRole('listitem')
      .filter({ hasText: 'States upload' })
      .getByRole('link', { name: 'Proposal', exact: true });
    await proposal.click();

    await page.locator('input[type=file]').setInputFiles({
      name: 'notes.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('MZ\x90\x00this is not a paper'),
    });
    // Next's route announcer is also role=alert; the refusal is the one that names the formats.
    const alert = page.getByRole('alert').filter({ hasText: /\.pdf/ });
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText(/\.pdf or a \.docx/);
    // Still on the empty state: nothing was accepted.
    await expect(page.getByText('Upload the paper this thesis grows from.')).toBeVisible();
  });
});
