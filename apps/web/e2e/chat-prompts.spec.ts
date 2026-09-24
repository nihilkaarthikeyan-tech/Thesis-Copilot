import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Saved prompts in chat — ADR-0019. `/` brings back a question the student asks often.
 *
 * The whole loop through the real screen: save a question, find it again with `/` in a different
 * thesis (they belong to the student, not to one thesis), use it from the keyboard, see that what
 * reaches `/chat` is exactly its text, then edit and delete it.
 */

const QUESTION = 'What limitations do the authors admit about their sample?';

test('a question saved once comes back with / in any thesis', async ({ page, request }) => {
  test.setTimeout(180_000);
  const session = await establishSession(request, freshEmail('prompts'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);

  const newThesis = async (title: string) => {
    const created = await request.post(`${API_URL}/api/v1/documents`, {
      headers: { cookie },
      data: { title, entryPath: 'A_TOPIC' },
    });
    return (await created.json()) as { id: string; firstChapterId: string };
  };
  const openChat = async (doc: { id: string; firstChapterId: string }) => {
    await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
    await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('tab', { name: 'chat', exact: true }).click();
    return page.getByTestId('chat-panel');
  };

  // Saved in one thesis…
  let panel = await openChat(await newThesis(`Prompts A ${Date.now()}`));
  let box = panel.getByRole('textbox', { name: 'Ask about your library' });
  await box.fill('/');
  await expect(panel.getByTestId('chat-prompt-picker')).toContainText('No saved prompts yet');
  await box.fill(QUESTION);
  await panel.getByTestId('save-prompt').click();
  const name = panel.getByLabel('Save as');
  // A name to start from: the question's first words.
  await expect(name).toHaveValue('What limitations do the authors admit');
  await name.fill('Limitations');
  await name.press('Enter');
  await expect(panel.getByTestId('chat-box-hint')).toContainText('Saved “Limitations”');

  // …found in another.
  panel = await openChat(await newThesis(`Prompts B ${Date.now()}`));
  box = panel.getByRole('textbox', { name: 'Ask about your library' });
  await box.fill('/lim');
  const picker = panel.getByTestId('chat-prompt-picker');
  await expect(picker.getByTestId('chat-prompt-option')).toHaveCount(1);
  await expect(picker).toContainText('Limitations');

  // Enter picks it — the text goes into the box, not straight to the model.
  await box.press('Enter');
  await expect(box).toHaveValue(QUESTION);
  await expect(picker).toBeHidden();

  // What is sent is exactly the saved text.
  const sent = page.waitForRequest(
    (req) => req.url().endsWith('/api/v1/chat') && req.method() === 'POST',
  );
  await panel.getByRole('button', { name: 'Ask', exact: true }).click();
  const body = JSON.parse((await sent).postData() ?? '{}') as { message?: string };
  expect(body.message).toBe(QUESTION);
  await expect(panel.locator('[data-role=assistant]').last()).not.toBeEmpty({ timeout: 60_000 });

  // Edit: the text comes back into the box, and Update saves what is there now.
  await box.fill('/');
  await picker.getByRole('button', { name: 'Edit Limitations' }).click();
  await expect(box).toHaveValue(QUESTION);
  await box.fill('Which limitations do the authors admit, and which do they leave out?');
  await panel.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(panel.getByTestId('chat-box-hint')).toContainText('Updated “Limitations”');
  await box.fill('/');
  await expect(picker).toContainText('which do they leave out');

  // Escape closes the picker without touching the text.
  await box.press('Escape');
  await expect(picker).toBeHidden();
  await expect(box).toHaveValue('/');

  // Typing again opens it again — even the same `/` after clearing the box.
  await box.fill('');
  await box.fill('/');
  await expect(picker).toBeVisible();

  // Delete takes two clicks, and survives a reload.
  await picker.getByRole('button', { name: 'Delete Limitations' }).click();
  await picker.getByRole('button', { name: 'Confirm deleting Limitations' }).click();
  await expect(picker).toContainText('No saved prompts yet');
  await page.reload();
  panel = page.getByTestId('chat-panel');
  await page.getByRole('tab', { name: 'chat', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Ask about your library' }).fill('/');
  await expect(panel.getByTestId('chat-prompt-picker')).toContainText('No saved prompts yet');
});
