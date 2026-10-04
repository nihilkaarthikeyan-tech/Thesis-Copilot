import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/** An earlier answer in the proposal conversation can be changed (2026-10-04, Jenni study). */
test('an earlier answer is changed in place, and what came after it is asked again', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('edit-answer'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Rooftop solar uptake in Indian cities ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string };

  await page.goto(`/app/d/${doc.id}/proposal`);
  const chat = page.getByTestId('path-a-chat');
  const input = chat.getByLabel('Your message');
  await expect(input).not.toHaveValue('', { timeout: 30_000 });
  await chat.getByRole('button', { name: 'Send' }).click();
  await expect(chat.locator('[data-role="assistant"]')).toHaveCount(1, { timeout: 20_000 });
  await input.fill('Household adoption');
  await input.press('Enter');
  await expect(chat.locator('[data-role="assistant"]')).toHaveCount(2, { timeout: 20_000 });

  // The second answer bubble's Edit: change it, and the question after it is asked again.
  await chat.getByTestId('edit-answer').nth(1).click();
  await expect(chat.getByTestId('editing-answer')).toBeVisible();
  await expect(input).toHaveValue('Household adoption');
  await input.fill('Policy and subsidies');
  await input.press('Enter');
  await expect(chat.getByTestId('editing-answer')).toHaveCount(0, { timeout: 20_000 });
  const answers = chat.locator('[data-role="user"]');
  await expect(answers).toHaveCount(2);
  await expect(answers.nth(1)).toHaveText('Policy and subsidies');
  await expect(chat.locator('[data-role="assistant"]')).toHaveCount(2);
  await expect(chat).not.toContainText('Household adoption');
});
