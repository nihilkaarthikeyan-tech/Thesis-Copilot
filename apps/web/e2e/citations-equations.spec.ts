/**
 * ADR-0045 — citations and equations that hold, proved in the browser.
 *
 * Every fault this covers was invisible to the unit tests because it lived between two parts that
 * were each right on their own: the node key the AI paths chose and the label map the renderer
 * returns; the plain-text selection the command toolbar sent and the plain-string apply that
 * replaced it; the equation node and the field that could only insert one.
 *
 * The chapter is seeded the way chapters written before ADR-0045 look: two citation nodes that
 * share the request-local key `S1#c1` but point at different sources.
 */

import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail, type Session } from './_session';

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

async function seed(
  page: Page,
  request: APIRequestContext,
): Promise<{ s: Session; documentId: string; chapterId: string }> {
  const s = await establishSession(request, freshEmail('cite-eq'));
  await page
    .context()
    .addCookies([{ name: s.cookieName, value: s.cookieValue, domain: 'localhost', path: '/' }]);
  const headers = { cookie: `${s.cookieName}=${s.cookieValue}` };

  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers,
    data: { title: `Citations and equations ${Date.now()}`, entryPath: 'A_TOPIC' },
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
              { type: 'citation', attrs: { key: 'S1#c1', sourceId: ids[0] } },
              { type: 'text', text: ' and the flow obeys ' },
              { type: 'mathInline', attrs: { latex: '\\dot{m} = \\rho A v' } },
              { type: 'text', text: ' across the plant ' },
              { type: 'citation', attrs: { key: 'S1#c1', sourceId: ids[1] } },
              {
                type: 'text',
                text: '. Residual connections made much deeper models trainable in practice.',
              },
            ],
          },
          { type: 'mathBlock', attrs: { latex: 'E = mc^2' } },
          { type: 'paragraph', content: [{ type: 'text', text: 'A closing paragraph.' }] },
        ],
      },
    },
  });
  expect(saved.ok(), `save: ${saved.status()}`).toBe(true);
  return { s, documentId: doc.id, chapterId: doc.firstChapterId };
}

const citations = (page: Page) =>
  page.locator('.thesis-editor span.citation').evaluateAll((els) =>
    els.map((e) => ({
      key: e.getAttribute('data-key') ?? '',
      source: e.getAttribute('data-source-id') ?? '',
      label: e.textContent ?? '',
    })),
  );

test('old duplicate keys are repaired on open, and each citation shows its own source', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const { documentId, chapterId } = await seed(page, request);
  await page.goto(`/app/d/${documentId}/write/${chapterId}`);

  await expect
    .poll(async () => new Set((await citations(page)).map((c) => c.key)).size, {
      timeout: 20_000,
      message: 'the twin was never re-keyed',
    })
    .toBe(2);
  // Two different sources, two different labels — before ADR-0045 both read the same.
  await expect
    .poll(
      async () => {
        const cs = await citations(page);
        return cs[0]?.label !== cs[1]?.label && cs.every((c) => /\d{4}/.test(c.label));
      },
      { timeout: 20_000 },
    )
    .toBe(true);

  // The repair was saved, not only drawn: it is still there after a reload.
  await page.waitForTimeout(2_500);
  await page.reload();
  await expect
    .poll(async () => new Set((await citations(page)).map((c) => c.key)).size, { timeout: 20_000 })
    .toBe(2);
});

test('a command keeps the citations and the equation it was run over', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const { documentId, chapterId } = await seed(page, request);
  await page.goto(`/app/d/${documentId}/write/${chapterId}`);
  await expect(page.locator('.thesis-editor span.citation')).toHaveCount(2, { timeout: 20_000 });
  const before = await citations(page);

  // Select the first paragraph — two citations and an inline equation inside it.
  await page.locator('.thesis-editor p').first().click({ clickCount: 3 });
  const toolbar = page.getByTestId('command-toolbar');
  await expect(toolbar).toBeVisible({ timeout: 10_000 });
  await toolbar.getByRole('button', { name: 'Expand' }).click();

  const diff = page.getByTestId('command-diff');
  await expect(diff).toBeVisible({ timeout: 30_000 });
  // The preview shows labels, not wire markers.
  await expect(diff).not.toContainText('{{cite');

  await page.getByTestId('command-apply').click();
  await expect(diff).toHaveCount(0, { timeout: 15_000 });

  // Every citation is still a citation node with the source it had; the equation is still an
  // equation. Before ADR-0045 Apply replaced the range with plain text and deleted them all.
  const after = await citations(page);
  expect(after.map((c) => c.source).sort()).toEqual(before.map((c) => c.source).sort());
  expect(after.map((c) => c.key).sort()).toEqual(before.map((c) => c.key).sort());
  await expect(page.locator('.thesis-editor p').first().locator('.math-inline')).toHaveAttribute(
    'data-latex',
    '\\dot{m} = \\rho A v',
  );
  const textNodes = await page
    .locator('.thesis-editor p')
    .first()
    .evaluate((p) => {
      const out: string[] = [];
      const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) =>
          n.parentElement?.closest('.citation, .math-inline')
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      });
      while (walk.nextNode()) out.push(walk.currentNode.textContent ?? '');
      return out.join('');
    });
  expect(textNodes).not.toContain('{{cite');
  expect(textNodes).not.toContain('$');
  expect(textNodes).toContain('This follows from the evidence stated above');
});

test('an equation opens for editing on click and says what is wrong with bad LaTeX', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const { documentId, chapterId } = await seed(page, request);
  await page.goto(`/app/d/${documentId}/write/${chapterId}`);

  const inline = page.locator('.thesis-editor .math-inline').first();
  await expect(inline).toBeVisible({ timeout: 20_000 });
  await inline.click();

  const field = page.locator('#inline-prompt-field');
  await expect(field).toHaveValue('\\dot{m} = \\rho A v');

  await field.fill('\\frac{a}{');
  await expect(page.getByTestId('inline-prompt').getByRole('alert')).toContainText('expected');
  await field.press('Enter');
  // Refused: the field is still open and the equation unchanged.
  await expect(field).toBeVisible();
  await expect(inline).toHaveAttribute('data-latex', '\\dot{m} = \\rho A v');

  await field.fill('\\dot{m} = \\rho A v^2');
  await field.press('Enter');
  await expect(field).toHaveCount(0);
  await expect(inline).toHaveAttribute('data-latex', '\\dot{m} = \\rho A v^2');

  // Saved: still the new source after a reload.
  await page.waitForTimeout(2_500);
  await page.reload();
  await expect(page.locator('.thesis-editor .math-inline').first()).toHaveAttribute(
    'data-latex',
    '\\dot{m} = \\rho A v^2',
    { timeout: 20_000 },
  );
});
