import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { establishSession, freshEmail, type Session } from './_session.js';

/**
 * Onboarding — PRD §6.1, PHASES 5.3.
 *
 *   "First-run flow: create document → upload paper → proposal → editor, with one-line hints; a
 *    90-second 'how suggestions work' panel. Done when: E2E completes the flow from a fresh account."
 *
 * A brand-new account, nothing pre-seeded. The hints are asserted where the student meets them,
 * and dismissed, and the test proves a dismissal sticks across a reload.
 */

/** A one-page PDF with a title, an abstract and one reference line. */
function buildPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const parts = ['BT'];
  lines.forEach((text, i) => {
    parts.push('/F1 11 Tf', `1 0 0 1 72 ${700 - i * 18} Tm`, `(${esc(text)}) Tj`);
  });
  parts.push('ET');
  const stream = parts.join('\n');
  const objects = [
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Page /Parent 4 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 1 0 R >> >> /Contents 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Catalog /Pages 4 0 R >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const SEED_PDF = buildPdf([
  'Drip irrigation uptake among smallholders in Tamil Nadu',
  'Abstract',
  'We interview 140 farmers in two districts and report the leading barrier to uptake.',
  '1. Introduction',
  'Drip irrigation has spread unevenly across the surveyed districts since 2012.',
  'References',
  '[1] LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521, 436-444.',
]);

/** One session for the file: §12.1 allows twenty sign-in attempts a minute per IP. */
let session: Session | null = null;

async function signIn(page: Page, request: APIRequestContext) {
  session ??= await establishSession(request, freshEmail('onboard'));
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
}

test('a fresh account is walked from first sign-in to a first suggestion', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  await signIn(page, request);

  // Step 1: the list, empty, with the hint.
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Your theses' })).toBeVisible({
    timeout: 20_000,
  });
  const listHint = page.getByTestId('hint-list');
  await expect(listHint).toContainText('Step 1 of 3');
  const title = `Onboarding ${Date.now()}`;
  await page.getByLabel('Working title').fill(title);
  await page.getByRole('button', { name: 'Create thesis' }).click();
  await expect(page.getByRole('link', { name: title })).toBeVisible({ timeout: 20_000 });
  // With a thesis on the list the step-1 hint has done its job.
  await expect(listHint).toHaveCount(0);

  // Step 2: the proposal, with the upload hint, dismissed by hand.
  await page
    .getByRole('listitem')
    .filter({ hasText: title })
    .getByRole('link', { name: 'Proposal', exact: true })
    .click();
  const proposalHint = page.getByTestId('hint-proposal');
  await expect(proposalHint).toContainText('Step 2 of 3');
  await proposalHint.getByRole('button', { name: 'Got it' }).click();
  await expect(proposalHint).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Upload the paper this thesis grows from.')).toBeVisible();
  await expect(page.getByTestId('hint-proposal')).toHaveCount(0);

  await page.locator('input[type=file]').setInputFiles({
    name: 'seed.pdf',
    mimeType: 'application/pdf',
    buffer: SEED_PDF,
  });
  await expect(page.getByText('Read', { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByLabel('Working title')).toHaveValue(/Drip irrigation/, {
    timeout: 60_000,
  });

  // Step 3: continue into the editor.
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page).toHaveURL(/\/write\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 20_000 });

  const editorHint = page.getByTestId('hint-editor');
  await expect(editorHint).toContainText('Ctrl+/');
  await editorHint.getByRole('button', { name: 'How suggestions work (90 seconds)' }).click();

  const panel = page.getByTestId('how-suggestions-work');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Tab');
  await expect(panel).toContainText('Assist and Draft are different things');
  await expect(panel).toContainText('Verify every citation');
  await expect(panel).toContainText('cannot cite a paper that is not in your library');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  // The stale-label check: nothing in the header promises a later week.
  await expect(page.getByRole('banner')).not.toContainText('week');
  await expect(page.getByRole('button', { name: 'Export .docx' })).toBeEnabled();

  // The first suggestion, as the hint said.
  await page.locator('.thesis-editor p').first().click();
  await page.keyboard.type('Farmers in the surveyed districts reported ');
  await page.keyboard.press('Control+/');
  await expect(page.locator('.thesis-editor span.ghost')).toBeVisible({ timeout: 15_000 });
  // Wait for the suggestion to settle before pressing Tab. `toBeVisible` passes on the first
  // streamed token, and Tab is deliberately inert until the text is final — accepting half a
  // sentence would put half a sentence in the thesis.
  await expect(page.getByTestId('dev-timing')).toContainText('shown', { timeout: 15_000 });
  await page.keyboard.press('Tab');
  await expect(page.locator('.thesis-editor span.ghost')).toHaveCount(0);

  await editorHint.getByRole('button', { name: 'Got it' }).click();
  await page.reload();
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('hint-editor')).toHaveCount(0);
});

test('the chapter exports as a .docx from the header', async ({ page, request }) => {
  await signIn(page, request);
  await page.goto('/app');
  const title = `Export ${Date.now()}`;
  await page.getByLabel('Working title').fill(title);
  await page.getByRole('button', { name: 'Create thesis' }).click();
  await page.getByRole('link', { name: title }).click();
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Export .docx' }).click();
  const link = page.getByTestId('export-link');
  await expect(link).toBeVisible({ timeout: 30_000 });
  await expect(link).toContainText(/\.docx$/);
  const href = await link.getAttribute('href');
  expect(href).toMatch(/^https?:\/\//);
  // The signed link serves a real Word file, not a placeholder.
  const file = await request.get(href ?? '');
  expect(file.ok()).toBe(true);
  expect((await file.body()).subarray(0, 2).toString('latin1')).toBe('PK');
});
