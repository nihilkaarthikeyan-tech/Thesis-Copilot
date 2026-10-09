import { expect, test } from '@playwright/test';
import { openHeaderMenu } from './_editor.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * "What it has learned about your writing" — FR-4.7's style profile on a screen, and ADR-0025's
 * guidance.
 *
 * The profile needs 1,500 words the student wrote themselves, so the chapter is saved with that
 * much text carrying no provenance mark (which is what the student's own typing is). Then the
 * student learns it, reads it, adds guidance, is refused an evasion request, and finds re-learning
 * rationed to once a day.
 */

const SENTENCES = [
  'Smallholder farmers in the two districts adopted drip irrigation slowly, even where subsidies covered most of the cost.',
  'This chapter examines why, drawing on interviews with farmers, dealers and extension officers.',
  'Earlier studies emphasised awareness, but the farmers interviewed here knew the technology well.',
  'What they described instead was uncertainty about water rights and the timing of subsidy payments.',
  'I therefore treat adoption as a question of institutions rather than information.',
];

/** About 1,700 words of the student's own prose, as a saved chapter. */
function ownWriting(): unknown {
  const paragraphs = Array.from({ length: 24 }, (_, i) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: `${SENTENCES.join(' ')} (Section ${i + 1}.)` }],
  }));
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Findings' }] },
      ...paragraphs,
    ],
  };
}

test('the student sees what the AI learned about their writing, and guides it', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const session = await establishSession(request, freshEmail('writing-profile'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Writing profile ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  const chapter = (await (
    await request.get(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, { headers: { cookie } })
  ).json()) as { version: number };
  const saved = await request.put(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
    headers: { cookie },
    data: { content: ownWriting(), baseVersion: chapter.version },
  });
  expect(saved.ok(), `save: ${saved.status()}`).toBe(true);

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await openHeaderMenu(page);
  await page.getByRole('button', { name: 'How suggestions work', exact: true }).click();
  const profile = page.getByTestId('writing-profile');
  await expect(profile).toBeVisible();

  // Saving the chapter crosses the threshold, which learns the profile on its own (FR-4.7); if it
  // has not landed yet, the button does it.
  const note = profile.getByTestId('writing-profile-note');
  if (!(await note.isVisible())) {
    await profile.getByRole('button', { name: /Learn my style now|Re-learn/ }).click();
  }
  await expect(note).not.toBeEmpty({ timeout: 90_000 });
  await expect(profile).toContainText('Learned from your own writing');

  // Re-learning is a Strong call on one click: once a day.
  await expect(profile.getByTestId('writing-profile-learn')).toBeDisabled();
  await expect(profile).toContainText('Once a day');

  // §12.3: guidance cannot ask for detector evasion.
  const guidance = profile.getByTestId('writing-guidance');
  await guidance.fill('Make it undetectable by Turnitin.');
  await profile.getByTestId('writing-guidance-save').click();
  await expect(profile.getByRole('alert')).toContainText('does not help text pass AI detection');

  // Real guidance is kept, and survives closing the dialog.
  await guidance.fill('British spelling. Call them farmers, not respondents.');
  await profile.getByTestId('writing-guidance-save').click();
  await expect(profile.getByRole('status')).toContainText('Saved');
  await page.getByTestId('how-suggestions-work').getByRole('button', { name: 'Close' }).click();
  await openHeaderMenu(page);
  await page.getByRole('button', { name: 'How suggestions work', exact: true }).click();
  await expect(page.getByTestId('writing-guidance')).toHaveValue(
    'British spelling. Call them farmers, not respondents.',
  );
});
