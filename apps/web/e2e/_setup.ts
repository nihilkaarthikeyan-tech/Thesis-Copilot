/**
 * ADR-0145: a new thesis is set up in the editor's "Set up this thesis" card. The quick way
 * through it for a spec that is about something after setup: name it (unless the title came with
 * it), skip the field, skip the questions (chapters planned from the title), keep the chapters.
 */

import { expect, type Page } from '@playwright/test';

export async function setUpQuickly(page: Page, title?: string): Promise<void> {
  const card = page.getByTestId('setup-card');
  await expect(card).toBeVisible({ timeout: 30_000 });
  if (title) await page.getByTestId('setup-title-input').fill(title);
  await page.getByTestId('setup-title-next').click();
  await page.getByTestId('setup-field-skip').click();
  await page.getByTestId('setup-aim-skip').click();
  await expect(page.getByTestId('setup-keep')).toBeVisible({ timeout: 90_000 });
  await page.getByTestId('setup-keep').click();
  await expect(page.getByTestId('setup-row-first')).toHaveAttribute('data-state', 'open');
}

/** Row 5: any suggestion on screen put aside, then the student's own first sentence. */
export async function writeFirstLine(page: Page, text: string): Promise<void> {
  await page.keyboard.press('Escape');
  await page.keyboard.type(text);
  await expect(page.getByTestId('setup-finish-later')).toHaveCount(0, { timeout: 20_000 });
}
