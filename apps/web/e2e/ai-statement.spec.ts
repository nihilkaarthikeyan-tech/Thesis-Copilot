import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { type LayoutFault, measureLayout, settle } from './_layout.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The AI use statement (ADR-0148): opens from the editor's ⋯ menu with sentences built from this
 * thesis's record (the accepted-AI share from the chapter's provenance marks), can be edited,
 * goes in as an ordinary last chapter by the student's press, is offered as an appendix in the
 * export dialog (off by default, whole thesis only), and fits the screen at five widths.
 *
 * `SHOTS=<dir>` also saves a screenshot of the dialog at each width.
 */

const SHOTS = process.env.SHOTS;

test('AI use statement: open, edit, insert as an appendix, export option, every width', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const session = await establishSession(request, freshEmail('ai-statement'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `AI statement ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  // The chapter as the editor saves it: seven words the student typed, four from an accepted
  // suggestion and three since edited. The counts the statement reports come from the save.
  const chapter = (await (
    await request.get(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, { headers: { cookie } })
  ).json()) as { version: number };
  const mark = (kind: string) => [{ type: 'provenance', attrs: { kind, actionId: null } }];
  await request.put(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
    headers: { cookie },
    data: {
      baseVersion: chapter.version,
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Introduction' }] },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Night-time heat keeps outdoor workers from recovering', marks: mark('HUMAN') },
              { type: 'text', text: ' across the hottest months', marks: mark('ASSIST') },
              { type: 'text', text: ' of each year.', marks: mark('HUMAN_EDITED') },
            ],
          },
        ],
      },
    },
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await settle(page);

  // From the ⋯ menu.
  await page.getByTestId('header-more').click();
  await page.getByTestId('open-ai-statement').click();
  const dialog = page.getByTestId('ai-statement-dialog');
  await expect(dialog).toBeVisible();
  const text = dialog.getByTestId('ai-statement-text');
  await expect(text).toHaveValue(/Thesis Copilot/, { timeout: 20_000 });
  const statement = await text.inputValue();
  // Fourteen words saved, seven of them from accepted AI text, three since edited.
  expect(statement).toContain('Of the 14 words in the thesis as it stands, 7 (50%) began as AI text');
  expect(statement).toContain('edited at least 3');
  expect(statement).toContain('No sources were added');
  // Nothing was recorded against a feature the student did not use.
  expect(statement).not.toContain('proofreading');
  expect(statement).not.toContain('deep research');
  expect(statement.toLowerCase()).not.toContain('detect');

  // The per-chapter table, and an edit of the student's own.
  await dialog.getByTestId('ai-statement-table').check();
  const preview = dialog.getByTestId('ai-statement-table-preview');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Introduction');
  await text.fill(`${statement}\n\nI confirm the above.`);

  // Insert as an appendix: an ordinary last chapter, opened in the editor.
  await dialog.getByTestId('ai-statement-insert').click();
  await page.waitForURL((url) => url.pathname.includes('/write/') && !url.pathname.endsWith(doc.firstChapterId), {
    timeout: 30_000,
  });
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.thesis-editor h1').first()).toHaveText('Statement on the use of AI tools', {
    timeout: 30_000,
  });
  await expect(page.locator('.thesis-editor')).toContainText('I confirm the above.');
  await expect(page.locator('.thesis-editor table')).toBeVisible();
  const chapters = (await (
    await request.get(`${API_URL}/api/v1/documents/${doc.id}`, { headers: { cookie } })
  ).json()) as { chapters: Array<{ title: string; order: number }> };
  expect(chapters.chapters.at(-1)?.title).toBe('Statement on the use of AI tools');

  // The export dialog offers it for the whole thesis only, off by default.
  await page.getByTestId('open-export').click();
  const exportDialog = page.getByTestId('export-dialog');
  await expect(exportDialog).toBeVisible();
  await expect(exportDialog.getByTestId('export-ai-statement')).toHaveCount(0);
  await exportDialog.getByTestId('export-scope-thesis').check();
  const option = exportDialog.getByTestId('export-ai-statement');
  await expect(option).toBeVisible();
  await expect(option).not.toBeChecked();
  await page.keyboard.press('Escape');

  // Five widths: the dialog inside the window, nothing sticking out or cut.
  const found: Array<{ where: string } & LayoutFault> = [];
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  for (const width of [1440, 1024, 768, 430, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
    await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
    await settle(page);
    await page.getByTestId('header-more').click();
    await page.getByTestId('open-ai-statement').click();
    const open = page.getByTestId('ai-statement-dialog');
    await expect(open.getByTestId('ai-statement-text')).toHaveValue(/Thesis Copilot/, {
      timeout: 20_000,
    });
    await open.getByTestId('ai-statement-table').check();
    await expect(open.getByTestId('ai-statement-table-preview')).toBeVisible();
    await settle(page);
    const box = await open.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= width, `${width} dialog inside`).toBe(true);
    for (const fault of await page.evaluate(measureLayout, false)) {
      found.push({ where: `${width} AI statement dialog`, ...fault });
    }
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `ai-statement-${width}.png`) });
    await page.keyboard.press('Escape');
  }
  expect(found, JSON.stringify(found, null, 2)).toEqual([]);
});
