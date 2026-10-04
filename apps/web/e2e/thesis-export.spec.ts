import { inflateRawSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { tinyPng } from './_images.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The file a student actually submits.
 *
 * `chapterToDocx` is proven end to end — a table, both equations and an embedded figure, read back
 * out of the .docx XML. `thesisToDocx` is a second exporter that got the same fixes in the same
 * commit and has never been run with a real figure in it, which is the wrong way round: the whole
 * thesis is the file that goes to the examiner and the single chapter is the convenience.
 *
 * So this walks the real path — toolbar, upload, export button — and then opens the artefact. A
 * figure that silently becomes the italic placeholder `[image]` is exactly the class of fault that
 * every unit test in this repository passed through.
 */

/** 4x3 files from a real encoder (Pillow), so the dimensions read back are known. */
const JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAADAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDCooorzj7E/9k=';
const GIF_B64 = 'R0lGODdhBAADAIAAAAAAAAAAACwAAAAABAADAAAICAABCBxIUGBAADs=';

/** `word/document.xml` out of a .docx, plus the names of everything in the archive. */
function openDocx(bytes: Buffer): { names: string[]; document: string } {
  // The archive is a plain ZIP; read the central directory rather than adding a dependency.
  const names: string[] = [];
  const parts: Buffer[] = [];
  let at = 0;
  while (at < bytes.length - 4) {
    if (bytes.readUInt32LE(at) !== 0x04_03_4b_50) break;
    const method = bytes.readUInt16LE(at + 8);
    const compressed = bytes.readUInt32LE(at + 18);
    const nameLength = bytes.readUInt16LE(at + 26);
    const extraLength = bytes.readUInt16LE(at + 28);
    const name = bytes.subarray(at + 30, at + 30 + nameLength).toString('latin1');
    const dataAt = at + 30 + nameLength + extraLength;
    const data = bytes.subarray(dataAt, dataAt + compressed);
    names.push(name);
    if (name === 'word/document.xml') {
      parts.push(method === 8 ? inflateRawSync(data) : Buffer.from(data));
    }
    at = dataAt + compressed;
  }
  return { names, document: Buffer.concat(parts).toString('utf8') };
}

test('the whole thesis exports with its figure, table and equation intact', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const session = await establishSession(request, freshEmail('thesis-export'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);

  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Whole thesis ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.locator('.thesis-editor p').first().click();
  await page.keyboard.type('Adoption rose sharply after the subsidy was announced. ');

  // A display equation, through the toolbar's own inline prompt.
  await page.getByRole('button', { name: 'Display equation' }).click();
  await page.locator('#inline-prompt-field').fill('E = mc^2');
  await page.getByTestId('inline-prompt-apply').click();
  await expect(page.locator('.thesis-editor .math-block, .thesis-editor [data-math]')).toHaveCount(
    1,
    { timeout: 10_000 },
  );

  // A figure, through the real upload path: signed URL, object storage, the lot. Before the
  // table, because inserting a table leaves the caret in its first cell and the figure would go
  // in there — which is a case worth exporting, and not the one this test is about.
  await page.locator('[data-testid=figure-input]').setInputFiles({
    name: 'plot.png',
    mimeType: 'image/png',
    buffer: tinyPng(),
  });
  await expect(page.locator('.thesis-editor img')).toHaveCount(1, { timeout: 60_000 });

  // And a table, last.
  await page.getByRole('button', { name: 'Insert table' }).click();
  await expect(page.locator('.thesis-editor table')).toHaveCount(1);

  await page.keyboard.press('Control+s');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });

  // Export the whole thesis, not the chapter.
  const exported = await request.post(`${API_URL}/api/v1/documents/${doc.id}/export/thesis`, {
    headers: { cookie },
    data: { format: 'docx' },
  });
  expect(exported.ok(), `export: ${exported.status()} ${await exported.text()}`).toBe(true);
  const result = (await exported.json()) as { url: string; filename: string; bytes: number };
  expect(result.filename).toMatch(/\.docx$/);

  const file = await request.get(result.url);
  expect(file.ok(), `download: ${file.status()}`).toBe(true);
  const bytes = Buffer.from(await file.body());
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');

  const { names, document } = openDocx(bytes);

  // The figure is a real picture in the archive, not the named placeholder the exporter falls
  // back to when it cannot read the bytes.
  expect(names.filter((n) => n.startsWith('word/media/') && !n.endsWith('/'))).toHaveLength(1);
  expect(document).not.toContain('[plot.png]');
  expect(document).toContain('<w:drawing>');

  // The table survived.
  expect(document).toContain('<w:tbl>');

  // The equation is in there as a Word equation (2026-09-25), with c² built as a superscript
  // rather than printed as its LaTeX source.
  expect(document).toContain('<m:oMath>');
  expect(document).toContain('<m:sSup>');
  expect(document).not.toContain('mc^2');

  // And the thesis-level furniture the chapter export does not produce.
  expect(document).toContain('TOC');
  expect(document).toContain('Adoption rose sharply');
});

/**
 * A JPEG and a GIF, through the same path a student uses.
 *
 * PNG is proven above. These two are the ones `imageSize` reads with its own header walkers —
 * the JPEG one skips fill bytes and standalone markers to find `SOF0`, and it is the most
 * intricate code in the export package — and until now they were covered only by unit tests over
 * bytes this repository had written itself. A header reader that agrees with its author's idea of
 * the format is not evidence.
 *
 * Both are real files from an encoder (Pillow), 4x3 pixels, so the dimensions the exporter reads
 * can be checked against something known rather than against the same constant twice.
 */
test('a JPEG and a GIF survive the real upload and export path', async ({ page, request }) => {
  test.setTimeout(180_000);
  const session = await establishSession(request, freshEmail('formats'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);

  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Formats ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.locator('.thesis-editor p').first().click();
  await page.keyboard.type('Two figures follow. ');

  await page.locator('[data-testid=figure-input]').setInputFiles({
    name: 'scan.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(JPEG_B64, 'base64'),
  });
  await expect(page.locator('.thesis-editor img')).toHaveCount(1, { timeout: 60_000 });
  // The caption is the student's words, written through the toolbar. Before this existed the
  // submitted thesis read "Figure 1.1: scan.jpg", and a test here said that was right.
  await page.locator('.thesis-editor img').first().click();
  await page.getByTestId('fmt-caption').click();
  await page.locator('#inline-prompt-field').fill('Scanned survey form');
  await page.getByTestId('inline-prompt-apply').click();

  // The caret is on the figure; the next figure goes after it.
  await page.locator('.thesis-editor p').last().click();
  await page.locator('[data-testid=figure-input]').setInputFiles({
    name: 'chart.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from(GIF_B64, 'base64'),
  });
  await expect(page.locator('.thesis-editor img')).toHaveCount(2, { timeout: 60_000 });
  await page.locator('.thesis-editor img').nth(1).click();
  await page.getByTestId('fmt-caption').click();
  await page.locator('#inline-prompt-field').fill('Adoption by district');
  await page.getByTestId('inline-prompt-apply').click();

  await page.keyboard.press('Control+s');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });

  const exported = await request.post(`${API_URL}/api/v1/documents/${doc.id}/export/thesis`, {
    headers: { cookie },
    data: { format: 'docx' },
  });
  expect(exported.ok(), `export: ${exported.status()} ${await exported.text()}`).toBe(true);
  const result = (await exported.json()) as { url: string };
  const bytes = Buffer.from(await (await request.get(result.url)).body());
  const { names, document } = openDocx(bytes);

  // Two pictures in the archive, announced as what they are: Word reads the part's declared type,
  // so a JPEG stored as a .png is a figure that does not render in the submitted file.
  // `word/media/` itself is an entry in the archive; the trailing slash is how a directory is
  // written, and counting it made this "3 pictures".
  const media = names.filter((n) => n.startsWith('word/media/') && !n.endsWith('/'));
  expect(media).toHaveLength(2);
  expect(media.some((n) => n.endsWith('.jpg') || n.endsWith('.jpeg'))).toBe(true);
  expect(media.some((n) => n.endsWith('.gif'))).toBe(true);

  expect(document).not.toContain('[scan.jpg]');
  expect(document).not.toContain('[chart.gif]');
  expect(document).toContain('Figure 1.1: Scanned survey form');
  expect(document).toContain('Figure 1.2: Adoption by district');
  // A file name is never a caption.
  expect(document).not.toContain('scan.jpg');
  expect(document).not.toContain('chart.gif');

  // Both are 4x3, so the aspect ratio is the check that the header walkers read real dimensions
  // rather than a default. `fitToColumn` scales to the text width and keeps the ratio.
  const extents = [...document.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)].map((m) => ({
    cx: Number(m[1]),
    cy: Number(m[2]),
  }));
  expect(extents).toHaveLength(2);
  for (const extent of extents) {
    expect(extent.cx / extent.cy).toBeCloseTo(4 / 3, 1);
  }
});
