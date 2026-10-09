import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The editor on a phone and a small tablet.
 *
 * Below 1024 px the tool panel was `hidden`, and below 768 px the chapter list was too, with
 * nothing in their place: a student on a phone lost sources, citations, chat, flags and review,
 * and could not move between chapters. The page was also 498 px wide on a 375 px screen, so it
 * scrolled sideways under the student's thumb.
 */

async function openEditor(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
) {
  const session = await establishSession(request, freshEmail('mobile'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Mobile ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('nothing scrolls sideways, and every panel is one tap away', async ({ page, request }) => {
    await openEditor(page, request);

    const widths = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);

    const bar = page.getByTestId('mobile-bar');
    await expect(bar).toBeVisible();
    const panel = page.getByTestId('tool-panel');
    await expect(panel).toBeHidden();

    // Each tool opens the panel on its own tab.
    await bar.getByTestId('mobile-chat').click();
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('chat-panel')).toBeVisible();

    await panel.getByRole('button', { name: 'Close' }).click();
    await expect(panel).toBeHidden();

    await bar.getByTestId('mobile-citations').click();
    await expect(page.getByTestId('citations-panel')).toBeVisible();
    // The backdrop closes it too, as a sheet on a phone should.
    await page.getByTestId('drawer-backdrop').click({ position: { x: 10, y: 400 } });
    await expect(panel).toBeHidden();

    // The chapter list, which had no way in at all.
    await bar.getByRole('button', { name: 'Chapters' }).click();
    const rail = page.getByTestId('chapter-rail');
    await expect(rail).toBeVisible();
    await expect(rail.getByRole('link', { name: /Chapter 1/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(rail).toBeHidden();
  });

  // ADR-0137: at every width now; the header is Saved, Share, Export and ⋯.
  test('the header actions that do not fit are under More', async ({ page, request }) => {
    await openEditor(page, request);
    await expect(
      page.getByRole('button', { name: 'How suggestions work', exact: true }),
    ).toBeHidden();
    await page.getByTestId('header-more').click();
    await page.getByRole('button', { name: 'How suggestions work', exact: true }).click();
    await expect(page.getByTestId('how-suggestions-work')).toBeVisible();
  });
});

// QA 2026-10-09: at 390 px the bar was 407 px of buttons and its last tab read "Commen".
for (const width of [360, 375, 390, 414, 430]) {
  test.describe(`the bottom bar at ${width} px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('fits the screen with every label whole', async ({ page, request }) => {
      await openEditor(page, request);
      const bar = page.getByTestId('mobile-bar');
      await expect(bar).toBeVisible();
      const fit = await bar.evaluate((nav) => {
        const navBox = nav.getBoundingClientRect();
        return {
          overflow: nav.scrollWidth - nav.clientWidth,
          right: navBox.right,
          buttons: [...nav.querySelectorAll('button')].map((b) => {
            const box = b.getBoundingClientRect();
            return {
              label: b.textContent || b.getAttribute('aria-label'),
              clipped: b.scrollWidth - b.clientWidth,
              outside: box.right - navBox.right,
            };
          }),
        };
      });
      expect(fit.overflow).toBeLessThanOrEqual(0);
      expect(fit.right).toBeLessThanOrEqual(width);
      for (const button of fit.buttons) {
        expect(button.clipped, button.label ?? '').toBeLessThanOrEqual(0);
        expect(button.outside, button.label ?? '').toBeLessThanOrEqual(0);
      }
      await expect(bar.getByTestId('mobile-review')).toHaveText(/comments/i);
    });
  });
}

test.describe('on a small tablet', () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test('the chapter list sits beside the text and the tools are in the bar', async ({
    page,
    request,
  }) => {
    await openEditor(page, request);
    await expect(page.getByTestId('chapter-rail')).toBeVisible();
    // Between 768 and 1024 the rail fits and the tool panel does not.
    await expect(
      page.getByTestId('mobile-bar').getByRole('button', { name: 'Chapters' }),
    ).toBeHidden();
    await page.getByTestId('mobile-flags').click();
    await expect(page.getByTestId('tool-panel')).toBeVisible();
  });
});

test.describe('on a laptop', () => {
  test.use({ viewport: { width: 1366, height: 800 } });

  test('nothing changed: both sides inline, no bar', async ({ page, request }) => {
    await openEditor(page, request);
    await expect(page.getByTestId('chapter-rail')).toBeVisible();
    await expect(page.getByTestId('tool-panel')).toBeVisible();
    await expect(page.getByTestId('mobile-bar')).toBeHidden();
  });
});
