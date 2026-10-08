/**
 * R40 (ADR-0117) — citations side by side read as one citation, in the page and in the .docx.
 *
 * The R1 browser run (2026-10-07) read "(Gadekar et al., 2026)(Raja et al., 2026)". The chapter
 * here is seeded the same way — two citation nodes with nothing between them, then one alone —
 * and the test reads what a student sees: the editor's paragraph, the hover card, the bracket
 * after one source is removed, and the chapter's exported .docx, in APA and in IEEE.
 */

import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { docxEntry } from './_docx';
import { API_URL, establishSession, freshEmail } from './_session';

const BIB = `@article{lecun,
  title = {Deep learning},
  author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},
  journal = {Nature},
  year = {2015},
  doi = {10.1038/nature14539}
}
@article{he,
  title = {Deep residual learning for image recognition},
  author = {He, Kaiming and Zhang, Xiangyu and Ren, Shaoqing and Sun, Jian},
  booktitle = {CVPR},
  year = {2016},
  doi = {10.1109/CVPR.2016.90}
}
`;

async function seed(page: Page, request: APIRequestContext) {
  const s = await establishSession(request, freshEmail('cite-cluster'));
  await page
    .context()
    .addCookies([{ name: s.cookieName, value: s.cookieValue, domain: 'localhost', path: '/' }]);
  const headers = { cookie: `${s.cookieName}=${s.cookieValue}` };

  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers,
    data: { title: `Citations side by side ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  const imported = await request.post(`${API_URL}/api/v1/documents/${doc.id}/sources/import`, {
    headers,
    multipart: {
      file: { name: 'two.bib', mimeType: 'application/x-bibtex', buffer: Buffer.from(BIB) },
    },
  });
  expect(imported.ok(), `import: ${imported.status()}`).toBe(true);

  let ids: string[] = [];
  await expect
    .poll(
      async () => {
        const list = (await (
          await request.get(`${API_URL}/api/v1/documents/${doc.id}/sources`, { headers })
        ).json()) as Array<{ id: string; status: string }>;
        ids = list.map((x) => x.id);
        return list.length === 2 && list.every((x) => x.status === 'RESOLVED');
      },
      { timeout: 120_000, intervals: [2_000], message: 'the sources never resolved' },
    )
    .toBe(true);

  const saved = await request.put(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
    headers,
    data: {
      baseVersion: 1,
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Chapter 1' }] },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Deep networks learn layered representations ' },
              { type: 'citation', attrs: { key: 'c_side_one', sourceId: ids[0] } },
              { type: 'citation', attrs: { key: 'c_side_two', sourceId: ids[1] } },
              { type: 'text', text: '. Residual connections made deeper models trainable ' },
              { type: 'citation', attrs: { key: 'c_alone', sourceId: ids[1] } },
              { type: 'text', text: '.' },
            ],
          },
        ],
      },
    },
  });
  expect(saved.ok(), `save: ${saved.status()}`).toBe(true);
  return { headers, documentId: doc.id, chapterId: doc.firstChapterId };
}

const paragraph = (page: Page) => page.locator('.thesis-editor p').first();

async function exportedText(
  request: APIRequestContext,
  headers: Record<string, string>,
  documentId: string,
  chapterId: string,
): Promise<string> {
  const exported = await request.post(`${API_URL}/api/v1/documents/${documentId}/export`, {
    headers,
    data: { chapterId, format: 'docx' },
  });
  expect(exported.ok(), `export: ${exported.status()}`).toBe(true);
  const { url } = (await exported.json()) as { url: string };
  const xml = docxEntry(Buffer.from(await (await request.get(url)).body()), 'word/document.xml');
  return [...xml.matchAll(/<w:t\b[^>]*>(.*?)<\/w:t>/g)].map((m) => m[1]).join('');
}

test('two citations side by side read as one bracket, in the editor and the .docx', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const { headers, documentId, chapterId } = await seed(page, request);
  await page.goto(`/app/d/${documentId}/write/${chapterId}`);

  // One bracket, before the full stop; never two brackets touching.
  await expect(paragraph(page)).toContainText(
    'representations (He et al., 2016; LeCun et al., 2015).',
    { timeout: 20_000 },
  );
  await expect(paragraph(page)).not.toContainText(')(');
  // Still three citation nodes in the document; the second of the pair draws nothing.
  await expect(page.locator('.thesis-editor span.citation')).toHaveCount(3);
  await expect(page.locator('.thesis-editor span.citation--member')).toHaveCount(1);

  // The hover card names both sources, one tab each.
  await page.locator('.thesis-editor span.citation--cluster').hover();
  const card = page.getByTestId('citation-cluster-card');
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card.getByTestId('citation-cluster-tab')).toHaveCount(2);

  // The .docx says what the page says.
  const text = await exportedText(request, headers, documentId, chapterId);
  expect(text).toContain('representations (He et al., 2016; LeCun et al., 2015).');
  expect(text).not.toContain(')(');

  // IEEE: the style's own way of joining numbers.
  const ieee = await request.put(`${API_URL}/api/v1/documents/${documentId}/citation-style`, {
    headers,
    data: { style: 'ieee' },
  });
  expect(ieee.ok(), `style: ${ieee.status()}`).toBe(true);
  await page.reload();
  await expect(paragraph(page)).toContainText('representations [1], [2].', { timeout: 20_000 });
  expect(await exportedText(request, headers, documentId, chapterId)).toContain(
    'representations [1], [2].',
  );

  // Remove one source from the card: the other stays, on its own label.
  await page.locator('.thesis-editor span.citation--cluster').hover();
  await page.getByTestId('citation-cluster-tab').nth(1).click();
  await page.getByTestId('citation-cluster-remove').click();
  await expect(page.locator('.thesis-editor span.citation')).toHaveCount(2);
  await expect(paragraph(page)).toContainText('representations [1].', { timeout: 20_000 });
});

test('a long bracket wraps with the line on a phone, inside the page', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const { documentId, chapterId } = await seed(page, request);
  await page.goto(`/app/d/${documentId}/write/${chapterId}`);
  const cluster = page.locator('.thesis-editor span.citation--cluster');
  await expect(cluster).toContainText('; ', { timeout: 20_000 });
  const box = await cluster.boundingBox();
  const editorBox = await page.locator('.thesis-editor').boundingBox();
  expect(box && editorBox && box.x + box.width <= editorBox.x + editorBox.width + 1).toBe(true);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
