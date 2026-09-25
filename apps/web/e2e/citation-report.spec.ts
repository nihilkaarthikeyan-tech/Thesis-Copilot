import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The pre-submission citation report (2026-09-25): every weak citation on one page, worst first,
 * each one a link to the sentence it is about.
 *
 * Built without a network source on purpose — a citation to a source that is not in the library
 * and a citation typed as plain text are both found by the mechanical check, so the test does not
 * wait on Crossref.
 */

test('the report lists every weak citation, worst first, and each opens at its sentence', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('citereport'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);

  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Citation report ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  const saved = await request.put(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
    headers: { cookie },
    data: {
      baseVersion: 1,
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Chapter 1' }] },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Adoption doubled after the subsidy' },
              {
                type: 'citation',
                attrs: { key: 'c1', sourceId: '01a0d700-0000-7000-8000-00000000dead' },
              },
              { type: 'text', text: '. Farmers trusted the scheme (Kumar, 2021) more than most.' },
            ],
          },
        ],
      },
    },
  });
  expect(saved.ok(), `save: ${saved.status()}`).toBe(true);

  // Reached from the submit screen, where a student goes the week before.
  await page.goto(`/app/d/${doc.id}/submit`);
  await page.getByTestId('open-citation-report').click();
  await expect(page).toHaveURL(new RegExp(`/app/d/${doc.id}/citations$`));

  await expect(page.getByTestId('citation-report-headline')).toHaveText(
    '1 to fix before anyone reads it, 1 worth fixing.',
    { timeout: 20_000 },
  );
  // The worst first: the citation to nothing, then the one typed by hand.
  await expect(page.getByTestId('citation-report-high').locator('li')).toHaveCount(1);
  await expect(page.getByTestId('citation-report-high')).toContainText('Citation with no source');
  const typed = page.getByTestId('citation-report-medium').locator('li[data-kind="UNTAGGED"]');
  await expect(typed).toContainText('(Kumar, 2021)');
  // It says what it could not check, rather than implying there is nothing to find.
  await expect(page.getByTestId('citation-report-support')).toContainText(
    'The support check has never run',
  );
  await page.screenshot({ path: 'test-results/citation-report.png', fullPage: true });

  // Each item opens the chapter with its sentence selected.
  await typed.getByRole('link').click();
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''), { timeout: 10_000 })
    .toBe('(Kumar, 2021)');
});
