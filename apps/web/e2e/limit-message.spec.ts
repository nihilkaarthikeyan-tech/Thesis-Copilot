import { expect, type Page, test } from '@playwright/test';
import { setAllowanceUsed } from './_db.js';
import { measureLayout } from './_layout.js';
import { API_URL, establishSession, freshEmail, type Session } from './_session.js';

/**
 * R31 (ADR-0122): an action an allowance refuses says so the same way on every screen — which
 * allowance, how many used of how many, the reset date in the browser's own calendar, and a link
 * to the usage table — and the message fits where it is drawn: the editor's 288 px side panel
 * and a 390 px phone.
 *
 * The allowance is used up by writing the ledger row directly (`_db.ts`), so no unit is spent and
 * no model is called: every refusal here happens before the provider. Needs the dev stack (web,
 * API, Compose); runs on the mock.
 */

test.describe.configure({ mode: 'serial' });

let session: Session;
let cookie = '';
let doc: { id: string; firstChapterId: string };

/** The FREE_TRIAL caps a fresh account starts on (PRD §11.3). */
// ADR-0152 (Option B): ten of each on the trial.
const TRIAL = { PROOFREAD: 10, CHAT: 10 } as const;

const CHAPTER = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Findings' }] },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'The farmers recieved the subsidy late in the season, after planting had begun.',
        },
      ],
    },
  ],
};

async function signIn(page: Page) {
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
}

/** Layout faults that involve the limit message: it sticking out, or being cut off. */
async function limitFaults(page: Page) {
  const faults = await page.evaluate(measureLayout, false);
  return faults.filter(
    (f) =>
      f.kind === 'page wider than window' ||
      f.el?.includes('limit-notice') ||
      f.box?.includes('limit-notice'),
  );
}

test.beforeAll(async ({ request }) => {
  test.setTimeout(120_000);
  session = await establishSession(request, freshEmail('limit-message'));
  cookie = `${session.cookieName}=${session.cookieValue}`;
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Limits ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  doc = (await created.json()) as { id: string; firstChapterId: string };
  const chapter = (await (
    await request.get(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, { headers: { cookie } })
  ).json()) as { version: number };
  const saved = await request.put(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
    headers: { cookie },
    data: { content: CHAPTER, baseVersion: chapter.version },
  });
  expect(saved.ok(), `save: ${saved.status()}`).toBe(true);
});

test('the Check tab: a proofread past the allowance names it, the count and the trial’s end', async ({
  page,
}) => {
  test.setTimeout(120_000);
  // ADR-0152: proofreading has its own allowance.
  await setAllowanceUsed(session.email, 'PROOFREAD', TRIAL.PROOFREAD);
  await signIn(page);
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
  await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'check' }).click();

  const panel = page.getByTestId('proofread-panel');
  await panel.getByTestId('proofread-run').click();
  const notice = panel.getByTestId('limit-notice');
  await expect(notice).toBeVisible({ timeout: 20_000 });
  await expect(notice).toHaveAttribute('data-kind', 'cap');
  // ADR-0152: a trial's allowance is for the whole trial and ends with it, not on the 1st.
  await expect(notice).toContainText('Trial limit reached');
  await expect(notice).toContainText(
    `Proofreading runs: ${TRIAL.PROOFREAD} of ${TRIAL.PROOFREAD} used in your free trial`,
  );
  await expect(notice).toContainText(/your trial ends on .*\d{4}/);
  await expect(notice).not.toContainText('Resets on');
  await expect(notice.getByTestId('limit-notice-link')).toHaveAttribute('href', '/pricing');

  // Inside the 288 px side panel, and nothing in it sticks out.
  const side = await page.getByTestId('tool-panel').boundingBox();
  const box = await notice.boundingBox();
  expect(side && box).toBeTruthy();
  if (side && box) {
    expect(box.x).toBeGreaterThanOrEqual(side.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(side.x + side.width + 1);
  }
  expect(await limitFaults(page)).toEqual([]);

  // The same refusal again is the same message, not a second one stacked under it.
  await panel.getByTestId('proofread-run').click();
  await expect(panel.getByTestId('limit-notice')).toHaveCount(1);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a question to the library past the allowance says the same, inside the screen', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await setAllowanceUsed(session.email, 'CHAT', TRIAL.CHAT);
    await signIn(page);
    await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
    await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('mobile-bar').getByTestId('mobile-chat').click();
    const chat = page.getByTestId('chat-panel');
    await expect(chat).toBeVisible();
    await chat.getByRole('textbox').fill('What did the farmers say about the subsidy?');
    await chat.getByRole('button', { name: 'Ask', exact: true }).click();

    const notice = chat.getByTestId('limit-notice');
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).toContainText(`Questions to your library: ${TRIAL.CHAT} of ${TRIAL.CHAT}`);
    await expect(notice).toContainText(/your trial ends on .*\d{4}/);
    await expect(notice.getByTestId('limit-notice-link')).toHaveAttribute('href', '/pricing');

    const box = await notice.boundingBox();
    expect(box).toBeTruthy();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
    expect(await limitFaults(page)).toEqual([]);
  });
});
