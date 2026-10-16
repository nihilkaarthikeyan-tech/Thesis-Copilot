import { expect, test } from '@playwright/test';
import { API_URL, signInAs } from './_session.js';

/**
 * ADR-0155 item 8 (the Word test, 2026-10-16): "Draft a section" started at once without saying
 * what it would draft. Now it shows the section and its note first, the note can be changed (and
 * is kept as the section's note), and one more click drafts. Ctrl+Shift+D opens the same confirm;
 * Ctrl+Enter drafts from it; Esc closes it. Against the mock stack.
 */

const NOTE = 'Upfront cost of panels and inverters for households that earn from farming.';

test('Draft a section says what it will draft, with the note to change, before it starts', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await signInAs(page, request);
  const created = await page.request.post(`${API_URL}/api/v1/documents`, {
    data: { title: `Rooftop solar in Karnataka ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  expect(created.ok()).toBe(true);
  const { id, firstChapterId } = (await created.json()) as { id: string; firstChapterId: string };
  // A plan with a section the chapter will have a heading for.
  const outline = await page.request.put(`${API_URL}/api/v1/documents/${id}/memory/outline`, {
    data: {
      outline: [
        {
          id: 'ch-1',
          title: 'Introduction',
          scopeNote: 'Why rooftop solar stalls in rural Karnataka.',
          children: [{ id: 'ch-1-cost', title: 'Financial constraints', scopeNote: 'Cost.' }],
        },
      ],
    },
  });
  expect(outline.ok(), await outline.text()).toBe(true);

  await page.goto(`/app/d/${id}/write/${firstChapterId}`);
  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.locator('p').first().click();
  await page.keyboard.type('Financial constraints');
  await page.getByRole('combobox', { name: 'Text' }).selectOption('Heading');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Households cite the price of panels first.');

  // The button opens the confirm; nothing is drafted yet.
  await page.getByTestId('draft-section-button').click();
  const confirm = page.getByTestId('draft-confirm');
  await expect(confirm).toBeVisible();
  await expect(page.getByTestId('draft-confirm-section')).toHaveText('Financial constraints');
  const note = page.getByTestId('draft-confirm-note');
  await expect(note).toHaveValue('Cost.');
  await expect(page.getByTestId('draft-status')).toHaveCount(0);

  // Esc closes it without drafting.
  await note.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(page.getByTestId('draft-status')).toHaveCount(0);

  // Ctrl+Shift+D opens it too; the changed note is kept, and Draft starts the draft.
  await editor.locator('p').last().click();
  await page.keyboard.press('Control+Shift+D');
  await expect(confirm).toBeVisible();
  await expect(note).toBeFocused();
  await note.fill(NOTE);
  await page.getByTestId('draft-confirm-go').click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByTestId('draft-status')).toBeVisible({ timeout: 30_000 });
  const saved = (await (
    await page.request.get(`${API_URL}/api/v1/documents/${id}/outline`)
  ).json()) as { outline: Array<{ children: Array<{ title: string; scopeNote: string }> }> };
  expect(
    saved.outline[0]?.children.find((c) => c.title === 'Financial constraints')?.scopeNote,
  ).toBe(NOTE);
});
