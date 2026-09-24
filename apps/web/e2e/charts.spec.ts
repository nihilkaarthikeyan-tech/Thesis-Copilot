import { expect, type Page, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Charts — ADR-0027. Drawn from the numbers the student types, inserted as a figure, kept
 * editable, and captioned in the export. Nothing here involves a model.
 */

type ImageNode = {
  type: string;
  attrs?: { key?: string; caption?: string | null; chart?: { title?: string } };
};

async function openChapter(page: Page, request: Parameters<typeof establishSession>[0]) {
  const session = await establishSession(request, freshEmail('charts'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Charts ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  return { doc, cookie };
}

async function savedImages(
  request: Parameters<typeof establishSession>[0],
  cookie: string,
  chapterId: string,
): Promise<ImageNode[]> {
  const chapter = (await (
    await request.get(`${API_URL}/api/v1/chapters/${chapterId}`, { headers: { cookie } })
  ).json()) as { content: { content: ImageNode[] } };
  return chapter.content.content.filter((n) => n.type === 'image');
}

test('a chart is drawn from typed numbers, inserted as a figure, and can be edited', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { doc, cookie } = await openChapter(page, request);
  await page.locator('.thesis-editor p').first().click();
  await page.keyboard.type('Uptake differed between the districts. ');

  await page.getByTestId('fmt-chart').click();
  const dialog = page.getByTestId('chart-dialog');
  await expect(dialog).toBeVisible();
  // Nothing to plot yet: the button waits for numbers.
  await expect(dialog.getByTestId('chart-insert')).toBeDisabled();

  await dialog.getByTestId('chart-title-input').fill('Uptake by district');
  await dialog.getByLabel('Series 1 name').fill('Households');
  await dialog.getByLabel('Category 1').fill('North');
  await dialog.getByLabel('Row 1, series 1').fill('12');
  await dialog.getByLabel('Category 2').fill('South');
  await dialog.getByLabel('Row 2, series 1').fill('8');
  await expect(dialog.getByTestId('chart-insert')).toBeEnabled();
  await dialog.getByTestId('chart-insert').click();
  await expect(dialog).toBeHidden();

  const img = page.locator('.thesis-editor img');
  await expect(img).toHaveCount(1, { timeout: 30_000 });
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });

  // The numbers travel with the figure, and the title is its caption.
  let images = await savedImages(request, cookie, doc.firstChapterId);
  expect(images).toHaveLength(1);
  expect(images[0]?.attrs?.chart?.title).toBe('Uptake by district');
  expect(images[0]?.attrs?.caption).toBe('Uptake by district');
  const firstKey = images[0]?.attrs?.key;
  expect(firstKey).toMatch(/^figures\//);

  // Selecting the chart offers to edit it; the change is redrawn and stored.
  await img.click();
  const chartButton = page.getByTestId('fmt-chart');
  await expect(chartButton).toHaveAccessibleName('Edit chart');
  await chartButton.click();
  await expect(dialog.getByTestId('chart-title-input')).toHaveValue('Uptake by district');
  await expect(dialog.getByLabel('Row 2, series 1')).toHaveValue('8');
  await dialog.getByTestId('chart-title-input').fill('Uptake by district, 2020');
  await dialog.getByTestId('chart-insert').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.thesis-editor img')).toHaveCount(1);
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });
  images = await savedImages(request, cookie, doc.firstChapterId);
  expect(images).toHaveLength(1);
  expect(images[0]?.attrs?.chart?.title).toBe('Uptake by district, 2020');
  expect(images[0]?.attrs?.key).not.toBe(firstKey);

  // In the submitted thesis it is a captioned figure like any other.
  const exported = await request.post(`${API_URL}/api/v1/documents/${doc.id}/export/thesis`, {
    headers: { cookie },
    data: { format: 'html' },
  });
  expect(exported.ok(), `export: ${exported.status()}`).toBe(true);
  const { url } = (await exported.json()) as { url: string };
  const html = await (await request.get(url)).text();
  expect(html).toContain('Figure 1.1: Uptake by district, 2020');
  expect(html).toContain('data:image/png;base64,');
});

test('a chart starts from the table the cursor is in, and can be a line with a legend', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { doc, cookie } = await openChapter(page, request);
  await page.locator('.thesis-editor p').first().click();
  await page.getByTestId('fmt-table').click();
  // A 3x3 table with a header row; Tab moves through the cells.
  for (const cell of ['District', '2019', '2020', 'North', '12', '15', 'South', '8', '9']) {
    await page.keyboard.type(cell);
    if (cell !== '9') await page.keyboard.press('Tab');
  }

  await page.getByTestId('fmt-chart').click();
  const dialog = page.getByTestId('chart-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Series 1 name')).toHaveValue('2019');
  await expect(dialog.getByLabel('Series 2 name')).toHaveValue('2020');
  await expect(dialog.getByLabel('Category 1')).toHaveValue('North');
  await expect(dialog.getByLabel('Category 2')).toHaveValue('South');
  await expect(dialog.getByLabel('Row 1, series 2')).toHaveValue('15');
  await expect(dialog.getByLabel('Row 2, series 1')).toHaveValue('8');
  await expect(dialog.getByTestId('chart-insert')).toBeEnabled();

  // Two series as lines: the legend and the line path, which the bar test does not draw.
  await dialog.getByLabel('Line chart').check();
  await dialog.getByTestId('chart-title-input').fill('Uptake by district and year');
  await dialog.getByTestId('chart-insert').click();
  await expect(dialog).toBeHidden();
  const img = page.locator('.thesis-editor img');
  await expect(img).toHaveCount(1, { timeout: 30_000 });
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });
  const images = await savedImages(request, cookie, doc.firstChapterId);
  expect(images[0]?.attrs?.chart?.title).toBe('Uptake by district and year');
});
