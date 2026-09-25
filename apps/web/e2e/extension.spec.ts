import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type BrowserContext, chromium, expect, type Page, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The Chrome add-on (ADR-0031), loaded into a real Chromium against the dev stack.
 *
 * A journal's article page is served from a fixture host, the add-on reads the paper from its
 * Google Scholar tags, lists the student's theses from the API with the student's own session
 * cookie, and adds the paper through the library's resolve route. Chrome's toolbar cannot be
 * clicked from a test, so the popup is opened as a page and told which tab to read, and the test
 * build may read the fixture host without the click (`--extra-host`); the production build may not.
 */

const FIXTURE = 'https://journals.example.org';
const ARTICLE = `${FIXTURE}/articles/deep-learning`;
const NEWS = `${FIXTURE}/news/a-story`;
const DOI = '10.1038/nature14539';

const ARTICLE_HTML = `<!doctype html><html><head><title>Deep learning | Nature</title>
<meta name="citation_title" content="Deep learning">
<meta name="citation_author" content="LeCun, Yann">
<meta name="citation_author" content="Bengio, Yoshua">
<meta name="citation_author" content="Hinton, Geoffrey">
<meta name="citation_journal_title" content="Nature">
<meta name="citation_publication_date" content="2015/05/28">
<meta name="citation_doi" content="${DOI}">
<meta name="citation_reference" content="citation_doi=10.1000/not.this.one">
</head><body><h1>Deep learning</h1><p>Cites 10.1000/not.this.one in its text.</p></body></html>`;

const NEWS_HTML = `<!doctype html><html><head><title>Scientists find something</title>
<meta property="og:title" content="Scientists find something"></head><body>News.</body></html>`;

let context: BrowserContext;
let extensionId = '';

/** Only what the test calls; the web app has no reason to depend on `@types/chrome`. */
type ChromeTabs = { tabs: { query(filter: { url: string }): Promise<Array<{ id?: number }>> } };

async function openPopupFor(url: string): Promise<Page> {
  const tab = await context.newPage();
  await tab.goto(url);
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 420 });
  // Asked from an extension page rather than the service worker, which Chrome stops when idle.
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const tabId = await popup.evaluate(async (target) => {
    const { chrome } = globalThis as unknown as { chrome: ChromeTabs };
    return (await chrome.tabs.query({ url: target }))[0]?.id;
  }, url);
  if (!tabId) throw new Error(`no tab found for ${url}`);
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  return popup;
}

test.beforeAll(async () => {
  const out = mkdtempSync(join(tmpdir(), 'tc-extension-'));
  execFileSync(
    process.execPath,
    [
      resolve(__dirname, '../../extension/scripts/build.mjs'),
      '--target',
      'development',
      '--out',
      out,
      '--extra-host',
      `${FIXTURE}/*`,
    ],
    { stdio: 'inherit' },
  );
  // `channel: 'chromium'` is the full browser, whose headless mode runs extensions; the default
  // headless shell does not.
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${out}`, `--load-extension=${out}`],
  });
  await context.route(`${FIXTURE}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: route.request().url().startsWith(NEWS) ? NEWS_HTML : ARTICLE_HTML,
    }),
  );
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
});

test('adds the paper on the page to the thesis the student picks, once', async ({ request }) => {
  test.setTimeout(120_000);
  const session = await establishSession(request, freshEmail('extension'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await context.addCookies([
    { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
  ]);
  const titles = [`Extension ${Date.now()}`, `Another thesis ${Date.now()}`];
  const created: Array<{ id: string }> = [];
  for (const title of titles) {
    const response = await request.post(`${API_URL}/api/v1/documents`, {
      headers: { cookie },
      data: { title, entryPath: 'A_TOPIC' },
    });
    created.push((await response.json()) as { id: string });
  }
  const target = created[0] as { id: string };

  const popup = await openPopupFor(ARTICLE);
  const paper = popup.getByTestId('paper');
  await expect(paper).toContainText('Deep learning');
  // The article's own DOI, not the one in its reference list or its text.
  await expect(paper).toContainText(`DOI ${DOI}`);
  await popup.getByTestId('thesis').selectOption(target.id);
  await popup.getByTestId('add').click();
  await expect(popup.getByTestId('message')).toContainText(`Added to “${titles[0]}”`);
  await expect(popup.getByTestId('open-site')).toHaveAttribute(
    'data-href',
    `http://localhost:3000/app/d/${target.id}/sources`,
  );
  await popup.screenshot({ path: 'test-results/extension-added.png' });

  const sources = (await (
    await request.get(`${API_URL}/api/v1/documents/${target.id}/sources`, { headers: { cookie } })
  ).json()) as Array<{ doi: string | null }>;
  expect(sources.filter((s) => s.doi?.toLowerCase() === DOI)).toHaveLength(1);

  // Again: the thesis it was added to is remembered, and the paper is not added twice.
  const again = await openPopupFor(ARTICLE);
  await expect(again.getByTestId('thesis')).toHaveValue(target.id);
  await again.getByTestId('add').click();
  await expect(again.getByTestId('message')).toContainText(
    `Already in the library of “${titles[0]}”`,
  );
  const after = (await (
    await request.get(`${API_URL}/api/v1/documents/${target.id}/sources`, { headers: { cookie } })
  ).json()) as Array<{ doi: string | null }>;
  expect(after.filter((s) => s.doi?.toLowerCase() === DOI)).toHaveLength(1);
});

test('says so when the page is not a paper, or the student is signed out', async () => {
  const news = await openPopupFor(NEWS);
  await expect(news.getByTestId('message')).toContainText('No paper found on this page');

  await context.clearCookies();
  const signedOut = await openPopupFor(ARTICLE);
  await expect(signedOut.getByTestId('message')).toContainText('Sign in to Thesis Copilot');
  await expect(signedOut.getByTestId('open-site')).toHaveAttribute(
    'data-href',
    'http://localhost:3000/sign-in',
  );
});
