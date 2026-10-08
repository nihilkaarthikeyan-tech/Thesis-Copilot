import { expect, test } from '@playwright/test';
import { seedAbstractOnlySource } from './_db.js';
import { type LayoutFault, measureLayout, settle } from './_layout.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The claims map opened as a document (R38, ADR-0123). What only a browser shows: that the
 * Discover tab's "Open as a document" lands in a new chapter whose six sections are pending AI
 * drafts, that the claims table and its citations are drawn, that a section accepts in place, that
 * the same map opens the same chapter again, and that the table and the drafts' headers fit a
 * laptop and a phone (the table scrolls inside its own box; the page never does).
 *
 * Needs the dev stack (web, API, Compose). The claims are mapped through the API once: on the mock
 * stack the mock answers; on real models it is one strong-tier pass (about ₹0.40).
 */

test.describe.configure({ mode: 'serial' });

const PAPERS = [
  {
    title: 'Night-time urban heat and recovery among outdoor workers in Chennai',
    abstract:
      'Night-time temperatures above 28 °C kept outdoor workers from recovering between shifts; heat strain rose on the following day.',
    doi: '10.5555/r38-e2e-1',
    year: 2024,
    family: 'Raman',
  },
  {
    title: 'Hydration breaks and heat strain on construction sites',
    abstract:
      'Scheduled hydration breaks lowered core temperature in two trials, but not in a third with longer shifts.',
    doi: '10.5555/r38-e2e-2',
    year: 2023,
    family: 'Iyer',
  },
  {
    title: 'Employer reporting of occupational heat illness',
    abstract:
      'Clinic records showed three times the heat illness that employers reported for the same sites and months.',
    doi: '10.5555/r38-e2e-3',
    year: 2025,
    family: 'Menon',
  },
];

test('the claims map opens as an editable chapter of pending drafts, every claim cited', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const session = await establishSession(request, freshEmail('claims-doc'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  // "Untitled thesis" names no topic, so no automatic paper search runs beside the test.
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: 'Untitled thesis', entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string };
  for (const paper of PAPERS) {
    await seedAbstractOnlySource(doc.id, { ...paper, doi: `${paper.doi}-${Date.now()}` });
  }
  const mapped = await request.post(`${API_URL}/api/v1/documents/${doc.id}/claims`, {
    headers: { cookie },
    data: {},
  });
  expect(mapped.ok(), `claims: ${mapped.status()}`).toBe(true);

  const found: Array<{ where: string } & LayoutFault> = [];
  const check = async (where: string) => {
    for (const fault of await page.evaluate(measureLayout, false)) found.push({ where, ...fault });
  };

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/app/d/${doc.id}/sources?tab=discover`);
  const open = page.getByTestId('claims-open-document');
  await expect(open).toHaveText('Open as a document', { timeout: 30_000 });
  await check('1280 discover');
  await open.click();
  await page.waitForURL(/\/write\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const chapterUrl = page.url();

  const editor = page.locator('.thesis-editor');
  await expect(editor).toBeVisible({ timeout: 30_000 });
  const pending = editor.locator('.draft-block--pending');
  await expect(pending).toHaveCount(6);
  for (const heading of [
    'Claims in the library',
    'Under-explored',
    'Contested',
    'Well supported',
    'Directions',
    'Limits of this mapping',
  ]) {
    await expect(editor.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  const table = editor.locator('table');
  await expect(table).toHaveCount(1);
  await expect(table.locator('th')).toHaveText(['Claim', 'Status', 'Evidence', 'Direction']);
  // Every row's evidence cites at least one paper, drawn as a real citation.
  const rows = table.locator('tr');
  const n = await rows.count();
  expect(n).toBeGreaterThan(1);
  for (let i = 1; i < n; i++) {
    await expect(rows.nth(i).locator('td').nth(2).locator('.citation').first()).toBeVisible();
  }
  await settle(page);
  await check('1280 chapter');

  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(chapterUrl);
    await expect(editor.locator('.draft-block--pending')).toHaveCount(6, { timeout: 30_000 });
    await settle(page);
    await check(`${width} chapter`);
    await page.goto(`/app/d/${doc.id}/sources?tab=discover`);
    await expect(page.getByTestId('claims-open-document')).toBeVisible({ timeout: 30_000 });
    await settle(page);
    await check(`${width} discover`);
  }

  // A section is accepted in place: it is thesis text from then on.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(chapterUrl);
  await expect(pending).toHaveCount(6, { timeout: 30_000 });
  await pending.first().getByRole('button', { name: 'Accept draft' }).click();
  await expect(pending).toHaveCount(5);
  await expect(editor.getByRole('heading', { name: 'Claims in the library' })).toBeVisible();

  // The same map opens the same chapter.
  await page.goto(`/app/d/${doc.id}/sources?tab=discover`);
  await expect(page.getByTestId('claims-open-document')).toHaveText('Open the document', {
    timeout: 30_000,
  });
  await page.getByTestId('claims-open-document').click();
  await page.waitForURL(chapterUrl, { timeout: 30_000 });

  expect(
    found,
    found
      .map((f) => `${f.where}: ${f.kind} ${f.by ?? ''}px ${f.el ?? ''} in ${f.box ?? ''}`)
      .join('\n'),
  ).toEqual([]);
});
