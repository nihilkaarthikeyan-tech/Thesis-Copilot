import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Stage 1 proposal screen and Stage 2 library — PRD FR-1.3, FR-1.4, FR-2.1, FR-2.2
 * (PHASES 1-W2 tasks 2.4 and 2.8).
 *
 * These run against the real API and worker, because the two week-1 CORS faults were invisible to
 * every API-level test and only showed up in a browser. A screen is not proven until a browser has
 * driven it.
 */

/** A one-page PDF with a title, an abstract and two reference lines. */
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

/**
 * References to papers that really exist, so resolution is exercised against the live Crossref
 * service rather than a stub. Nothing here is invented: both DOIs are checked in the assertions.
 */
const REAL_REFERENCES_PDF = buildPdf([
  'Rooftop solar adoption in rural Karnataka',
  'Abstract',
  'We survey 312 households across three districts and report the leading barrier to adoption.',
  '1. Introduction',
  'Rooftop solar has grown steadily since 2015 across the surveyed districts of the state.',
  '2. Method',
  'We administered a structured questionnaire to 312 households between March and July.',
  'References',
  '[1] LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521, 436-444.',
  '[2] Hoogwijk, M., Rue du Can, S., & Novikova, A. (2010). Assessment of bottom-up sectoral',
  'and regional mitigation potentials. Energy Policy, 38, 3044-3057.',
]);

/** A reference to a paper that does not exist, so it can never resolve. */
const INVENTED_REFERENCE_PDF = buildPdf([
  'A paper citing something that was never published',
  'Abstract',
  'One reference here names a paper that does not exist anywhere in the literature.',
  'References',
  '[1] Kumar, A. (2021). Solar adoption in rural Karnataka. Energy Policy, 152, 112121.',
]);

async function signIn(page: Page, request: APIRequestContext): Promise<void> {
  const email = `e2e-w2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.goto('/sign-in');
  await page.getByLabel('University or personal email').fill(email);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByLabel('Six-digit code')).toBeVisible();

  const otpRes = await request.get(
    `${API_URL}/api/v1/auth/dev/last-otp?email=${encodeURIComponent(email)}`,
  );
  expect(otpRes.ok()).toBe(true);
  const { otp } = (await otpRes.json()) as { otp: string };
  await page.getByLabel('Six-digit code').fill(otp);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
}

/** Creates a thesis from the list screen and returns its id, taken from the Proposal link. */
async function createThesis(page: Page, title: string): Promise<string> {
  await page.getByLabel('Working title').fill(title);
  await page.getByRole('button', { name: 'Create thesis' }).click();
  await expect(page.getByRole('link', { name: title })).toBeVisible({ timeout: 20_000 });

  const href = await page
    .getByRole('listitem')
    .filter({ hasText: title })
    .getByRole('link', { name: 'Proposal', exact: true })
    .getAttribute('href');
  const id = /\/app\/d\/([0-9a-f-]{36})\/proposal/.exec(href ?? '')?.[1];
  expect(id, 'the list should link to the proposal screen').toBeTruthy();
  return id as string;
}

test.describe('Stage 1 proposal and Stage 2 library', () => {
  // Extraction plus two live scholarly lookups; the default 30s is not enough.
  test.setTimeout(180_000);

  test('FR-1.3/1.4: a paper becomes an editable proposal skeleton with a gap checklist', async ({
    page,
    request,
  }) => {
    await signIn(page, request);
    const id = await createThesis(page, `Skeleton E2E ${Date.now()}`);

    await page.goto(`/app/d/${id}/proposal`);
    await expect(
      page.getByRole('heading', { name: 'Turn your paper into a thesis proposal' }),
    ).toBeVisible();

    // Upload the seed paper through the dropzone the student actually uses.
    await page.getByText('Upload the paper this thesis grows from.').waitFor();
    await page.locator('input[type=file]').setInputFiles({
      name: 'seed.pdf',
      mimeType: 'application/pdf',
      buffer: REAL_REFERENCES_PDF,
    });

    // The screen polls while the worker reads the paper, then pre-fills the skeleton.
    await expect(page.getByText('Read', { exact: true })).toBeVisible({ timeout: 120_000 });
    const workingTitle = page.getByLabel('Working title');
    await expect(workingTitle).toHaveValue(/Rooftop solar adoption in rural Karnataka/, {
      timeout: 60_000,
    });

    // FR-1.3: the gap analysis is a checklist, and nothing on it blocks the student.
    const checklist = page.getByRole('heading', {
      name: 'What a thesis needs that this paper does not have',
    });
    await expect(checklist).toBeVisible();
    const boxes = page.locator('input[type=checkbox]');
    expect(await boxes.count()).toBeGreaterThan(0);
    await boxes.first().check();
    await expect(boxes.first()).toBeChecked();

    // FR-1.4: nothing is locked. Every field is editable, and the edits are what get saved.
    await workingTitle.fill('Barriers to rooftop solar adoption in rural Karnataka');
    await page
      .getByLabel('Problem statement')
      .fill('Cost, not awareness, appears to drive non-adoption.');
    await page
      .getByLabel('Why this is not yet fully answered')
      .fill('Existing work stops at the district level.');
    await page.getByRole('button', { name: 'Add an objective' }).click();
    await page
      .getByLabel(/^Objective \d+$/)
      .last()
      .fill('Quantify the cost barrier');

    await page.getByRole('button', { name: 'Continue to the editor' }).click();
    await expect(page).toHaveURL(/\/write\/[0-9a-f-]{36}$/, { timeout: 30_000 });

    // The saved working title is the student's, not the one drafted from the paper, and it reaches
    // the document list too (both are written in one transaction).
    await page.goto('/app');
    await expect(
      page.getByRole('link', { name: 'Barriers to rooftop solar adoption in rural Karnataka' }),
    ).toBeVisible({ timeout: 20_000 });

    // Re-opening the proposal shows what was saved, not a fresh draft.
    await page.goto(`/app/d/${id}/proposal`);
    await expect(page.getByLabel('Working title')).toHaveValue(
      /Barriers to rooftop solar adoption/,
      { timeout: 60_000 },
    );
  });

  test('FR-2.1/2.2: the library shows resolved sources with a grounding badge', async ({
    page,
    request,
  }) => {
    await signIn(page, request);
    const id = await createThesis(page, `Library E2E ${Date.now()}`);

    await page.goto(`/app/d/${id}/proposal`);
    await page.locator('input[type=file]').setInputFiles({
      name: 'seed.pdf',
      mimeType: 'application/pdf',
      buffer: REAL_REFERENCES_PDF,
    });
    await expect(page.getByText('Read', { exact: true })).toBeVisible({ timeout: 120_000 });

    await page.goto(`/app/d/${id}/sources`);
    await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible();

    // Both references resolve against the live Crossref service to their real records.
    await expect(page.getByText('Deep learning', { exact: true })).toBeVisible({
      timeout: 120_000,
    });
    await expect(
      page.getByText('Assessment of bottom-up sectoral and regional mitigation potentials'),
    ).toBeVisible({ timeout: 120_000 });

    // FR-2.1: the DOI stored is the real one, shown as a link to the record.
    await expect(page.getByRole('link', { name: '10.1038/nature14539' })).toBeVisible();

    // FR-2.2 AC: every resolved row carries a grounding badge saying what the AI may quote.
    const rows = page.getByRole('listitem').filter({ hasText: 'Deep learning' });
    await expect(rows.first()).toContainText(/Full text|Abstract only/);

    // Real bibliographic metadata, not placeholders.
    await expect(rows.first()).toContainText('Nature');
    await expect(rows.first()).toContainText('2015');

    // The filters partition the same library.
    await page.getByRole('button', { name: /^All \d+$/ }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Deep learning' })).toHaveCount(1);
  });

  test('FR-2.1: an unfindable reference stays unresolved and offers a manual fix', async ({
    page,
    request,
  }) => {
    await signIn(page, request);
    const id = await createThesis(page, `Unresolved E2E ${Date.now()}`);

    await page.goto(`/app/d/${id}/proposal`);
    await page.locator('input[type=file]').setInputFiles({
      name: 'invented.pdf',
      mimeType: 'application/pdf',
      buffer: INVENTED_REFERENCE_PDF,
    });
    await expect(page.getByText('Read', { exact: true })).toBeVisible({ timeout: 120_000 });

    await page.goto(`/app/d/${id}/sources`);

    // Never a guess: a reference to a paper that does not exist is reported as not found.
    await expect(page.getByText('Not found')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/From your paper: .*Kumar/)).toBeVisible();

    // The student supplies the DOI by hand, and that DOI is used directly rather than re-running
    // the search that already failed.
    await page.getByRole('button', { name: 'Fix this reference' }).click();
    await page.getByLabel('DOI').fill('10.1038/nature14539');
    await page.getByRole('button', { name: 'Look it up' }).click();

    await expect(page.getByText('Deep learning', { exact: true })).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.getByRole('link', { name: '10.1038/nature14539' })).toBeVisible();
    await expect(page.getByText('Not found')).toHaveCount(0);
  });
});
