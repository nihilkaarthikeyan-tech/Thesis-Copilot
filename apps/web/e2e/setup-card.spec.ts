import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { openHeaderMenu } from './_editor.js';
import { measureLayout, settle } from './_layout.js';
import { signInAs } from './_session.js';

/**
 * Setting a thesis up inside the editor (ADR-0145): New opens the first chapter at once with the
 * "Set up this thesis" card above the toolbar. Its four rows (ADR-0151) — title with sources,
 * field and university; aim; chapters; first line — each fold to one line when done; Finish later
 * folds the card into the status line, whose Show and ⋯ → First steps bring it back. The plan
 * and the first sentence start at the title row's Next, not after the questions. Against the
 * mock stack.
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

/** Row 1, taken quickly: the questions open next (ADR-0151, no field row). */
async function nameIt(page: Page) {
  await page.getByTestId('setup-title-input').fill(TITLE);
  await page.getByTestId('setup-title-next').click();
  await expect(page.getByTestId('setup-row-aim')).toHaveAttribute('data-state', 'open');
}

test('the card takes a new thesis through its four rows, in the editor', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const card = await newThesis(page, request);
  await expect(page.getByTestId('setup-count')).toHaveText('1 of 4');
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
  // ADR-0151: the field (guessed from the title) and the university are a folded, optional line
  // of the same row, no longer a row of their own.
  await expect(page.getByTestId('setup-field-line')).toContainText('university not set');
  await page.getByTestId('setup-field-change').click();
  await page.getByTestId('setup-university').selectOption('anna_university_v1');
  await expect(page.getByTestId('setup-field-line')).toContainText('Anna University');
  await shot(page, '2-field');
  await page.getByTestId('setup-title-next').click();

  // Row 2: the start questions, while the plan and the first sentence are already on their way.
  await expect(page.getByTestId('setup-row-aim')).toHaveAttribute('data-state', 'open');
  await expect(page.getByTestId('setup-row-title')).toContainText(TITLE);
  await expect(page.getByTestId('setup-row-sources')).toContainText('IEEE');
  await expect(page.getByTestId('setup-row-field')).toContainText('Anna University');
  await expect(page.getByTestId('setup-count')).toHaveText('2 of 4');
  // The same question row as before, one at a time, until the answers make the proposal. A.6 allows
  // two to four model turns and never more than three questions: the mock always asks three, a
  // real model (2026-10-09) sometimes had enough after two. Either way the result must arrive.
  await expect(page.getByTestId('setup-row-aim')).toHaveAttribute('data-state', 'open');
  const answer = page.locator('#setup-aim-answer');
  const result = page.getByTestId('setup-aim-result');
  const answers = ['Household finance', 'Two districts', 'A survey I run myself'];
  for (const [i, text] of answers.entries()) {
    // The next question (the answer box open again), or the proposal: whichever came.
    await expect
      .poll(
        async () =>
          (await result.isVisible())
            ? 'result'
            : (await answer.count()) > 0 && (await answer.isEnabled())
              ? 'question'
              : 'wait',
        { timeout: 30_000 },
      )
      .not.toBe('wait');
    if (await result.isVisible()) {
      // Never before the student has answered at least once.
      expect(i).toBeGreaterThan(0);
      break;
    }
    await expect(page.getByTestId('setup-aim-question')).not.toHaveText(/Thinking/);
    if (i === 0) await shot(page, '3-aim');
    await answer.fill(text);
    await answer.press('Enter');
  }
  await expect(result).toBeVisible({ timeout: 30_000 });
  // The answers' working title becomes the thesis's title (FR-1.4). The mock's equals the typed
  // one; a real model's is often sharper, and the card must show it before Use, not after.
  const newTitle = page.getByTestId('setup-aim-title');
  const titleNow =
    (await newTitle.count()) > 0
      ? ((await newTitle.locator('span').textContent()) ?? '').trim()
      : TITLE;
  await page.getByTestId('setup-aim-use').click();

  // Row 3: the chapters arrive in place, in the chapter list and as headings on the page.
  await expect(page.getByTestId('setup-row-chapters')).toHaveAttribute('data-state', 'open');
  await expect(page.getByTestId('setup-row-aim')).toContainText('Household finance');
  await expect(page.getByTestId('setup-planned')).toBeVisible({ timeout: 90_000 });
  // The mock plan has chapters and no sections, so this is the chapter list, not headings.
  await expect(page.getByTestId('setup-planned')).toContainText(/\d+ chapters with sections/);
  await expect(page.getByTestId('status-line-text')).toContainText('next: keep your chapters');
  await shot(page, '4-chapters');
  await page.getByTestId('setup-keep').click();

  // Row 4: the first line. Writing a sentence finishes the card, which folds into the line.
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
  await expect(folded.getByTestId('setup-row-title')).toContainText(titleNow);
  await shot(page, '6-done');

  // On another visit the card stays folded.
  await page.reload();
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('status-line-text')).toContainText('set up');
});

test('the plan and the first sentence start at the title row, with the questions open', async ({
  page,
  request,
}) => {
  // ADR-0151, measured as clicks: before it, Start writing now → Next → Skip (field) → Skip
  // (questions) was four presses and three rows before the first sentence was asked for. Now it
  // is New → Next, two presses and one row; nothing after the title waits on the questions.
  test.setTimeout(180_000);
  await newThesis(page, request);
  await page.getByTestId('setup-title-input').fill(TITLE);
  const asked = page.waitForRequest((r) => r.url().includes('/assist/suggest'), {
    timeout: 30_000,
  });
  const planned = page.waitForRequest(
    (r) => r.url().includes('/outline/plan-from-title') && r.method() === 'POST',
    { timeout: 30_000 },
  );
  await page.getByTestId('setup-title-next').click();
  await planned;
  await asked;
  // Asked for with the questions still open, nothing else pressed.
  await expect(page.getByTestId('setup-card')).toHaveAttribute('data-step', 'aim');
  await expect(page.getByTestId('setup-row-aim')).toHaveAttribute('data-state', 'open');
  // The chapters arrive while the questions wait; Skip then goes straight to them.
  await page.getByTestId('setup-aim-skip').click();
  await expect(page.getByTestId('setup-planned')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('setup-count')).toHaveText('3 of 4');
});

test('Finish later folds the card into the line; Show and First steps bring it back', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await newThesis(page, request);
  await page.getByTestId('setup-finish-later').click();
  await expect(page.getByTestId('setup-card')).toBeHidden();
  await expect(page.getByTestId('status-line-text')).toContainText('set up 1 of 4');

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
  await nameIt(page);
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

test('a first question that does not arrive says so, and Try again asks it again', async ({
  page,
  request,
}) => {
  // Seen on real models (2026-10-09): OpenAI refused one call in six or so mid-stream, the turn
  // failed, and the row sat at "Thinking of the first question…" over a shut answer box for good.
  // The first turn is failed here at the network, the way the browser saw it then.
  test.setTimeout(180_000);
  await newThesis(page, request);
  let failed = false;
  await page.route('**/api/v1/documents/*/proposal', async (route) => {
    if (route.request().method() === 'POST' && !failed) {
      failed = true;
      await route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({ title: 'Something went wrong', status: 500 }),
      });
      return;
    }
    await route.continue();
  });
  await nameIt(page);
  await expect(page.getByTestId('setup-aim-question')).toHaveText(
    'The first question did not arrive.',
    { timeout: 30_000 },
  );
  await page.getByTestId('setup-aim-retry').click();
  await expect(page.locator('#setup-aim-answer')).toBeEnabled({ timeout: 60_000 });
  await expect(page.getByTestId('setup-aim-question')).not.toHaveText(/Thinking|did not arrive/);
  await expect(page.getByTestId('setup-aim-retry')).toHaveCount(0);
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
        // The whole heading, not just its top edge: 801 px down on an 800 px screen is not "in
        // view". Real A.6 questions are long; the mock's one-liner never tested this.
        if (box) expect(box.y + box.height).toBeLessThanOrEqual(800);
      };
      await noLayoutFaults(page);
      await headingInView();
      await page.getByTestId('setup-sources-change').click();
      await noLayoutFaults(page);
      await headingInView();
      await page.getByTestId('setup-sources-change').click();
      await page.getByTestId('setup-field-change').click();
      await noLayoutFaults(page);
      await headingInView();
      await page.getByTestId('setup-field-change').click();
      await shot(page, `${width}-title`);
      await nameIt(page);
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
