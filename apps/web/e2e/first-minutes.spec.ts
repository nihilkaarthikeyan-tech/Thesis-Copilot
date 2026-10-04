/**
 * A new student's first minutes, after the Jenni journey study (docs/JENNI-STUDENT-JOURNEY.md
 * steps 0–3, docs/research/coverage-map.md rows 3 and 4): the topic box coaches the first message,
 * the start asks for a citation style, and a signed-in visitor to the home page is offered their
 * theses rather than a sign-up.
 */

import { expect, test } from '@playwright/test';
import { API_URL, signInAs } from './_session.js';

test('the first message of the topic path has a strength meter that reacts as the student types', async ({
  page,
  request,
}) => {
  await signInAs(page, request);
  await page.goto('/app/new');
  await page.getByLabel(/Start from a topic/).check();
  await page.getByLabel('Working title').fill('Mangrove soil carbon');
  await page.getByRole('button', { name: 'Continue' }).click();

  const chat = page.getByTestId('path-a-chat');
  const input = chat.getByLabel('Your message');
  await expect(input).toHaveValue('Mangrove soil carbon', { timeout: 20_000 });
  const meter = chat.getByTestId('topic-meter');
  await expect(meter.getByTestId('topic-strength')).toHaveText('Weak topic');
  await expect(meter.getByTestId('topic-hints')).toContainText(
    'Add where or who: a place, population or dataset',
  );

  // Emptied, the box shows an example topic to follow.
  await input.fill('');
  await expect(meter.getByTestId('topic-strength')).toHaveText('Describe your topic');
  await expect(meter.getByTestId('topic-example')).toContainText('For example:');
  await expect(input).toHaveAttribute('placeholder', /^e\.g\. /);

  await input.fill('Effect of stand age on soil organic carbon in Pichavaram mangroves');
  await expect(meter.getByTestId('topic-strength')).toHaveText('Fair topic');
  await expect(meter.getByTestId('topic-hints')).toHaveText(
    'Add how: a method such as a survey, experiment, model or case study',
  );

  await input.fill(
    'Comparing soil organic carbon in restored and natural mangroves at Pichavaram, Tamil Nadu, using core sampling',
  );
  await expect(meter.getByTestId('topic-strength')).toHaveText('Strong topic');
  await expect(meter.getByTestId('topic-hints')).toHaveCount(0);

  // Sending is never blocked by the meter, and once sent the meter has done its job.
  await chat.getByRole('button', { name: 'Send' }).click();
  await expect(chat.locator('[data-role="assistant"]')).toHaveCount(1, { timeout: 20_000 });
  await expect(chat.getByTestId('topic-meter')).toHaveCount(0);
});

test('the citation style chosen when a thesis is created is the style the thesis uses', async ({
  page,
  request,
}) => {
  const s = await signInAs(page, request);
  const cookie = `${s.cookieName}=${s.cookieValue}`;
  await page.goto('/app');
  const styles = page.getByTestId('starting-style');
  await expect(styles).toBeVisible({ timeout: 20_000 });
  // The five most common first, then Other.
  for (const name of ['APA 7', 'Harvard', 'IEEE', 'Vancouver', 'Chicago author-date', 'Other…']) {
    await expect(styles.getByText(name, { exact: true })).toBeVisible();
  }
  await styles.getByText('Other…', { exact: true }).click();
  await expect(styles).toContainText('Citations tab');
  await styles.getByText('IEEE', { exact: true }).click();

  await page.getByLabel('Working title').fill(`Style at the start ${Date.now()}`);
  await page.getByRole('button', { name: 'Create thesis' }).click();
  await expect(page).toHaveURL(/\/app\/d\/[0-9a-f-]{36}\/proposal$/, { timeout: 20_000 });
  const documentId = /\/app\/d\/([0-9a-f-]{36})\//.exec(page.url())?.[1] ?? '';
  const rendered = (await (
    await request.get(`${API_URL}/api/v1/documents/${documentId}/citations`, {
      headers: { cookie },
    })
  ).json()) as { style: string };
  expect(rendered.style).toBe('ieee');

  // Skipped, the thesis keeps the default as before.
  await page.goto('/app/new');
  await page.getByLabel(/Start from a topic/).check();
  await page.getByLabel('Working title').fill(`Style skipped ${Date.now()}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/app\/d\/[0-9a-f-]{36}\/proposal$/, { timeout: 20_000 });
  const skippedId = /\/app\/d\/([0-9a-f-]{36})\//.exec(page.url())?.[1] ?? '';
  const skipped = (await (
    await request.get(`${API_URL}/api/v1/documents/${skippedId}/citations`, {
      headers: { cookie },
    })
  ).json()) as { style: string };
  expect(skipped.style).toBe('apa');
});

test('a signed-in visitor to the home page is offered their theses, not a sign-up', async ({
  page,
  request,
}) => {
  await signInAs(page, request);
  await page.goto('/');
  const header = page.locator('header.mk-nav');
  const go = header.getByRole('link', { name: 'Go to your theses' });
  await expect(go).toBeVisible({ timeout: 20_000 });
  await expect(header.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  await expect(header.getByRole('link', { name: 'Start writing free' })).toHaveCount(0);
  await go.click();
  await expect(page).toHaveURL(/\/app$/);
});

test('the home page header stays on one line at about 800px wide', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto('/');
  const header = page.locator('header.mk-nav');
  // Signed out: the sales page as before.
  await expect(header.getByRole('link', { name: 'Start writing free' })).toBeVisible();
  const oneLine = async (name: string) => {
    const box = await header.getByRole('link', { name, exact: true }).boundingBox();
    expect(box, name).not.toBeNull();
    // One line of 15–17px text, or the 40px button; two lines would be well over this.
    expect(box?.height ?? 0, name).toBeLessThan(44);
  };
  await oneLine('Thesis Copilot');
  await oneLine('Sign in');
  await oneLine('How it works');
  await oneLine('Start writing free');
  // The least needed links step aside at this width rather than squeeze the rest.
  await expect(header.getByRole('link', { name: 'For guides' })).toBeHidden();
  await expect(header.getByRole('link', { name: 'Questions' })).toBeHidden();
});
