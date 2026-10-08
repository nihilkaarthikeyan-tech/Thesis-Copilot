import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * R36 (ADR-0115): "How was this?" after something the product built for the student.
 *
 * The viva set end to end on the real API (the mock writes the questions in CI): rate it, add a
 * line, reload and find it as left, take it back. A finished chapter build needs the worker to
 * run a whole build, so the build page is given one, shaped exactly as `ChapterBuildService.view`
 * sends it, and the rating request it makes is what is checked; `output-rating.spec.ts` in the
 * API tests covers storing it. Both cards are measured at a phone's width.
 */

const PARAGRAPHS = [
  'Forty-two households in three districts of rural Karnataka were interviewed between March and June 2021, chosen from installer enquiry lists so that every one of them had at least considered rooftop solar before.',
  'Upfront cost was named first by most households that stopped, but the interviews show that the fourteen-week wait for the subsidy payment mattered more than its size, because families had to borrow for the whole amount.',
  'Trust in the installer decided more cases than price did: where no installer kept a local service presence, households that had enquired rarely went ahead, whatever subsidy they were offered by the state.',
  'The study therefore argues that faster disbursement and a local service presence would do more for adoption than a larger subsidy, although the sample is small and drawn only from households that enquired.',
];

async function signedIn(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  label: string,
) {
  const session = await establishSession(request, freshEmail(label));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Rate this ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  return { cookie, doc: (await created.json()) as { id: string; firstChapterId: string } };
}

const fitsTheWindow = (page: import('@playwright/test').Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );

test('a viva question set is rated, with a line, and stays rated after a reload', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const { cookie, doc } = await signedIn(page, request, 'rate-viva');
  const saved = await request.put(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
    headers: { cookie },
    data: {
      baseVersion: 1,
      content: {
        type: 'doc',
        content: PARAGRAPHS.map((text) => ({
          type: 'paragraph',
          content: [{ type: 'text', text }],
        })),
      },
    },
  });
  expect(saved.ok(), `save: ${saved.status()}`).toBe(true);

  await page.goto(`/app/d/${doc.id}/viva`);
  await page.getByTestId('viva-ask').click();
  await expect(page.getByTestId('viva-question').first()).toBeVisible({ timeout: 90_000 });

  const card = page.getByTestId('rate-this');
  await expect(card).toContainText('How were these questions?');
  await card.getByRole('button', { name: 'Not useful', exact: true }).click();
  await expect(card.getByTestId('rate-status')).toHaveText('Thanks — saved.');
  await card.getByTestId('rate-note').fill('Two questions were about the same paragraph.');
  await card.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(card).toContainText('“Two questions were about the same paragraph.”');

  await page.reload();
  const again = page.getByTestId('rate-this');
  await expect(again.getByRole('button', { name: 'Not useful', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(again).toContainText('Two questions were about the same paragraph.');

  await page.setViewportSize({ width: 390, height: 900 });
  expect(await fitsTheWindow(page)).toBe(true);

  // Pressed again, it is taken back.
  await again.getByRole('button', { name: 'Not useful', exact: true }).click();
  await expect(again.getByTestId('rate-status')).toHaveText('Taken back.');
  await expect(again.getByRole('button', { name: 'Not useful', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test('a finished chapter build asks "How was this build?" and sends the rating for that build', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const { doc } = await signedIn(page, request, 'rate-build');
  const buildId = '01a10000-0000-7000-8000-0000000b0115';
  const origin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').origin;
  const cors = {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
  };
  const summary = {
    id: buildId,
    chapterId: doc.firstChapterId,
    chapterTitle: 'Chapter 1',
    status: 'DONE',
    progress: null,
    createdAt: '2026-10-08T09:00:00.000Z',
    finishedAt: '2026-10-08T09:06:00.000Z',
    blockingOpen: 0,
    sections: 1,
    error: null,
  };
  const profile = { disciplineId: 'general', paradigm: 'experimental', universityId: 'generic' };
  // With or without `?watching=1` (ADR-0058), which the page adds while its tab is visible.
  await page.route(new RegExp(`/api/v1/documents/${doc.id}/chapter-build(\\?.*)?$`), (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', ...cors },
      body: JSON.stringify({
        profile,
        suggested: false,
        chapters: [
          {
            id: doc.firstChapterId,
            title: 'Chapter 1',
            order: 1,
            wordCount: 0,
            pendingBuild: false,
          },
        ],
        builds: [summary],
        remaining: { used: 1, cap: 3 },
        hasCoAuthor: false,
      }),
    }),
  );
  await page.route(new RegExp(`/chapter-build/${buildId}(\\?.*)?$`), (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', ...cors },
      body: JSON.stringify({
        ...summary,
        profile,
        plan: null,
        rating: null,
        report: {
          sections: [
            {
              id: 'S1',
              title: 'Background',
              status: 'passed',
              words: 420,
              citations: 4,
              needsSource: [],
              draftId: null,
            },
          ],
          checks: [],
          issues: [],
          evidenceNeeded: [],
          references: [],
          similarity: { copiedRuns: 0, checkedWords: 420 },
          totals: {
            words: 420,
            citations: 4,
            blockingOpen: 0,
            warningsOpen: 0,
            fixed: 0,
            spentInr: 9,
          },
          disclosure: '',
          universityUnconfirmed: false,
        },
      }),
    }),
  );
  let sent: unknown = null;
  await page.route(
    `${API_URL}/api/v1/documents/${doc.id}/ratings/chapter-build/${buildId}`,
    (route) => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: {
            ...cors,
            'access-control-allow-methods': 'PUT',
            'access-control-allow-headers': 'content-type',
          },
        });
      }
      sent = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json', ...cors },
        body: JSON.stringify({ rating: 1, note: null }),
      });
    },
  );

  await page.goto(`/app/d/${doc.id}/build`);
  const card = page.getByTestId('rate-this');
  await expect(card).toContainText('How was this build?', { timeout: 60_000 });
  await card.getByRole('button', { name: 'Useful', exact: true }).click();
  await expect(card.getByTestId('rate-status')).toHaveText('Thanks — saved.');
  expect(sent).toEqual({ rating: 1 });
  await expect(card.getByTestId('rate-note')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 900 });
  expect(await fitsTheWindow(page)).toBe(true);
});
