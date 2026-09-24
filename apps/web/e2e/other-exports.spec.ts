import { deflateSync, inflateRawSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The LaTeX and HTML exports — ADR-0021 — through the buttons a student presses.
 *
 * Both are built from the same chapter the `.docx` test uses: text, a display equation and a
 * figure uploaded through the real path. Then the files are opened: `main.tex` has to typeset the
 * equation and include the figure it ships with, and the web page has to carry the figure inside
 * it and draw the equation as MathML.
 */

/** A 3x2 red PNG — the same hand-assembled one `thesis-export.spec.ts` uses. */
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
  ihdr.writeUInt32BE(3, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.from([0x00, 0xff, 0x00, 0x00, 0xff, 0x00, 0x00, 0xff, 0x00, 0x00]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat([row, row]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Every file in a ZIP, by walking its local headers. */
function unzip(bytes: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let at = 0;
  while (at < bytes.length - 4 && bytes.readUInt32LE(at) === 0x04_03_4b_50) {
    const method = bytes.readUInt16LE(at + 8);
    const compressed = bytes.readUInt32LE(at + 18);
    const nameLength = bytes.readUInt16LE(at + 26);
    const extraLength = bytes.readUInt16LE(at + 28);
    const name = bytes.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const dataAt = at + 30 + nameLength + extraLength;
    const data = bytes.subarray(dataAt, dataAt + compressed);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    at = dataAt + compressed;
  }
  return files;
}

async function exportFrom(page: Page, testId: string): Promise<{ url: string; filename: string }> {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/export/thesis') && r.request().method() === 'POST',
  );
  await page.getByTestId(testId).click();
  const result = await response;
  expect(result.ok(), `export: ${result.status()}`).toBe(true);
  return (await result.json()) as { url: string; filename: string };
}

test('the thesis comes out as a LaTeX project and as a web page', async ({ page, request }) => {
  test.setTimeout(180_000);
  const session = await establishSession(request, freshEmail('other-exports'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);

  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Other formats ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.locator('.thesis-editor p').first().click();
  // TeX's special characters, which the LaTeX export has to escape.
  await page.keyboard.type('Uptake rose 40% in R&D_2 districts. ');
  await page.getByRole('button', { name: 'Display equation' }).click();
  await page.getByTestId('inline-prompt').getByRole('textbox').fill('E = mc^2');
  await page.getByTestId('inline-prompt-apply').click();
  await page.locator('[data-testid=figure-input]').setInputFiles({
    name: 'plot.png',
    mimeType: 'image/png',
    buffer: tinyPng(),
  });
  await expect(page.locator('.thesis-editor img')).toHaveCount(1, { timeout: 60_000 });
  await page.keyboard.press('Control+s');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 20_000 });

  await page.goto(`/app/d/${doc.id}/submit`);
  await expect(page.getByTestId('export-latex')).toBeVisible({ timeout: 30_000 });

  // LaTeX: a project that compiles as it stands.
  const latex = await exportFrom(page, 'export-latex');
  expect(latex.filename).toMatch(/-latex\.zip$/);
  await expect(page.getByTestId('downloads')).toContainText(latex.filename);
  const zip = unzip(Buffer.from(await (await request.get(latex.url)).body()));
  expect([...zip.keys()]).toEqual(
    expect.arrayContaining(['main.tex', 'references.bib', 'README.txt']),
  );
  const main = zip.get('main.tex')?.toString('utf8') ?? '';
  expect(main).toContain('\\documentclass');
  expect(main).toContain('Uptake rose 40\\% in R\\&D\\_2 districts.');
  expect(main).toContain('E = mc^2');
  const figure = [...zip.keys()].find((name) => /^figures\/.+\.png$/.test(name));
  expect(figure, 'the uploaded figure is in the project').toBeTruthy();
  expect(main).toContain(`{${figure}}`);
  expect(
    zip
      .get(figure ?? '')
      ?.subarray(1, 4)
      .toString('latin1'),
  ).toBe('PNG');

  // HTML: one file, figure and all.
  const html = await exportFrom(page, 'export-html');
  expect(html.filename).toMatch(/\.html$/);
  const body = await (await request.get(html.url)).text();
  expect(body.startsWith('<!doctype html>')).toBe(true);
  expect(body).toContain('Uptake rose 40% in R&amp;D_2 districts.');
  expect(body).toContain('<math');
  expect(body).toContain('data:image/png;base64,');
});
