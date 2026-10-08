import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type BrowserContext, chromium, expect, type Page, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The add-on's in-page buttons (ADR-0125), loaded unpacked into a real Chromium against the API.
 *
 * Google Scholar, PubMed, arXiv and MDPI are never contacted: `context.route` answers their
 * addresses with the add-on's hand-written structural fixtures (`apps/extension/test/fixtures`),
 * so the content script runs on the real host names it is declared for. The development build is
 * made with `--open-shadow`, so the test can read the card; the production build keeps the
 * shadow roots closed.
 *
 * The papers in the fixtures are invented, so the library's lookup finds no record for them and
 * the card saves them by their details — the path a real but unknown DOI takes. That a real DOI
 * goes in through `import-id` is pinned by the unit tests (`save-one.spec.ts`), not here.
 */

const WEB_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const FIXTURES = resolve(__dirname, '../../extension/test/fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

const MDPI_ARTICLE = 'https://www.mdpi.com/1660-0000/14/12/1570';
const MDPI_ISSUE = 'https://www.mdpi.com/1660-0000/14/12';
const SCHOLAR = 'https://scholar.google.com/scholar?q=groundwater';
const ARXIV_LIST = 'https://arxiv.org/list/cs.CL/recent';
const MDPI_DOI = '10.5555/ojgs14121570';

let context: BrowserContext;

const PAGES: Record<string, string> = {
  [MDPI_ARTICLE]: 'mdpi-article.html',
  [MDPI_ISSUE]: 'mdpi-issue.html',
  [SCHOLAR]: 'scholar-buttons.html',
  [ARXIV_LIST]: 'arxiv-list.html',
};

test.beforeAll(async () => {
  const out = mkdtempSync(join(tmpdir(), 'tc-extension-inpage-'));
  execFileSync(
    process.execPath,
    [
      resolve(__dirname, '../../extension/scripts/build.mjs'),
      '--target',
      'development',
      '--api',
      API_URL,
      '--web',
      WEB_URL,
      '--out',
      out,
      '--open-shadow',
    ],
    { stdio: 'inherit' },
  );
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${out}`, `--load-extension=${out}`],
  });
  for (const host of ['https://www.mdpi.com', 'https://scholar.google.com', 'https://arxiv.org']) {
    await context.route(`${host}/**`, (route) => {
      const name = PAGES[route.request().url()];
      return name
        ? route.fulfill({ status: 200, contentType: 'text/html', body: fixture(name) })
        : route.fulfill({ status: 404, contentType: 'text/plain', body: 'not in this test' });
    });
  }
  // The service worker must be up before a content script asks it anything.
  if (!context.serviceWorkers()[0]) await context.waitForEvent('serviceworker');
});

test.afterAll(async () => {
  await context?.close();
});

const buttons = (page: Page) => page.getByTestId('tc-add');

async function open(url: string, width = 1280): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 900 });
  await page.goto(url);
  return page;
}

/** Nothing the add-on put in makes the page scroll sideways, and the card is inside the window. */
async function expectNoOverflow(page: Page): Promise<void> {
  const sizes = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.inner);
  const card = page.getByTestId('tc-card');
  if (await card.count()) {
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(sizes.inner);
    }
  }
}

test.describe
  .serial('signed in', () => {
    let cookie = '';
    let thesisId = '';
    const title = `In-page ${Date.now()}`;

    test.beforeAll(async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const session = await establishSession(request, freshEmail('extension-inpage'));
      cookie = `${session.cookieName}=${session.cookieValue}`;
      await context.addCookies([
        { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
      ]);
      const response = await request.post(`${API_URL}/api/v1/documents`, {
        headers: { cookie },
        data: { title, entryPath: 'A_TOPIC' },
      });
      thesisId = ((await response.json()) as { id: string }).id;
      await request.dispose();
    });

    const library = async (request: import('@playwright/test').APIRequestContext) =>
      (await (
        await request.get(`${API_URL}/api/v1/documents/${thesisId}/sources`, {
          headers: { cookie },
        })
      ).json()) as Array<{ id: string; doi: string | null }>;

    test('an MDPI article: one button beside its DOI, and the article saved once', async ({
      request,
    }) => {
      test.setTimeout(120_000);
      const page = await open(MDPI_ARTICLE);
      await expect(buttons(page)).toHaveCount(1);
      // Beside the article's own DOI link in its header, not a reference's.
      const host = page.locator('.bib-identity [data-tc-addon="button"]');
      await expect(host).toHaveCount(1);
      await buttons(page).click();
      const card = page.getByTestId('tc-card');
      await expect(card).toBeVisible();
      await expect(page.getByTestId('tc-paper')).toContainText(
        'Groundwater Recharge in Hard-Rock Aquifers of South India',
      );
      await expect(page.getByTestId('tc-paper')).toContainText(`DOI ${MDPI_DOI}`);
      await expect(page.getByTestId('tc-facts')).toContainText('Found on this page');
      await page.getByTestId('tc-thesis').selectOption(thesisId);
      await expect(page.getByTestId('tc-save')).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId('tc-save').click();
      await expect(page.getByTestId('tc-message')).toContainText(`Saved to “${title}”`, {
        timeout: 60_000,
      });
      await expect(buttons(page)).toHaveText('Saved to Thesis Copilot');
      const saved = (await library(request)).filter((s) => s.doi?.toLowerCase() === MDPI_DOI);
      expect(saved).toHaveLength(1);
      await expect(page.getByTestId('tc-open-source')).toHaveAttribute(
        'href',
        `${WEB_URL}/app/d/${thesisId}/sources/${saved[0]?.id}`,
      );
      await page.keyboard.press('Escape');
      await expect(card).toHaveCount(0);

      // Again: already there, not a second row.
      const again = await open(MDPI_ARTICLE);
      await buttons(again).click();
      await expect(again.getByTestId('tc-save')).toBeEnabled({ timeout: 30_000 });
      await again.getByTestId('tc-save').click();
      await expect(again.getByTestId('tc-message')).toContainText('Already in the library', {
        timeout: 60_000,
      });
      expect(
        (await library(request)).filter((s) => s.doi?.toLowerCase() === MDPI_DOI),
      ).toHaveLength(1);
    });

    test('an MDPI issue’s contents: no button at all', async () => {
      const page = await open(MDPI_ISSUE);
      await page.waitForTimeout(1_000);
      await expect(buttons(page)).toHaveCount(0);
    });

    test('Google Scholar: a button on every result; one without an identifier saved by title', async ({
      request,
    }) => {
      test.setTimeout(120_000);
      const page = await open(SCHOLAR);
      await expect(buttons(page)).toHaveCount(4);
      await expect(page.locator('.gs_flb [data-tc-addon="button"]')).toHaveCount(3);
      const before = (await library(request)).length;
      await buttons(page).nth(3).click();
      await expect(page.getByTestId('tc-paper')).toContainText('No DOI on this result');
      await page.getByTestId('tc-thesis').selectOption(thesisId);
      await page.getByTestId('tc-save').click();
      await expect(page.getByTestId('tc-message')).toContainText(`Saved to “${title}”`, {
        timeout: 60_000,
      });
      expect(await library(request)).toHaveLength(before + 1);
    });

    test('an arXiv listing: one button per paper', async () => {
      const page = await open(ARXIV_LIST);
      await expect(buttons(page)).toHaveCount(3);
      await expect(page.locator('dt [data-tc-addon="button"]')).toHaveCount(3);
    });

    test('nothing overflows at 390 and 1440 px, with the card open', async () => {
      for (const width of [390, 1440]) {
        for (const url of [MDPI_ARTICLE, SCHOLAR]) {
          const page = await open(url, width);
          await expect(buttons(page).first()).toBeVisible();
          await expectNoOverflow(page);
          await buttons(page).first().click();
          await expect(page.getByTestId('tc-card')).toBeVisible();
          await expectNoOverflow(page);
          await page.close();
        }
      }
    });
  });

test('signed out, the card says to sign in', async () => {
  await context.clearCookies();
  const page = await open(MDPI_ARTICLE);
  await buttons(page).click();
  await expect(page.getByTestId('tc-message')).toContainText('Sign in to Thesis Copilot');
  await expect(page.getByTestId('tc-card').locator('a.btn')).toHaveAttribute(
    'href',
    `${WEB_URL}/sign-in`,
  );
});
