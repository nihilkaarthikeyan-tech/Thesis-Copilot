import { expect, test } from '@playwright/test';
import { openFormatMore } from './_editor.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Diagrams — ADR-0049. Drawn from the steps and links the student types, inserted as a figure,
 * kept editable, captioned in the export. No model and no outside service.
 */

type ImageNode = {
  type: string;
  attrs?: {
    key?: string;
    caption?: string | null;
    diagram?: { title?: string; source?: string; direction?: string };
  };
};

test('a diagram is drawn from typed steps, inserted as a figure, and can be edited', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('diagrams'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Diagrams ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.locator('.thesis-editor p').first().click();
  await page.keyboard.type('The process is shown below. ');

  const saved = async (): Promise<ImageNode[]> => {
    const chapter = (await (
      await request.get(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
        headers: { cookie },
      })
    ).json()) as { content: { content: ImageNode[] } };
    return chapter.content.content.filter((n) => n.type === 'image');
  };

  await openFormatMore(page);
  await page.getByTestId('fmt-diagram').click();
  const dialog = page.getByTestId('diagram-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('diagram-insert')).toBeDisabled();

  // A broken line says what is wrong and keeps Insert off.
  await dialog.getByTestId('diagram-source').fill('Raw fish ->');
  await expect(dialog.getByRole('alert')).toContainText('Line 1 has an arrow with nothing');
  await expect(dialog.getByTestId('diagram-insert')).toBeDisabled();

  const source =
    'Raw fish -> Brining -> Solar dryer\nSolar dryer -> Packaging : below 15% moisture';
  await dialog.getByTestId('diagram-source').fill(source);
  await dialog.getByTestId('diagram-title-input').fill('The drying process');
  await expect(dialog.getByTestId('diagram-insert')).toBeEnabled();
  // The preview has drawn something: not every pixel is white.
  await expect
    .poll(() =>
      dialog.getByTestId('diagram-preview').evaluate((c: HTMLCanvasElement) => {
        const d = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data ?? [];
        for (let i = 0; i < d.length; i += 4) if ((d[i] ?? 255) < 200) return true;
        return false;
      }),
    )
    .toBe(true);
  await dialog.getByTestId('diagram-insert').click();
  await expect(dialog).toBeHidden();

  const img = page.locator('.thesis-editor img');
  await expect(img).toHaveCount(1, { timeout: 30_000 });
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });

  let images = await saved();
  expect(images).toHaveLength(1);
  expect(images[0]?.attrs?.diagram?.source).toBe(source);
  expect(images[0]?.attrs?.caption).toBe('The drying process');
  const firstKey = images[0]?.attrs?.key;

  // Selecting it offers to edit it; the text comes back and the change is redrawn.
  await img.click();
  await openFormatMore(page);
  const button = page.getByTestId('fmt-diagram');
  await expect(button).toHaveAccessibleName('Edit diagram');
  await button.click();
  await expect(dialog.getByTestId('diagram-source')).toHaveValue(source);
  await dialog.getByLabel('Left to right').check();
  await dialog.getByTestId('diagram-insert').click();
  await expect(dialog).toBeHidden();
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });
  images = await saved();
  expect(images).toHaveLength(1);
  expect(images[0]?.attrs?.diagram?.direction).toBe('right');
  expect(images[0]?.attrs?.key).not.toBe(firstKey);

  // In the submitted thesis it is a captioned figure like any other.
  const exported = await request.post(`${API_URL}/api/v1/documents/${doc.id}/export/thesis`, {
    headers: { cookie },
    data: { format: 'html' },
  });
  expect(exported.ok(), `export: ${exported.status()}`).toBe(true);
  const { url } = (await exported.json()) as { url: string };
  const html = await (await request.get(url)).text();
  expect(html).toContain('Figure 1.1: The drying process');
});
