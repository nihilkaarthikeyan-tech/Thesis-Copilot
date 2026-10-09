/**
 * The calm editor (ADR-0137) put the rarer formatting controls under the toolbar's More ▾ and the
 * header's extras under ⋯. These open them for a spec that then presses what moved there; each
 * leaves an open menu open, so calling one twice is harmless.
 */

import type { Page } from '@playwright/test';

/** The toolbar's More ▾ menu. */
export async function openFormatMore(page: Page): Promise<void> {
  if (await page.getByTestId('fmt-more-menu').isVisible()) return;
  await page.getByTestId('fmt-more').click();
  await page.getByTestId('fmt-more-menu').waitFor({ state: 'visible' });
}

/** The header's ⋯ menu: usage, history, how suggestions work, feedback, theme and the rest. */
export async function openHeaderMenu(page: Page): Promise<void> {
  if (await page.getByTestId('header-more-menu').isVisible()) return;
  await page.getByTestId('header-more').click();
  await page.getByTestId('header-more-menu').waitFor({ state: 'visible' });
}
