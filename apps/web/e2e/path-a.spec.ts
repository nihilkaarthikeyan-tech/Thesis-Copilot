import { expect, test } from '@playwright/test';
import { signInAs } from './_session.js';

/**
 * Path A — PRD FR-1.5, PHASES 6.1 and 6.3.
 *
 *   "Done when: E2E completes a 3-turn conversation and lands on an editable skeleton."
 *
 * From the chooser: pick "from a topic", answer the questions, see the related-work count, get
 * the skeleton in the same editable form Path B uses, edit it, continue to the editor.
 */

test('a topic becomes an editable proposal skeleton through a three-question conversation', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await signInAs(page, request);

  // The chooser (6.3): both paths, one line each. The list's header has one New menu since R32
  // (ADR-0127); "Upload a paper" opens the same chooser, which offers both.
  await page.goto('/app');
  await page.getByTestId('new-menu-button').click();
  await page.getByRole('menuitem', { name: /Upload a paper/ }).click();
  await expect(page.getByRole('heading', { name: 'Where does this thesis start?' })).toBeVisible();
  await expect(
    page.getByText('Upload it; the proposal, glossary and starting library'),
  ).toBeVisible();
  await expect(page.getByText('A short conversation — two or three questions')).toBeVisible();
  await page.getByLabel(/Start from a topic/).check();
  const title = `Drip irrigation uptake among smallholders ${Date.now()}`;
  await page.getByLabel('Working title').fill(title);
  await page.getByRole('button', { name: 'Continue' }).click();

  // The conversation, not a form (FR-1.5). The title is offered as the opening line.
  await expect(
    page.getByRole('heading', { name: 'Turn your topic into a thesis proposal' }),
  ).toBeVisible({
    timeout: 20_000,
  });
  const chat = page.getByTestId('path-a-chat');
  const input = chat.getByLabel('Your message');
  await expect(input).toHaveValue(title);
  await chat.getByRole('button', { name: 'Send' }).click();
  await expect(chat.locator('[data-role="assistant"]')).toHaveCount(1, { timeout: 20_000 });
  await expect(chat).toContainText('1 of 3 questions asked');
  // No skeleton before a clarification turn (FR-1.5 AC).
  await expect(page.getByLabel('Problem statement')).toHaveCount(0);
  await expect(page.getByTestId('gap-check')).toContainText('Appears after your first answer');

  await input.fill('Technology adoption, not policy');
  await input.press('Enter');
  await expect(chat.locator('[data-role="assistant"]')).toHaveCount(2, { timeout: 20_000 });
  // "N related works found; closest 5" (FR-1.5 AC), from the live index.
  await expect(page.getByTestId('gap-check')).toContainText(/\d[\d,]* related works? found/, {
    timeout: 20_000,
  });

  await input.fill('Two districts of Tamil Nadu');
  await input.press('Enter');
  await expect(chat.locator('[data-role="assistant"]')).toHaveCount(3, { timeout: 20_000 });
  await expect(chat).toContainText('3 of 3 questions asked');

  await input.fill('A survey I run myself');
  await input.press('Enter');

  // The skeleton lands in the same editable form as Path B (FR-1.4), nothing locked.
  const workingTitle = page.getByLabel('Working title');
  await expect(workingTitle).toHaveValue(new RegExp(title.slice(0, 30)), { timeout: 20_000 });
  await expect(chat).toContainText('skeleton ready below');
  await expect(chat.getByRole('button', { name: 'Send' })).toHaveCount(0);
  const objectives = page.getByLabel(/Objective/).first();
  await expect(objectives).toBeVisible();
  await workingTitle.fill('Barriers to drip irrigation uptake in two Tamil Nadu districts');
  await page
    .getByLabel('Problem statement')
    .fill('Cost and water rights, not awareness, appear to decide uptake.');

  await page.getByRole('button', { name: 'Continue to the editor' }).click();
  await expect(page).toHaveURL(/\/write\/[0-9a-f-]{36}$/, { timeout: 30_000 });

  // The edited values are what was saved (FR-1.4), and the conversation is still there.
  await page.goBack();
  await expect(page.getByLabel('Working title')).toHaveValue(
    'Barriers to drip irrigation uptake in two Tamil Nadu districts',
    { timeout: 20_000 },
  );
  await expect(chat.locator('[data-role="assistant"]')).toHaveCount(3);
});
