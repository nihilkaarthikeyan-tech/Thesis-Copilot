import { expect, test } from '@playwright/test';

/**
 * The sign-in form holds still while the page finishes loading (2026-10-09). The Google block
 * arrives with `/auth/methods`, after first paint; the form box was centred on its own height, so
 * the block's arrival moved the email field by half of it (y 437 → 493 in a 719×872 window) and a
 * click or typing aimed at the field missed. The answer is held back here so it always lands
 * after first paint, as it does on a slow connection, with Google on and off, and once as the
 * stack itself answers.
 */

const WIDTHS = [390, 768, 1280] as const;

for (const path of ['/sign-in', '/sign-up'] as const) {
  for (const google of [true, false, null] as const) {
    test(`${path}: the email field does not move as the page settles (Google ${google ?? 'as configured'})`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      if (google !== null) {
        await page.route('**/api/v1/auth/methods', async (route) => {
          await new Promise((r) => setTimeout(r, 800));
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ emailOtp: true, password: true, google }),
          });
        });
      }
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 872 });
        await page.goto(path, { waitUntil: 'commit' });
        const field = page.locator('#email');
        await field.waitFor({ state: 'visible', timeout: 30_000 });
        const first = await field.boundingBox();
        await page.waitForLoadState('networkidle');
        if (google === true) {
          await expect(page.getByTestId(/^google-sign-(in|up)$/)).toBeVisible();
        } else if (google === false) {
          await expect(page.getByTestId('google-block')).toHaveCount(0);
        }
        const settled = await field.boundingBox();
        expect(first, `${path} at ${width}: field at first paint`).not.toBeNull();
        expect(
          Math.abs((settled?.y ?? 0) - (first?.y ?? 0)),
          `${path} at ${width}: the field moved from y ${first?.y} to y ${settled?.y}`,
        ).toBeLessThan(1);
        expect(Math.abs((settled?.x ?? 0) - (first?.x ?? 0))).toBeLessThan(1);
        // And nothing wider than the window.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        expect(overflow, `${path} at ${width}: page scrolls sideways`).toBeLessThanOrEqual(0);
      }
    });
  }
}
