import { deflateSync, inflateRawSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
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

/** A 3x2 red PNG, hand-assembled: the smallest thing the exporter has to measure and embed. */
function tinyPng(): Buffer {
  const crc32 = (buf: Buffer): number => {
    let c = ~0;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xed_b8_83_20 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(3, 0); // width
  ihdr.writeUInt32BE(2, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  // Two rows of three red pixels, each row prefixed by its filter byte.
  const row = Buffer.from([0x00, 0xff, 0x00, 0x00, 0xff, 0x00, 0x00, 0xff, 0x00, 0x00]);
  const raw = Buffer.concat([row, row]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

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
  await page.getByTestId('inline-prompt').getByRole('textbox').fill('E = mc^2');
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
  expect(names.filter((n) => n.startsWith('word/media/')).length).toBeGreaterThan(0);
  expect(document).not.toContain('[plot.png]');
  expect(document).toContain('<w:drawing>');

  // The table survived.
  expect(document).toContain('<w:tbl>');

  // The equation is in there, in whatever form this build carries it (LaTeX source today).
  expect(document).toContain('E = mc');

  // And the thesis-level furniture the chapter export does not produce.
  expect(document).toContain('TOC');
  expect(document).toContain('Adoption rose sharply');
});
