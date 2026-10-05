import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type BrowserContext, chromium, expect, type Page, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The Chrome add-on (ADR-0031, ADR-0069), loaded unpacked into a real Chromium against the API.
 *
 * Article and results pages are served from fixture hosts; the add-on reads the paper (or the
 * results), lists the student's theses and collections with the student's own session cookie,
 * and saves through the library's own routes. Chrome's toolbar cannot be clicked from a test, so
 * the popup is opened as a page and told which tab to read, and the test build may read the
 * fixture hosts without the click (`--extra-host`); the production build may not.
 *
 * What this does not prove: that `activeTab` alone lets the service worker download a PDF from
 * the tab's site (the test build has host permission for the fixture server), and Chrome's own
 * PDF viewer (the fixture serves the .pdf address as a page and the file to the add-on's fetch).
 */

const WEB_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const FIXTURE = 'https://journals.example.org';
const ARTICLE = `${FIXTURE}/articles/deep-learning`;
const NEWS = `${FIXTURE}/news/a-story`;
const ARXIV_LIST = 'https://arxiv.org/list/cs.CL/recent';
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

// arXiv's listing markup (ADR-0069, observed 2026-10-05), with invented papers.
const arxivEntry = (id: string, title: string) => `<dt><span>[1]</span>
<a href="/abs/${id}" title="Abstract" id="${id}">arXiv:${id}</a></dt>
<dd><div class="meta"><div class="list-title mathjax"><span class="descriptor">Title:</span> ${title}</div>
<div class="list-authors"><a href="https://arxiv.org/a/x">A Author</a></div></div></dd>`;
const stamp = Date.now() % 100000;
const ARXIV_IDS = [0, 1, 2].map((n) => `2601.${String(stamp + n).padStart(5, '0')}`);
const ARXIV_HTML = `<!doctype html><html><head><title>Computation and Language</title></head><body>
<dl id="articles">${ARXIV_IDS.map((id, n) => arxivEntry(id, `Fixture paper ${n}`)).join('')}</dl></body></html>`;

/** A one-page PDF: enough for the upload's `%PDF-` check. */
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

let context: BrowserContext;
let extensionId = '';
let server: Server;
let pdfUrl = '';

/** Only what the test calls; the web app has no reason to depend on `@types/chrome`. */
type ChromeTabs = { tabs: { query(filter: { url: string }): Promise<Array<{ id?: number }>> } };

async function openPopupFor(url: string): Promise<Page> {
  const tab = await context.newPage();
  await tab.goto(url);
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
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
  // The PDF's site: the address is a page to the tab, and the file to the add-on's own request.
  server = createServer((request, response) => {
    if (request.headers['sec-fetch-dest'] === 'document') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<!doctype html><title>paper.pdf</title><p>A PDF viewer stands here.</p>');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/pdf', 'content-length': PDF.length });
    response.end(PDF);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  pdfUrl = `http://127.0.0.1:${port}/files/groundwater-recharge.pdf`;

  const out = mkdtempSync(join(tmpdir(), 'tc-extension-'));
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
      '--extra-host',
      `${FIXTURE}/*`,
      '--extra-host',
      'https://arxiv.org/*',
      '--extra-host',
      `http://127.0.0.1:${port}/*`,
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
  await context.route('https://arxiv.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: ARXIV_HTML }),
  );
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
});

type Source = { id: string; doi: string | null; hasFile: boolean; collectionIds: string[] };

test.describe
  .serial('signed in', () => {
    let cookie = '';
    const titles = [`Extension ${Date.now()}`, `Another thesis ${Date.now()}`];
    const created: Array<{ id: string }> = [];
    let collectionId = '';

    const library = async (request: import('@playwright/test').APIRequestContext, id: string) =>
      (await (
        await request.get(`${API_URL}/api/v1/documents/${id}/sources`, { headers: { cookie } })
      ).json()) as Source[];

    test.beforeAll(async ({ playwright }) => {
      const request = await playwright.request.newContext();
      const session = await establishSession(request, freshEmail('extension'));
      cookie = `${session.cookieName}=${session.cookieValue}`;
      await context.addCookies([
        { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
      ]);
      for (const title of titles) {
        const response = await request.post(`${API_URL}/api/v1/documents`, {
          headers: { cookie },
          data: { title, entryPath: 'A_TOPIC' },
        });
        created.push((await response.json()) as { id: string });
      }
      const collection = await request.post(
        `${API_URL}/api/v1/documents/${created[0]?.id}/collections`,
        { headers: { cookie }, data: { name: 'Chapter 2' } },
      );
      collectionId = ((await collection.json()) as { id: string }).id;
      await request.dispose();
    });

    test('saves the paper on the page into the chosen thesis and collection, once', async ({
      request,
    }) => {
      test.setTimeout(120_000);
      const target = created[0] as { id: string };

      const popup = await openPopupFor(ARTICLE);
      const paper = popup.getByTestId('paper');
      await expect(paper).toContainText('Deep learning');
      // The article's own DOI, not the one in its reference list or its text.
      await expect(paper).toContainText(`DOI ${DOI}`);
      await popup.getByTestId('thesis').selectOption(target.id);
      await expect(popup.getByTestId('collection')).toContainText('Chapter 2');
      await popup.getByTestId('collection').selectOption(collectionId);
      await popup.getByTestId('add').click();
      await expect(popup.getByTestId('message')).toContainText(`Saved to “${titles[0]}”`);
      await expect(popup.getByTestId('message')).toContainText('Filed in “Chapter 2”');

      const sources = (await library(request, target.id)).filter(
        (s) => s.doi?.toLowerCase() === DOI,
      );
      expect(sources).toHaveLength(1);
      const saved = sources[0] as Source;
      expect(saved.collectionIds).toContain(collectionId);
      // "Open in Thesis Copilot" goes to the paper in the reader.
      await expect(popup.getByTestId('open-source')).toHaveAttribute(
        'data-href',
        `${WEB_URL}/app/d/${target.id}/sources/${saved.id}`,
      );

      // Again: the thesis is remembered, and the paper is not saved twice.
      const again = await openPopupFor(ARTICLE);
      await expect(again.getByTestId('thesis')).toHaveValue(target.id);
      await expect(again.getByTestId('collection')).toHaveValue(collectionId);
      await again.getByTestId('add').click();
      await expect(again.getByTestId('message')).toContainText(
        `Already in the library of “${titles[0]}”`,
      );
      await expect(again.getByTestId('open-source')).toHaveAttribute(
        'data-href',
        `${WEB_URL}/app/d/${target.id}/sources/${saved.id}`,
      );
      expect(
        (await library(request, target.id)).filter((s) => s.doi?.toLowerCase() === DOI),
      ).toHaveLength(1);
    });

    test('saves the ticked papers of a results page, each once', async ({ request }) => {
      const target = created[1] as { id: string };
      const popup = await openPopupFor(ARXIV_LIST);
      await expect(popup.getByTestId('result')).toHaveCount(3);
      await popup.getByTestId('thesis').selectOption(target.id);
      await expect(popup.getByTestId('save-many')).toBeDisabled();
      await popup.getByTestId('select-all').click();
      await expect(popup.getByTestId('save-many')).toHaveText('Save (3)');
      await popup.getByTestId('save-many').click();
      await expect(popup.getByTestId('message')).toContainText('3 saved');
      await expect(popup.getByTestId('result').filter({ hasText: 'Saved' })).toHaveCount(3);

      const dois = (await library(request, target.id)).map((s) => s.doi?.toLowerCase());
      for (const id of ARXIV_IDS) expect(dois).toContain(`10.48550/arxiv.${id}`);

      // The same page again: every paper is already there.
      const again = await openPopupFor(ARXIV_LIST);
      await again.getByTestId('thesis').selectOption(target.id);
      await again.getByTestId('select-all').click();
      await again.getByTestId('save-many').click();
      await expect(again.getByTestId('message')).toContainText('3 already in the library');
      expect(await library(request, target.id)).toHaveLength(3);
    });

    test('saves a PDF tab as the file itself', async ({ request }) => {
      const target = created[1] as { id: string };
      const before = (await library(request, target.id)).length;
      const popup = await openPopupFor(pdfUrl);
      await expect(popup.getByTestId('paper')).toContainText('the PDF itself will be saved');
      await popup.getByTestId('thesis').selectOption(target.id);
      await popup.getByTestId('add').click();
      await expect(popup.getByTestId('message')).toContainText(`Saved to “${titles[1]}”`);
      await expect(popup.getByTestId('message')).toContainText('The PDF is attached');
      const after = await library(request, target.id);
      expect(after).toHaveLength(before + 1);
      expect(after.filter((s) => s.hasFile)).toHaveLength(1);
    });
  });

test('says so when the page is not a paper, or the student is signed out', async () => {
  const news = await openPopupFor(NEWS);
  await expect(news.getByTestId('message')).toContainText('Open a paper’s own page');

  await context.clearCookies();
  const signedOut = await openPopupFor(ARTICLE);
  await expect(signedOut.getByTestId('message')).toContainText('Sign in to Thesis Copilot');
  await expect(signedOut.getByTestId('open-site')).toHaveAttribute(
    'data-href',
    `${WEB_URL}/sign-in`,
  );
});
