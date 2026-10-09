import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { openHeaderMenu } from './_editor.js';
import { measureLayout, settle } from './_layout.js';
import { signInAs } from './_session.js';

/**
 * Setting a thesis up inside the editor (ADR-0145): New opens the first chapter at once with the
 * "Set up this thesis" card above the toolbar. Its five rows — title and sources, field, aim,
 * chapters, first line — each fold to one line when done; Finish later folds the card into the
 * status line, whose Show and ⋯ → First steps bring it back. Against the mock stack.
 *
 * `SETUP_SHOTS=1` saves screenshots to `<repo>/qa-shots/setup-*.png`.
 */

const SHOTS = process.env.SETUP_SHOTS ? join(process.cwd(), '..', '..', 'qa-shots') : null;
const TITLE = 'Barriers to rooftop solar adoption among rural households in Karnataka';

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `setup-${name}.png`) });
}

async function noLayoutFaults(page: Page) {
  await settle(page);
  const faults = await page.evaluate(measureLayout, true);
  expect(faults, JSON.stringify(faults, null, 2)).toEqual([]);
}

/** New ▾ → New thesis, from the list: the editor opens with the card at its first row. */
async function newThesis(page: Page, request: APIRequestContext) {
  await signInAs(page, request);
  await page.goto('/app');
  await page.getByTestId('new-menu-button').click();
  await page.getByTestId('new-menu-topic').click();
  await expect(page).toHaveURL(/\/app\/d\/[0-9a-f-]{36}\/write\/[0-9a-f-]{36}$/, {
    timeout: 30_000,
  });
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  const card = page.getByTestId('setup-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toHaveAttribute('data-step', 'title');
  return card;
}

/** Row 1 and row 2, taken quickly. */
async function nameAndSkipField(page: Page) {
  await page.getByTestId('setup-title-input').fill(TITLE);
  await page.getByTestId('setup-title-next').click();
  await expect(page.getByTestId('setup-row-field')).toHaveAttribute('data-state', 'open');
  await page.getByTestId('setup-field-skip').click();
  await expect(page.getByTestId('setup-row-aim')).toHaveAttribute('data-state', 'open');
}

test('the card takes a new thesis through its five rows, in the editor', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const card = await newThesis(page, request);
  await expect(page.getByTestId('setup-count')).toHaveText('1 of 5');
  await expect(page.getByTestId('status-line-text')).toContainText('next: name your thesis');
  // One guide at a time: the four-step guide and the proposal prompt wait.
  await expect(page.getByTestId('first-session-guide')).toHaveCount(0);
  await expect(page.getByTestId('add-proposal')).toHaveCount(0);
  await shot(page, '1-title');

  // Row 1: a title of a word or two cannot search; the sources fold open and shut.
  await page.getByTestId('setup-title-input').fill('Solar');
  await expect(page.getByTestId('setup-title-next')).toBeDisabled();
  await page.getByTestId('setup-title-input').fill(TITLE);
  await card.getByText('IEEE', { exact: true }).click();
  await page.getByTestId('setup-sources-change').click();
  await expect(page.getByTestId('setup-web-search')).toBeVisible();
  await page.getByTestId('setup-sources-change').click();
  await page.getByTestId('setup-title-next').click();

  // Row 2: the field is guessed from the title; both are optional.
  await expect(page.getByTestId('setup-row-field')).toHaveAttribute('data-state', 'open');
  await expect(page.getByTestId('setup-row-title')).toContainText(TITLE);
  await expect(page.getByTestId('setup-row-sources')).toContainText('IEEE');
  await expect(page.getByTestId('setup-count')).toHaveText('2 of 5');
  await page.getByTestId('setup-university').selectOption('anna_university_v1');
  await shot(page, '2-field');
  await page.getByTestId('setup-field-next').click();
  await expect(page.getByTestId('setup-row-field')).toContainText('Anna University');

  // Row 3: the start questions, one at a time; three answers make the proposal.
  await expect(page.getByTestId('setup-row-aim')).toHaveAttribute('data-state', 'open');
  const answer = page.locator('#setup-aim-answer');
  for (const text of ['Household finance', 'Two districts', 'A survey I run myself']) {
    await expect(answer).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByTestId('setup-aim-question')).not.toHaveText(/Thinking/);
    await answer.fill(text);
    await answer.press('Enter');
  }
  await shot(page, '3-aim');
  await expect(page.getByTestId('setup-aim-result')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('setup-aim-use').click();

  // Row 4: the chapters arrive in place, in the chapter list and as headings on the page.
  await expect(page.getByTestId('setup-row-chapters')).toHaveAttribute('data-state', 'open');
  await expect(page.getByTestId('setup-row-aim')).toContainText('Household finance');
  await expect(page.getByTestId('setup-planned')).toBeVisible({ timeout: 90_000 });
  // The mock plan has chapters and no sections, so this is the chapter list, not headings.
  await expect(page.getByTestId('setup-planned')).toContainText(/\d+ chapters with sections/);
  await expect(page.getByTestId('status-line-text')).toContainText('next: keep your chapters');
  await shot(page, '4-chapters');
  await page.getByTestId('setup-keep').click();

  // Row 5: the first line. Writing a sentence finishes the card, which folds into the line.
  await expect(page.getByTestId('setup-row-first')).toHaveAttribute('data-state', 'open');
  await expect(page.getByTestId('setup-row-chapters')).toContainText('planned');
  await shot(page, '5-first');
  // Whatever suggestion is on its way is put aside; the student writes their own.
  await page.keyboard.press('Escape');
  await page.keyboard.type('Rooftop solar has spread slowly among rural households.');
  await expect(page.getByTestId('setup-card')).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId('status-line-text')).toContainText('set up');

  // Its rows stay under Show.
  await page.getByTestId('status-line-toggle').click();
  const folded = page.getByTestId('setup-card');
  await expect(folded).toHaveAttribute('data-done', 'true');
  await expect(folded.getByTestId('setup-row-title')).toContainText(TITLE);
  await shot(page, '6-done');

  // On another visit the card stays folded.
  await page.reload();
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('status-line-text')).toContainText('set up');
});

test('Finish later folds the card into the line; Show and First steps bring it back', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await newThesis(page, request);
  await page.getByTestId('setup-finish-later').click();
  await expect(page.getByTestId('setup-card')).toBeHidden();
  await expect(page.getByTestId('status-line-text')).toContainText('set up 1 of 5');

  // Show: the card, inside the line, can be carried on there or put back on top.
  await page.getByTestId('status-line-toggle').click();
  await expect(page.getByTestId('setup-card')).toBeVisible();
  await page.getByTestId('setup-continue').click();
  await expect(page.getByTestId('setup-finish-later')).toBeVisible();
  await page.getByTestId('status-line-toggle').click();

  // Folded again, then ⋯ → First steps.
  await page.getByTestId('setup-finish-later').click();
  await expect(page.getByTestId('setup-finish-later')).toHaveCount(0);
  await openHeaderMenu(page);
  await page.getByTestId('open-first-steps').click();
  await expect(page.getByTestId('setup-finish-later')).toBeVisible({ timeout: 10_000 });

  // The state is the thesis's, not the tab's.
  await page.reload();
  await expect(page.getByTestId('setup-finish-later')).toBeVisible({ timeout: 30_000 });
});

test('skipping the questions plans from the title; Standard chapters replace the plan', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await newThesis(page, request);
  await nameAndSkipField(page);
  await page.getByTestId('setup-aim-skip').click();
  await expect(page.getByTestId('setup-row-aim')).toContainText('planned from the title');
  await expect(page.getByTestId('setup-planned')).toBeVisible({ timeout: 90_000 });
  await page.getByTestId('setup-standard').click();
  await expect(page.getByTestId('setup-row-chapters')).toContainText('standard thesis chapters', {
    timeout: 20_000,
  });
  await expect(page.locator('.thesis-editor h1')).toHaveText('Introduction');
  await expect(page.locator('.thesis-editor h2')).toHaveCount(0);
});

for (const width of [360, 430, 768, 1024, 1440]) {
  test.describe(`at ${width}`, () => {
    // 800 tall: a laptop. The card at its tallest must leave the chapter's heading on screen.
    test.use({ viewport: { width, height: 800 } });

    test('no layout faults at each row, and the first heading stays in view', async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000);
      await newThesis(page, request);
      const headingInView = async () => {
        const box = await page.locator('.thesis-editor h1').boundingBox();
        expect(box).not.toBeNull();
        if (box) expect(box.y).toBeLessThan(800);
      };
      await noLayoutFaults(page);
      await headingInView();
      await page.getByTestId('setup-sources-change').click();
      await noLayoutFaults(page);
      await headingInView();
      await page.getByTestId('setup-sources-change').click();
      await shot(page, `${width}-title`);
      await nameAndSkipField(page);
      await expect(page.getByTestId('setup-aim-question')).not.toHaveText(/Thinking/, {
        timeout: 30_000,
      });
      await noLayoutFaults(page);
      await headingInView();
      await shot(page, `${width}-aim`);
      await page.getByTestId('setup-aim-skip').click();
      await expect(page.getByTestId('setup-planned')).toBeVisible({ timeout: 90_000 });
      await noLayoutFaults(page);
      await headingInView();
      await shot(page, `${width}-chapters`);
    });
  });
}
