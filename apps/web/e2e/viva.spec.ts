import { expect, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Viva preparation (ADR-0030), from the Submit screen to feedback on a typed answer.
 *
 * CI runs this on the mock and a developer's machine on the real Strong model, so it asserts the
 * shape — questions about this thesis, a verdict, the use counted — and never the model's words.
 */

const PARAGRAPHS = [
  'Forty-two households in three districts of rural Karnataka were interviewed between March and June 2021, chosen from installer enquiry lists so that every one of them had at least considered rooftop solar before.',
  'Upfront cost was named first by most households that stopped, but the interviews show that the fourteen-week wait for the subsidy payment mattered more than its size, because families had to borrow for the whole amount.',
  'Trust in the installer decided more cases than price did: where no installer kept a local service presence, households that had enquired rarely went ahead, whatever subsidy they were offered by the state.',
  'The study therefore argues that faster disbursement and a local service presence would do more for adoption than a larger subsidy, although the sample is small and drawn only from households that enquired.',
];

test('a student is asked about their own thesis and gets feedback on an answer', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const session = await establishSession(request, freshEmail('viva'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);

  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Viva ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };
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

  await page.goto(`/app/d/${doc.id}/submit`);
  await page.getByTestId('open-viva').click();
  // The first visit compiles the route in the dev server.
  await expect(page).toHaveURL(new RegExp(`/app/d/${doc.id}/viva$`), { timeout: 60_000 });
  await expect(page.getByTestId('viva-left')).toContainText('3 of 3 viva uses left', {
    timeout: 20_000,
  });

  await page.getByTestId('viva-ask').click();
  const questions = page.getByTestId('viva-question');
  await expect(questions.first()).toBeVisible({ timeout: 120_000 });
  expect(await questions.count()).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('viva-left')).toContainText('2 of 3');

  const first = questions.first();
  await first
    .getByTestId('viva-answer')
    .fill(
      'We used the installer enquiry lists because every household on them had considered solar, so they could tell us why they stopped. It does mean we never hear from households that did not enquire, which limits how far the findings travel.',
    );
  await first.getByTestId('viva-submit').click();
  const feedback = first.getByTestId('viva-feedback');
  await expect(feedback).toBeVisible({ timeout: 120_000 });
  await expect(feedback).toContainText(/Strong answer|Partly there|Needs work/);
  await expect(page.getByTestId('viva-left')).toContainText('1 of 3');
  await page.screenshot({ path: 'test-results/viva.png', fullPage: true });

  // The thesis is untouched: nothing here writes to a chapter.
  const chapter = (await (
    await request.get(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, { headers: { cookie } })
  ).json()) as { version: number };
  expect(chapter.version).toBe(2);
});
