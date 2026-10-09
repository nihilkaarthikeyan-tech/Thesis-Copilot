import { expect, test } from '@playwright/test';
import { measureLayout, settle } from '../_layout.js';
import { API_URL, establishSession, freshEmail } from '../_session.js';

/**
 * ADR-0131 on the real models: one examiner review of a three-section chapter, then the Strengths
 * and Questions for the author in the Flags tab at 1280 and in the phone drawer at 390, measured
 * for layout faults. MEASURE=1 only — one real EXAMINER_REVIEW unit.
 */
test.skip(!process.env.MEASURE, 'measurement run');

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const h = (level: number, text: string) => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
});

test('strengths and questions after a real examiner review', async ({ page, request }) => {
  test.setTimeout(600_000);
  const session = await establishSession(request, freshEmail('exam-live'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const doc = (await (
    await request.post(`${API_URL}/api/v1/documents`, {
      headers: { cookie },
      data: { title: 'Solar drying of fish on the Kerala coast', entryPath: 'A_TOPIC' },
    })
  ).json()) as { id: string; firstChapterId: string };
  const saved = await request.put(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
    headers: { cookie },
    data: {
      baseVersion: 1,
      content: {
        type: 'doc',
        content: [
          h(1, 'Introduction'),
          h(2, 'Background'),
          p(
            'Fish drying is the main way small fishers on the Kerala coast preserve their catch between landings and market days.',
          ),
          p(
            'Open sun drying on sand or mats exposes the fish to dust, insects, birds and sudden rain, and spoilage follows.',
          ),
          p(
            'Studies in Kerala estimate that open drying loses between fifteen and twenty-five per cent of the catch every season.',
          ),
          p(
            'Solar cabinet dryers enclose the fish and raise the air temperature, which shortens drying time and keeps contaminants out.',
          ),
          h(2, 'Problem statement'),
          p(
            'Despite their promise, solar dryers remain rare in coastal Kerala villages, and the reasons are poorly documented.',
          ),
          p(
            'Most published trials report moisture curves from a single prototype and ignore the cost, labour and fit with fishing schedules.',
          ),
          p(
            'Without evidence on losses and costs under real village conditions, cooperatives cannot judge whether a dryer would pay for itself.',
          ),
          h(2, 'Aim and objectives'),
          p(
            'This thesis measures the post-harvest losses of three dryer designs against open drying in two fishing villages.',
          ),
          p(
            'It compares drying time, product quality grades and spoilage over two seasons, and estimates the payback period of each design.',
          ),
          p(
            'It also records the drying practices and preferences of the women who do most of the drying.',
          ),
        ],
      },
    },
  });
  expect(saved.ok(), `save: ${saved.status()}`).toBe(true);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'check', exact: true }).click();
  const review = page.getByTestId('examiner-review');
  await review.getByTestId('run-examiner-review').click();
  await expect(review.getByTestId('examiner-review-result')).toContainText('The examiner', {
    timeout: 420_000,
  });
  await settle(page);
  const text = await review.innerText();
  console.log(text.slice(0, 2500));
  await page.screenshot({ path: '../../qa-shots/examiner-highlights-1280.png', fullPage: true });
  expect(await page.evaluate(measureLayout, false)).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('mobile-bar').getByText('check', { exact: false }).first().click();
  await expect(page.getByTestId('examiner-review')).toBeVisible({ timeout: 20_000 });
  await settle(page);
  await page.screenshot({ path: '../../qa-shots/examiner-highlights-390.png', fullPage: true });
  expect(await page.evaluate(measureLayout, false)).toEqual([]);
});
