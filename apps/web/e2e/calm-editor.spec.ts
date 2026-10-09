import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import { measureLayout, settle } from './_layout.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The calm editor (ADR-0137, approved by the owner on 2026-10-09): the tool panel opens on Chat
 * with the six tools as a rail on its right edge; one status line above the text in place of three
 * boxes; a one-row toolbar with More ▾; a header of Saved, Share, Export and ⋯. A rearrangement
 * only: every control that moved is checked to be where it went, and to work there.
 *
 * `CALM_SHOTS=1` also saves screenshots to `<repo>/qa-shots/calm-*.png`.
 */

const SHOTS = process.env.CALM_SHOTS ? join(process.cwd(), '..', '..', 'qa-shots') : null;

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `calm-${name}.png`) });
}

async function openEditor(page: Page, request: APIRequestContext) {
  const session = await establishSession(request, freshEmail('calm'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Calm editor ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  return doc;
}

/** The box lies wholly inside the window. */
async function insideWindow(page: Page, box: Locator) {
  const b = await box.boundingBox();
  const view = page.viewportSize();
  expect(b).not.toBeNull();
  if (!b || !view) return;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(view.width);
  expect(b.y + b.height).toBeLessThanOrEqual(view.height);
}

async function noLayoutFaults(page: Page) {
  await settle(page);
  const faults = await page.evaluate(measureLayout, true);
  expect(faults, JSON.stringify(faults, null, 2)).toEqual([]);
}

test.describe('at 1280', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the panel opens on Chat, and every rail item opens its tool', async ({ page, request }) => {
    await openEditor(page, request);
    const panel = page.getByTestId('tool-panel');
    await expect(panel.getByTestId('tool-panel-title')).toHaveText('chat');
    await expect(page.getByRole('tab', { name: 'chat', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('chat-panel')).toBeVisible();
    // Chat's own controls are all still there (their placement inside the chat is item 5).
    await expect(page.getByTestId('chat-new')).toBeVisible();
    await expect(page.getByTestId('chat-scope-library')).toBeVisible();
    await expect(page.getByTestId('chat-deep-toggle')).toBeVisible();
    await expect(page.getByTestId('chat-attach')).toBeVisible();
    await shot(page, '1280');

    const tools: Array<[string, string]> = [
      ['sources', 'source-settings'],
      ['papers', 'find-papers'],
      ['citations', 'citations-panel'],
      ['check', 'flags-panel'],
      ['comments', 'review-panel'],
      ['chat', 'chat-panel'],
    ];
    for (const [name, testId] of tools) {
      const tab = page.getByRole('tab', { name, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(panel.getByTestId('tool-panel-title')).toHaveText(name);
      await expect(page.getByTestId(testId).first()).toBeVisible();
    }

    // The last tool chosen is the one the panel opens on next time, in this thesis.
    await page.getByRole('tab', { name: 'citations', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('tab', { name: 'citations', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('More and ⋯ hold what moved, inside the window; the status line opens', async ({
    page,
    request,
  }) => {
    await openEditor(page, request);

    // The toolbar is one row.
    const bar = page.getByTestId('format-toolbar');
    const barBox = await bar.boundingBox();
    expect(barBox?.height ?? 99).toBeLessThan(48);
    for (const name of ['Bold (Ctrl+B)', 'Italic (Ctrl+I)', 'Underline (Ctrl+U)', 'Add link']) {
      await expect(bar.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('fmt-cite')).toBeVisible();
    await expect(page.getByTestId('fmt-table')).toBeVisible();
    await expect(page.getByTestId('fmt-math')).toBeVisible();
    await expect(page.getByTestId('fmt-footnote')).toHaveCount(0);

    await page.getByTestId('fmt-more').click();
    const more = page.getByTestId('fmt-more-menu');
    await expect(more).toBeVisible();
    for (const id of [
      'fmt-footnote',
      'fmt-image',
      'fmt-chart',
      'fmt-diagram',
      'fmt-text-color',
      'fmt-highlight',
    ]) {
      await expect(more.getByTestId(id)).toBeVisible();
    }
    for (const name of [
      'Strikethrough',
      'Superscript',
      'Subscript',
      'Inline code',
      'Code block',
      'Block quote',
      'Display equation',
    ]) {
      await expect(more.getByRole('button', { name })).toBeVisible();
    }
    await insideWindow(page, more);
    await shot(page, '1280-more');
    // A toggle keeps the menu open; Escape closes it.
    await more.getByRole('button', { name: 'Strikethrough' }).click();
    await expect(more).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(more).toBeHidden();

    // Cite opens the library picker at the caret, as @ does.
    await page.locator('.thesis-editor p').first().click();
    await page.getByTestId('fmt-cite').click();
    await expect(page.locator('.thesis-editor')).toContainText('@');

    // ⋯ holds usage, history, how suggestions work, feedback and the theme.
    await page.getByTestId('header-more').click();
    const menu = page.getByTestId('header-more-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId('usage-meter')).toContainText('Assist');
    await expect(menu.getByTestId('open-history')).toBeVisible();
    await expect(menu.getByRole('button', { name: 'How suggestions work' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Feedback' })).toBeVisible();
    await expect(menu.getByRole('button', { name: /Colour theme/ })).toBeVisible();
    await expect(menu.getByTestId('open-first-steps')).toBeVisible();
    await insideWindow(page, menu);
    await shot(page, '1280-menu');
    await menu.getByTestId('open-history').click();
    await expect(menu).toBeHidden();
    await page.keyboard.press('Escape');

    // The header keeps Share and Export.
    await expect(page.getByTestId('share-button')).toBeVisible();
    await expect(page.getByTestId('open-export')).toBeVisible();

    // One status line; Show opens the same parts as before.
    const line = page.getByTestId('status-line');
    await expect(line).toBeVisible();
    const details = page.getByTestId('status-line-details');
    await expect(details).toBeHidden();
    await line.getByTestId('status-line-toggle').click();
    await expect(line.getByTestId('status-line-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(details).toBeVisible();
    await expect(details.getByTestId('first-session-guide')).toBeVisible();
    await shot(page, '1280-status');
    await line.getByTestId('status-line-toggle').click();
    await expect(details).toBeHidden();

    await noLayoutFaults(page);
  });
});

test.describe('at 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('chat comes first on the bottom bar, the menus stay inside, no layout faults', async ({
    page,
    request,
  }) => {
    await openEditor(page, request);
    await noLayoutFaults(page);
    await shot(page, '390');

    const bar = page.getByTestId('mobile-bar');
    const first = bar.locator('button').nth(1);
    await expect(first).toHaveAttribute('data-testid', 'mobile-chat');
    await first.click();
    await expect(page.getByTestId('chat-panel')).toBeVisible();
    await expect(page.getByTestId('tool-panel-title')).toHaveText('chat');
    await shot(page, '390-chat');
    await page.getByTestId('drawer-backdrop').click({ position: { x: 10, y: 10 } });

    await page.getByTestId('fmt-more').click();
    const more = page.getByTestId('fmt-more-menu');
    await expect(more).toBeVisible();
    await expect(more.getByRole('button', { name: 'Bulleted list' })).toBeVisible();
    await insideWindow(page, more);
    await shot(page, '390-more');
    await page.keyboard.press('Escape');

    await page.getByTestId('header-more').click();
    const menu = page.getByTestId('header-more-menu');
    await expect(menu).toBeVisible();
    await insideWindow(page, menu);
    await shot(page, '390-menu');
    await page.keyboard.press('Escape');

    await page.getByTestId('status-line-toggle').click();
    await expect(page.getByTestId('status-line-details')).toBeVisible();
    await noLayoutFaults(page);
  });
});
