import { expect, test } from '@playwright/test';
import { type LayoutFault, measureLayout, settle } from './_layout.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * R32 (ADR-0127) in a browser: the theses beside the open one, in the chapter rail — unfold it,
 * see every thesis on the list but not the archived one, switch to another without going back to
 * `/app` — and the one New ▾ menu, on the list and in the rail, whose three items open `/app/new`
 * on the right starting point. Measured open at every width the owner checks, with a long title.
 */

test('switch theses from the rail, and the New menu opens each start', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const session = await establishSession(request, freshEmail('beside'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const stamp = Date.now();
  const titles = {
    here: `Groundwater recharge in hard-rock aquifers ${stamp}`,
    other: `Night-time urban heat islands and heat illness among outdoor workers in coastal Indian cities ${stamp}`,
    shelved: `Archived pilot survey of drip irrigation ${stamp}`,
  };
  const ids: Record<string, { id: string; firstChapterId: string }> = {};
  for (const [key, title] of Object.entries(titles)) {
    const created = await request.post(`${API_URL}/api/v1/documents`, {
      headers: { cookie },
      data: { title, entryPath: 'A_TOPIC' },
    });
    expect(created.ok()).toBe(true);
    ids[key] = (await created.json()) as { id: string; firstChapterId: string };
  }
  const archived = await request.post(`${API_URL}/api/v1/documents/${ids.shelved?.id}/archive`, {
    headers: { cookie },
    data: {},
  });
  expect(archived.ok()).toBe(true);

  const here = ids.here as { id: string; firstChapterId: string };
  const other = ids.other as { id: string; firstChapterId: string };

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/app/d/${here.id}/write/${here.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  const rail = page.getByTestId('chapter-rail');

  // Folded at first; the chapter list below is as it was.
  await expect(rail.getByTestId('thesis-switcher-list')).toHaveCount(0);
  await rail.getByTestId('thesis-switcher-toggle').click();
  const items = rail.getByTestId('thesis-switcher-item');
  await expect(items).toHaveCount(2);
  await expect(rail.getByTestId('thesis-switcher-toggle')).toHaveText(/Theses \(2\)/);
  await expect(items.filter({ hasText: titles.here })).toHaveAttribute('aria-current', 'page');
  await expect(rail.getByText(titles.shelved)).toHaveCount(0);

  // The measured states: the list open, then the rail's New menu open.
  const found: Array<{ where: string } & LayoutFault> = [];
  const check = async (where: string) => {
    for (const fault of await page.evaluate(measureLayout, false)) found.push({ where, ...fault });
  };
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/app/d/${here.id}/write/${here.firstChapterId}`);
    await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
    // On a phone the rail is a drawer, opened from the bottom bar.
    if (width < 768) {
      await page
        .getByTestId('mobile-bar')
        .getByRole('button', { name: 'Chapters', exact: true })
        .click();
    }
    await settle(page);
    // Remembered open from the first unfold.
    await expect(rail.getByTestId('thesis-switcher-list')).toBeVisible();
    await check(`${width} rail, theses open`);
    await rail.getByTestId('rail-new-menu-button').click();
    const menu = rail.getByTestId('rail-new-menu-items');
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= width, `${width} rail menu inside`).toBe(true);
    await check(`${width} rail, New open`);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    await page.goto('/app');
    await settle(page);
    await page.getByTestId('new-menu-button').click();
    const listMenu = page.getByTestId('new-menu-items');
    await expect(listMenu).toBeVisible();
    const listBox = await listMenu.boundingBox();
    expect(
      listBox && listBox.x >= 0 && listBox.x + listBox.width <= width,
      `${width} list menu inside`,
    ).toBe(true);
    await check(`${width} list, New open`);
  }
  expect(
    found,
    found
      .map((f) => `${f.where}: ${f.kind} ${f.by ?? ''}px ${f.el ?? ''} in ${f.box ?? ''}`)
      .join('\n'),
  ).toEqual([]);

  // Switch: straight into the other thesis's chapter, no stop at the list.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/app/d/${here.id}/write/${here.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await rail.getByTestId('thesis-switcher-item').filter({ hasText: titles.other }).click();
  await expect(page).toHaveURL(new RegExp(`/app/d/${other.id}/write/`));
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await expect(
    rail.getByTestId('thesis-switcher-item').filter({ hasText: titles.other }),
  ).toHaveAttribute('aria-current', 'page');

  // The New menu's three starts, each the chooser on its starting point.
  await page.goto('/app');
  await page.getByTestId('new-menu-button').click();
  await page.getByRole('menuitem', { name: /New thesis/ }).click();
  await expect(page).toHaveURL(/\/app\/new\?start=topic/);
  await expect(page.getByLabel(/Start from a topic/)).toBeChecked();

  await page.goto('/app');
  await page.getByTestId('new-menu-button').click();
  await page.getByRole('menuitem', { name: /Upload a paper/ }).click();
  await expect(page).toHaveURL(/\/app\/new\?start=paper/);
  await expect(page.getByLabel(/Start from a paper I have written/)).toBeChecked();

  await page.goto(`/app/d/${here.id}/write/${here.firstChapterId}`);
  await rail.getByTestId('rail-new-menu-button').click();
  await rail.getByRole('menuitem', { name: /Import from Word/ }).click();
  await expect(page).toHaveURL(/\/app\/new\?start=word/);
  await expect(page.getByTestId('new-word-start')).toBeVisible();
  // The Word button is first, so Enter in the title imports.
  await expect(page.locator('form [type="submit"]').first()).toHaveAttribute(
    'data-word-import',
    'true',
  );
});
