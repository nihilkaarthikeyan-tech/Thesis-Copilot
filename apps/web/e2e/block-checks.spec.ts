import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * A check on one paragraph, from the block handle — Jenni build plan R26, ADR-0126.
 *
 * The grip beside a paragraph opens the block menu; "Check this paragraph" runs spelling and
 * grammar, the tone review or the examiner on that block only, for one command unit, and the
 * results open in the text through review mode (ADR-0110). Nothing changes until the student
 * presses Y. The menu itself stays inside the window at every width the owner checks.
 *
 * CI runs this on the mock, which corrects a fixed list of misspellings ("recieved",
 * "enviroment"), so the two planted mistakes sit in different paragraphs and only the checked
 * paragraph's may be found.
 */

const CHAPTER = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Findings' }] },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'The farmers recieved the subsidy late in the season, after planting had begun.',
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Dealers described a difficult enviroment for selling drip kits to smallholders.',
        },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'This chapter examines why adoption was slow in both districts.' },
      ],
    },
  ],
};

async function openChapter(page: Page, request: APIRequestContext, who: string) {
  const session = await establishSession(request, freshEmail(who));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Block checks ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  const chapter = (await (
    await request.get(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, { headers: { cookie } })
  ).json()) as { version: number };
  const saved = await request.put(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
    headers: { cookie },
    data: { content: CHAPTER, baseVersion: chapter.version },
  });
  expect(saved.ok(), `save: ${saved.status()}`).toBe(true);
  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  return { cookie, doc, editor };
}

/** Units of one action used this month. */
async function used(request: APIRequestContext, cookie: string, action: string): Promise<number> {
  const usage = (await (
    await request.get(`${API_URL}/api/v1/usage/me`, { headers: { cookie } })
  ).json()) as { actions: Array<{ action: string; used: number }> };
  return usage.actions.find((a) => a.action === action)?.used ?? 0;
}

/**
 * The block menu of the paragraph starting `text`. The handle appears on a mouse move over the
 * paragraph; the grip is pressed by its own click handler, so the press works even where the
 * grip sits at the window's edge (a narrow window).
 */
async function openBlockMenu(page: Page, text: string) {
  await page.locator('.thesis-editor p', { hasText: text }).hover();
  const grip = page.getByTestId('block-handle-grip');
  await expect(page.getByTestId('block-handle')).toBeVisible();
  await grip.dispatchEvent('click');
  const menu = page.getByTestId('block-menu');
  await expect(menu).toBeVisible();
  return menu;
}

test('spelling and grammar on one paragraph opens its one correction in the text', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const { cookie, editor } = await openChapter(page, request, 'block-proofread');
  const before = await used(request, cookie, 'COMMAND');

  const menu = await openBlockMenu(page, 'Dealers described');
  await menu.getByTestId('block-menu-review').click();
  await expect(menu.getByTestId('block-menu-checks')).toContainText('one command each');
  await menu.getByTestId('block-menu-review-proofread').click();
  await expect(menu).toHaveCount(0);

  // The review opens in the text with this paragraph's correction only.
  const review = page.getByTestId('review-mode');
  await expect(review).toBeVisible({ timeout: 90_000 });
  await expect(review).toContainText('this paragraph');
  await expect(page.getByTestId('review-mode-count')).toContainText('1 / 1');
  await expect(page.getByTestId('review-mode-current')).toContainText('enviroment');
  await expect(page.getByTestId('proofread-summary')).toContainText('in this paragraph');
  // Nothing has changed until the student says so.
  await expect(editor).toContainText('a difficult enviroment');

  await page.keyboard.press('y');
  await expect(editor).toContainText('a difficult environment');
  // The other paragraph was not read: its misspelling is still there, and no correction for it.
  await expect(editor).toContainText('The farmers recieved the subsidy');
  await expect(page.getByTestId('review-mode-done')).toBeVisible();
  await expect(page.getByTestId('review-mode-rerun')).toHaveText('Proofread it again');
  await page.keyboard.press('Escape');

  expect(await used(request, cookie, 'COMMAND')).toBe(before + 1);
});

test('the tone review of one paragraph is refused for nothing when there is no sample', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { cookie } = await openChapter(page, request, 'block-tone');
  const before = await used(request, cookie, 'COMMAND');

  const menu = await openBlockMenu(page, 'This chapter examines');
  await menu.getByTestId('block-menu-review').click();
  await menu.getByTestId('block-menu-review-tone').click();

  // A new thesis has no writing profile yet: the panel says how to fix that, and no unit goes.
  const panel = page.getByTestId('tone-panel');
  await expect(panel.getByRole('alert')).toContainText('writing profile', { timeout: 30_000 });
  expect(await used(request, cookie, 'COMMAND')).toBe(before);
});

test('the examiner on one paragraph is one command, not an examiner review', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const { cookie, doc } = await openChapter(page, request, 'block-examiner');
  const commands = await used(request, cookie, 'COMMAND');
  const reviews = await used(request, cookie, 'EXAMINER_REVIEW');

  const menu = await openBlockMenu(page, 'The farmers recieved');
  await menu.getByTestId('block-menu-review').click();
  await menu.getByTestId('block-menu-review-examiner').click();

  await expect(page.getByTestId('notice')).toContainText('reading the paragraph');
  await expect(page.getByRole('tab', { name: 'check', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const status = async () =>
    (
      (await (
        await request.get(`${API_URL}/api/v1/chapters/${doc.firstChapterId}/examiner-review`, {
          headers: { cookie },
        })
      ).json()) as { status: string; selection: boolean }
    ).status;
  await expect.poll(status, { timeout: 120_000, intervals: [2_000] }).toMatch(/DONE|FAILED/);
  if ((await status()) === 'DONE') {
    await expect(page.getByTestId('examiner-review-result')).toContainText('in the selected text', {
      timeout: 15_000,
    });
  }
  expect(await used(request, cookie, 'COMMAND')).toBe(commands + 1);
  expect(await used(request, cookie, 'EXAMINER_REVIEW')).toBe(reviews);
});

test('the block menu stays inside the window at every width, with a submenu open', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await openChapter(page, request, 'block-menu-fit');
  for (const [width, height] of [
    [1440, 900],
    [1280, 800],
    [1024, 600],
    [768, 1024],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const submenu of ['block-menu-review', 'block-menu-turn']) {
      // The last paragraph, near the bottom of the text: the case that used to run off-screen.
      const menu = await openBlockMenu(page, 'This chapter examines');
      await menu.getByTestId(submenu).click();
      const box = await menu.boundingBox();
      expect(box, `${width}x${height} ${submenu}`).not.toBeNull();
      if (!box) continue;
      expect(box.x, `${width} left`).toBeGreaterThanOrEqual(0);
      expect(box.y, `${width} top`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${width} right`).toBeLessThanOrEqual(width);
      expect(box.y + box.height, `${width}x${height} bottom`).toBeLessThanOrEqual(height);
      // Every row of the open submenu fits across the menu: nothing is cut off at the side.
      const overflow = await menu.evaluate((el) =>
        [...el.querySelectorAll('button, p')].some(
          (child) => (child as HTMLElement).scrollWidth > (child as HTMLElement).clientWidth + 1,
        ),
      );
      expect(overflow, `${width} ${submenu} rows`).toBe(false);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
    }
  }
});
