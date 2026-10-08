import { expect, test } from '@playwright/test';
import { Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx';
import { type LayoutFault, measureLayout } from './_layout.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/** A 1×1 transparent PNG, the one picture the file carries. */
const PIXEL = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA63F8FFFF3F0005FE02FEA7D605A40000000049454E44AE426082',
  'hex',
);

/** Two chapters, a picture and a citation typed as text — built here, nothing binary committed. */
function wordFile(): Promise<Buffer> {
  return Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: 'Introduction', heading: HeadingLevel.HEADING_1 }),
            new Paragraph({
              children: [
                new TextRun('Groundwater in the district is falling every year (Kumar, 2021).'),
              ],
            }),
            new Paragraph({
              children: [
                new ImageRun({ type: 'png', data: PIXEL, transformation: { width: 8, height: 8 } }),
              ],
            }),
            new Paragraph({ text: 'Methods', heading: HeadingLevel.HEADING_1 }),
            new Paragraph('We surveyed forty villages across three blocks.'),
          ],
        },
      ],
    }),
  );
}

/** "Import from Word" (2026-10-04, from the Jenni study). */
test('a student imports a Word document as chapters and opens the first one', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('word-import'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Word import ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('word-import-open').click();
  await page.getByTestId('word-import-file').setInputFiles({
    name: 'my-thesis.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: await wordFile(),
  });

  const chapters = page.getByTestId('word-import-chapters');
  await expect(chapters).toContainText('Introduction');
  await expect(chapters).toContainText('Methods');
  await expect(page.getByTestId('word-import')).toContainText('1 image will not come across');
  // The thesis is empty, so replacing it is offered; adding is the default.
  await expect(page.getByLabel('Add as new chapters after the existing ones')).toBeChecked();

  // The preview says it before anything is written.
  await expect(page.getByTestId('word-import-citations')).toContainText(
    'The file has no references section',
  );
  await page.getByRole('button', { name: 'Import 2 chapters' }).click();
  const summary = page.getByTestId('word-import-summary');
  await expect(summary).toContainText('Added 2 chapters');
  await expect(summary).toContainText('1 image was not imported — insert it as a figure');
  // R34 (ADR-0113): the file has no references section, and the summary says so — why the
  // citation stayed text, not only that it did.
  const notice = summary.getByTestId('word-import-citations');
  await expect(notice).toContainText('1 citation not linked');
  await expect(notice).toContainText('The file has no references section');
  await expect(notice).toContainText('It stays as text.');

  await page.getByRole('button', { name: 'Open “Introduction”' }).click();
  await expect(page.locator('.thesis-editor')).toContainText('Groundwater in the district', {
    timeout: 30_000,
  });
  const rail = page.getByTestId('chapter-rail');
  await expect(rail).toContainText('Introduction');
  await expect(rail).toContainText('Methods');
});

test('a file that is not a .docx is refused before upload with a plain reason', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('word-import-bad'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Word import bad ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  // Arriving with `?import=word` (the new-thesis button) opens the dialog by itself.
  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}?import=word`);
  await expect(page.getByTestId('word-import-file')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('word-import-file').setInputFiles({
    name: 'thesis.doc',
    mimeType: 'application/msword',
    buffer: Buffer.from('not a docx'),
  });
  await expect(page.getByTestId('word-import').getByRole('alert')).toContainText('.docx');
});

/** A chapter that cites two papers, then a "References" chapter listing them (APA, as typed). */
function wordFileWithReferences(): Promise<Buffer> {
  return Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph({ text: 'Introduction', heading: HeadingLevel.HEADING_1 }),
            new Paragraph(
              'Wells in the district are deeper every year (Kumar, 2021), as Rao (2019) found.',
            ),
            new Paragraph({ text: 'References', heading: HeadingLevel.HEADING_1 }),
            new Paragraph('Kumar, A. (2021). Falling water tables in Kolar. Journal of Hydrology.'),
            new Paragraph('Rao, S. (2019). Borewells and their failures. Water Policy.'),
          ],
        },
      ],
    }),
  );
}

/** R34 (ADR-0113): with a references section, the notice says why the citations stay text. */
test('a Word file with a references section is told why its citations stay text, and where the list went', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const session = await establishSession(request, freshEmail('word-import-refs'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Word import refs ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  const file = await wordFileWithReferences();

  const found: Array<{ where: string } & LayoutFault> = [];
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}?import=word`);
    await expect(page.getByTestId('word-import-file')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('word-import-file').setInputFiles({
      name: 'thesis-with-references.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: file,
    });
    const notice = page.getByTestId('word-import-citations');
    // Two in-text citations; the two reference entries are not counted as citations.
    await expect(notice).toContainText('2 citations not linked');
    await expect(notice).toContainText('an import adds no papers');
    await expect(notice).toContainText('the chapter “References” (2 entries)');
    await expect(notice).toContainText('Paste a reference');
    for (const fault of await page.evaluate(measureLayout, false)) {
      found.push({ where: `${width} preview`, ...fault });
    }
    if (width === 390) await notice.screenshot({ path: 'test-results/word-import-notice-390.png' });
  }

  await page.getByRole('button', { name: 'Import 2 chapters' }).click();
  await expect(
    page.getByTestId('word-import-summary').getByTestId('word-import-citations'),
  ).toContainText('the chapter “References” (2 entries)');

  expect(
    found,
    found
      .map((f) => `${f.where}: ${f.kind} ${f.by ?? ''}px ${f.el ?? ''} in ${f.box ?? ''}`)
      .join('\n'),
  ).toEqual([]);
});
