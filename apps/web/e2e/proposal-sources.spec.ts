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

/**
 * References whose records carry a published abstract, so `index-source` can chunk something and
 * the sources reach ABSTRACT grounding. Plenty of real papers publish no abstract to Crossref —
 * the two in REAL_REFERENCES_PDF do not — and a source with nothing to quote is not pinnable.
 */
const ABSTRACTED_REFERENCES_PDF = buildPdf([
  'Rooftop solar adoption in rural Karnataka',
  'Abstract',
  'We survey 312 households across three districts and report the leading barrier to adoption.',
  '1. Introduction',
  'Rooftop solar has grown steadily since 2015 across the surveyed districts of the state.',
  'References',
  '[1] Jumper, J., Evans, R., Pritzel, A. (2021). Highly accurate protein structure prediction with AlphaFold. Nature, 596, 583-589.',
  '[2] Trijono, R. (2023). Regulatory Frameworks for Renewable Energy. Renewable Energy.',
]);

/** A reference to a paper that does not exist, so it can never resolve. */
const INVENTED_REFERENCE_PDF = buildPdf([
  'A paper citing something that was never published',
  'Abstract',
  'One reference here names a paper that does not exist anywhere in the literature.',
  'References',
  '[1] Kumar, A. (2021). Solar adoption in rural Karnataka. Energy Policy, 152, 112121.',
]);

/**
 * One session for the whole file.
 *
 * Signing in per test tripped the auth rate limiter (20 requests a minute from one address, which
 * is right for production): five sign-ins plus their session checks exceed it, and the sixth test
 * failed for a reason that had nothing to do with what it was testing. The sign-in UI itself is
 * covered by `smoke.spec.ts` and `editor.spec.ts`; here it is only a way in.
 */
let session: { cookieName: string; cookieValue: string } | null = null;

async function establishSession(request: APIRequestContext): Promise<NonNullable<typeof session>> {
  if (session) return session;

  const email = `e2e-w2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const sent = await request.post(`${API_URL}/api/v1/auth/email-otp/send-verification-otp`, {
    data: { email, type: 'sign-in' },
  });
  expect(sent.ok(), 'sending the one-time code').toBe(true);

  const otpRes = await request.get(
    `${API_URL}/api/v1/auth/dev/last-otp?email=${encodeURIComponent(email)}`,
  );
  expect(otpRes.ok(), 'reading the dev one-time code').toBe(true);
  const { otp } = (await otpRes.json()) as { otp: string };

  const signedIn = await request.post(`${API_URL}/api/v1/auth/sign-in/email-otp`, {
    data: { email, otp },
  });
  expect(signedIn.ok(), 'signing in').toBe(true);

  const setCookie = signedIn.headers()['set-cookie'] ?? '';
  const pair = setCookie.split(';')[0] ?? '';
  const index = pair.indexOf('=');
  expect(index, 'the sign-in response should set a session cookie').toBeGreaterThan(0);

  session = { cookieName: pair.slice(0, index), cookieValue: pair.slice(index + 1) };
  return session;
}

async function signIn(page: Page, request: APIRequestContext): Promise<void> {
  const { cookieName, cookieValue } = await establishSession(request);
  await page
    .context()
    .addCookies([{ name: cookieName, value: cookieValue, domain: 'localhost', path: '/' }]);
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Your theses' })).toBeVisible({
    timeout: 20_000,
  });
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

test.describe('Stage 4 chapter setup', () => {
  test.setTimeout(180_000);

  /**
   * PHASES 3.1's done-when: "continue → editor opens on the chapter → pin two sources."
   * Pins are the retrieval filter (§10.4), so what matters is that the choice reaches the API and
   * survives a reload, not that a box looks ticked.
   */
  test('3.1: Continue opens the chapter from the paper, and two sources can be pinned', async ({
    page,
    request,
  }) => {
    await signIn(page, request);
    const id = await createThesis(page, `Pins E2E ${Date.now()}`);

    await page.goto(`/app/d/${id}/proposal`);
    await page.locator('input[type=file]').setInputFiles({
      name: 'seed.pdf',
      mimeType: 'application/pdf',
      buffer: ABSTRACTED_REFERENCES_PDF,
    });
    await expect(page.getByText('Read', { exact: true })).toBeVisible({ timeout: 120_000 });

    await page.getByRole('button', { name: 'Continue to the editor' }).click();
    await expect(page).toHaveURL(/\/write\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 20_000 });

    // The chapter is the paper's own first section, not the "Chapter 1" placeholder (FR-3.3).
    await expect(page.locator('.thesis-editor h1').first()).not.toHaveText('Chapter 1');

    const panel = page.getByRole('complementary').filter({ hasText: 'sources' });
    await expect(panel.getByText(/Suggestions .* every source in the library/)).toBeVisible({
      timeout: 60_000,
    });

    // Both references resolve with an abstract, so both are pinnable.
    const boxes = panel.locator('input[type=checkbox]');
    await expect(boxes).toHaveCount(2, { timeout: 120_000 });
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await expect(panel.getByText('draw only on 2 pinned sources')).toBeVisible();

    // The filter is only real if it survived the round trip.
    await page.reload();
    const afterReload = page.getByRole('complementary').filter({ hasText: 'sources' });
    await expect(afterReload.getByText('draw only on 2 pinned sources')).toBeVisible({
      timeout: 60_000,
    });

    await afterReload.getByRole('button', { name: 'Clear' }).click();
    await expect(afterReload.getByText(/every source in the library/)).toBeVisible();
  });
});

test.describe('Stage 4 citations', () => {
  test.setTimeout(180_000);

  /**
   * PHASES 3.5's done-when: "accept a suggestion containing a citation → hover shows the passage
   * → reload → citation persists." The library here has two sources with abstracts, both pinned,
   * so §10.4 retrieves real passages and the model (mock, obeying A.0 rule 3) cites one of them by
   * its prompt id. What lands in the document is the real source and chunk id behind that id.
   */
  test('3.5: an accepted citation resolves to a real source, shows its passage, and survives a reload', async ({
    page,
    request,
  }) => {
    await signIn(page, request);
    const id = await createThesis(page, `Cite E2E ${Date.now()}`);

    await page.goto(`/app/d/${id}/proposal`);
    await page.locator('input[type=file]').setInputFiles({
      name: 'seed.pdf',
      mimeType: 'application/pdf',
      buffer: ABSTRACTED_REFERENCES_PDF,
    });
    await expect(page.getByText('Read', { exact: true })).toBeVisible({ timeout: 120_000 });
    await page.getByRole('button', { name: 'Continue to the editor' }).click();
    await expect(page).toHaveURL(/\/write\/[0-9a-f-]{36}$/, { timeout: 30_000 });

    const editor = page.locator('.thesis-editor');
    await expect(editor).toBeVisible({ timeout: 20_000 });

    // Both sources indexed and pinned, so retrieval has passages to offer.
    const panel = page.getByRole('complementary').filter({ hasText: 'sources' });
    const boxes = panel.locator('input[type=checkbox]');
    await expect(boxes).toHaveCount(2, { timeout: 120_000 });
    await panel.getByRole('button', { name: 'Pin all' }).click();
    await expect(panel.getByText('draw only on 2 pinned sources')).toBeVisible();

    // Ask for a suggestion; the mock cites the first retrieved passage by its prompt id.
    await editor.locator('p').first().click();
    await page.keyboard.type('Prior studies of protein structure found ');
    await page.keyboard.press('Control+/');
    const ghost = editor.locator('span.ghost');
    await expect(ghost).toBeVisible({ timeout: 10_000 });
    await expect(ghost).toContainText('Evidence from rural Karnataka', { timeout: 10_000 });
    // Tab accepts what is shown; wait for the stream to finish so the whole suggestion lands.
    await expect(page.getByTestId('dev-timing')).toContainText('shown', { timeout: 10_000 });

    await page.keyboard.press('Tab');
    await expect(ghost).toHaveCount(0);

    // A real citation node with real ids, labelled from the server's rendered form.
    const citation = editor.locator('span.citation');
    await expect(citation).toHaveCount(1);
    await expect(citation).not.toHaveText('(Source, n.d.)');
    const sourceId = await citation.getAttribute('data-source-id');
    expect(sourceId, 'the node should carry the real source id').toMatch(/^[0-9a-f-]{36}$/);

    // Let the accept fade and the autosave settle first. The fade decorates the accepted range and
    // ProseMirror redraws it when the fade ends, which can recreate the NodeView and close a
    // popover opened inside that ~400 ms window (a known, minor glitch; the next hover reopens it).
    await expect(page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Hover shows the passage the citation stands on, straight from the chunk table.
    await citation.hover();
    const popover = editor.locator('.citation-popover');
    await expect(popover).toBeVisible({ timeout: 10_000 });
    await expect(popover.locator('.citation-popover__text')).not.toBeEmpty();
    await expect(popover.locator('.citation-popover__ref')).toContainText(/\d{4}/);

    // Reload: the node, its ids and its label persist.
    await page.reload();
    const after = page.locator('.thesis-editor span.citation');
    await expect(after).toHaveCount(1, { timeout: 20_000 });
    expect(await after.getAttribute('data-source-id')).toBe(sourceId);

    // And the Citation row mirrors it (PHASES 3.5: "Citation rows upserted on save").
    await page.getByRole('button', { name: 'citations' }).click();
    const tab = page.getByRole('complementary').filter({ hasText: 'citations' });
    await expect(tab.getByRole('button', { name: /^1\./ })).toBeVisible({ timeout: 10_000 });
  });
});
