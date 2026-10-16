/**
 * The add-on 0.4.0 review set — ADR-0156. Real Chromium (Playwright) with the built add-on loaded.
 *
 *   node scripts/review.mjs
 *
 * Writes `docs/design/extension-0.4/`:
 * - `popup-<state>-<light|dark>.png` — the toolbar window in each state: paper found, saving, saved,
 *   no paper, signed out, settings (and a results page, the account menu);
 * - `inline-<site>.png` — the in-page button on Google Scholar, PubMed, an MDPI article (and after
 *   saving) and a Wikipedia reference list;
 * - `fresh-install.json` — the fresh-install check: the production build in a new profile, with no
 *   switch pressed, puts its buttons into pages (and none into Thesis Copilot's own);
 * - `extension-0.4-review.pdf` — all of it, for the owner's approval.
 *
 * Nothing real is contacted. The sites are answered with the add-on's hand-written structural
 * fixtures (`test/fixtures/`, invented papers under Crossref's test prefix 10.5555) through
 * `context.route`, and Thesis Copilot by a stand-in on 127.0.0.1 that answers the add-on's routes
 * as the API would, for an invented student. One browser at a time.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const repo = resolve(root, '..', '..');
const outDir = join(repo, 'docs', 'design', 'extension-0.4');
mkdirSync(outDir, { recursive: true });
const fixture = (name) => readFileSync(join(root, 'test', 'fixtures', name), 'utf8');
const shots = [];

// ---- A stand-in for Thesis Copilot ----------------------------------------------------------------

const PORT = 4317;
const API = `http://127.0.0.1:${PORT}`;
const DOC = '0190a3c4-0000-7000-8000-000000000001';
const COLLECTION = '0190a3c4-0000-7000-8000-000000000002';
const SOURCE = '0190a3c4-0000-7000-8000-000000000003';
const mode = { signedIn: true, slow: false };

const KNOWN = {
  '10.5555/ojgs14121570': {
    kind: 'doi',
    title: 'Groundwater Recharge in Hard-Rock Aquifers of South India',
    authors: [
      { given: 'Kavya', family: 'Raman' },
      { given: 'Sanjay', family: 'Iyer' },
    ],
    year: 2017,
    venue: 'Open Journal of Groundwater Studies',
    doi: '10.5555/ojgs14121570',
    citedBy: 54,
  },
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', API);
  const json = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const path = url.pathname;
  if (!path.startsWith('/api/v1/')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>Thesis Copilot</title><p>Thesis Copilot (stand-in)</p>');
    return;
  }
  if (path === '/api/v1/auth/get-session') {
    return json(
      200,
      mode.signedIn ? { user: { name: 'Asha Kumar', email: 'asha.kumar@example.edu' } } : null,
    );
  }
  if (!mode.signedIn) return json(401, { title: 'Unauthorized' });
  if (path === '/api/v1/documents') {
    return json(200, [
      { id: DOC, title: 'Groundwater recharge in South Indian hard-rock aquifers' },
    ]);
  }
  if (path === `/api/v1/documents/${DOC}/collections`) {
    return json(200, [{ id: COLLECTION, name: 'Chapter 2: Literature', count: 7 }]);
  }
  if (path === `/api/v1/documents/${DOC}/sources` && req.method === 'GET') return json(200, []);
  if (path === `/api/v1/documents/${DOC}/sources/lookup-id`) {
    const q = (url.searchParams.get('q') ?? '').replace(/^doi:/i, '').toLowerCase();
    const found = KNOWN[q];
    return found ? json(200, found) : json(404, { title: 'Not found', detail: 'No record.' });
  }
  const wait = () => new Promise((done) => setTimeout(done, mode.slow ? 6000 : 300));
  if (path === `/api/v1/documents/${DOC}/sources/resolve`) {
    let body = '';
    for await (const chunk of req) body += chunk;
    const references = JSON.parse(body).references ?? [];
    await wait();
    return json(200, { sourceIds: references.map(() => SOURCE) });
  }
  if (path === `/api/v1/documents/${DOC}/sources/import-id`) {
    await wait();
    return json(200, { sourceId: SOURCE, alreadyPresent: false });
  }
  if (path === `/api/v1/collections/${COLLECTION}/sources`) return json(200, { added: 1 });
  return json(404, { title: 'Not in this stand-in' });
});
await new Promise((done) => server.listen(PORT, '127.0.0.1', done));

// ---- The pages ---------------------------------------------------------------------------------------

const PAGES = {
  'https://www.mdpi.com/1660-0000/14/12/1570': fixture('mdpi-article.html'),
  'https://scholar.google.com/scholar?q=groundwater': fixture('scholar-buttons.html'),
  'https://pubmed.ncbi.nlm.nih.gov/33333333/': fixture('pubmed-article.html'),
  'https://pubmed.ncbi.nlm.nih.gov/?term=groundwater': fixture('pubmed-results.html'),
  'https://en.wikipedia.org/wiki/Rooftop_solar_in_villages': fixture('wikipedia-references.html'),
  // Any other journal: the MDPI article's tags, served from a host on no list.
  'https://journals.example.org/article/1570': fixture('mdpi-article.html'),
  'https://www.example.org/': '<!doctype html><title>Example</title><h1>A page with no paper</h1>',
  // Thesis Copilot's own site, with article tags in it: it must get no button.
  'https://thesis.rademics.ai/app/d/x/sources':
    '<!doctype html><title>Library</title><meta name="citation_doi" content="10.5555/ojgs14121570"><meta name="citation_title" content="Groundwater Recharge"><p>Library</p>',
};

async function routePages(context) {
  await context.route(/^https:\/\//, (route) => {
    const body = PAGES[route.request().url()];
    return body
      ? route.fulfill({ status: 200, contentType: 'text/html', body })
      : route.fulfill({ status: 404, contentType: 'text/plain', body: 'not in this review' });
  });
}

async function launch(dir) {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  await routePages(context);
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  return { context, worker, id };
}

const settle = (ms) => new Promise((done) => setTimeout(done, ms));

// ---- 1. The review build: popup states and in-page buttons --------------------------------------

const reviewBuild = mkdtempSync(join(tmpdir(), 'tc-review-'));
execFileSync(
  process.execPath,
  [
    join(root, 'scripts', 'build.mjs'),
    '--target',
    'development',
    '--api',
    API,
    '--web',
    API,
    '--out',
    reviewBuild,
    '--open-shadow',
  ],
  { stdio: 'inherit' },
);

{
  const { context, worker, id } = await launch(reviewBuild);

  async function tabFor(url) {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(url);
    await settle(600);
    const tabId = await worker.evaluate(
      async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id ?? null,
      url,
    );
    return { page, tabId };
  }

  async function popup(tabId, scheme) {
    const page = await context.newPage();
    await page.setViewportSize({ width: 360, height: 640 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`chrome-extension://${id}/popup.html?tab=${tabId}`);
    return page;
  }

  async function shoot(page, name, label) {
    await settle(250);
    const file = `${name}.png`;
    await page.locator('body').screenshot({ path: join(outDir, file), animations: 'disabled' });
    shots.push({ file, label });
  }

  const article = await tabFor('https://www.mdpi.com/1660-0000/14/12/1570');
  const empty = await tabFor('https://www.example.org/');
  const results = await tabFor('https://pubmed.ncbi.nlm.nih.gov/?term=groundwater');

  for (const scheme of ['light', 'dark']) {
    mode.signedIn = true;
    mode.slow = false;

    let p = await popup(article.tabId, scheme);
    await p.getByTestId('add').waitFor();
    await p.getByTestId('collection').locator('option').nth(1).waitFor({ state: 'attached' });
    await shoot(p, `popup-paper-found-${scheme}`, `Paper found (${scheme})`);

    mode.slow = true;
    await p.getByTestId('add').click();
    await p.getByText('Saving…').waitFor();
    await shoot(p, `popup-saving-${scheme}`, `Saving (${scheme})`);
    await p.getByTestId('done').waitFor({ timeout: 15_000 });
    mode.slow = false;
    await shoot(p, `popup-saved-${scheme}`, `Saved (${scheme})`);
    await p.close();

    p = await popup(empty.tabId, scheme);
    await p.getByTestId('empty').waitFor();
    await p.locator('.who-text .name').filter({ hasText: 'Asha' }).waitFor();
    await shoot(p, `popup-no-paper-${scheme}`, `No paper (${scheme})`);
    await p.getByTestId('how').click();
    await shoot(p, `popup-no-paper-how-${scheme}`, `No paper, "How it works" opened (${scheme})`);
    await p.close();

    p = await popup(results.tabId, scheme);
    await p.getByTestId('select-several').waitFor();
    await shoot(p, `popup-results-${scheme}`, `Results page (${scheme})`);
    await p.getByTestId('select-several').click();
    await p.getByTestId('results').waitFor();
    await shoot(p, `popup-results-several-${scheme}`, `Results page, Select several (${scheme})`);
    await p.close();

    p = await popup(article.tabId, scheme);
    await p.getByTestId('add').waitFor();
    await p.getByTestId('more').click();
    await p.getByTestId('menu').waitFor();
    await shoot(p, `popup-menu-${scheme}`, `Account menu (${scheme})`);
    await p.keyboard.press('Escape');
    await p.getByTestId('settings-toggle').click();
    await p.getByTestId('settings').waitFor();
    await shoot(p, `popup-settings-${scheme}`, `Settings (${scheme})`);
    await p.close();

    mode.signedIn = false;
    p = await popup(article.tabId, scheme);
    await p.getByTestId('sign-in').waitFor();
    await shoot(p, `popup-signed-out-${scheme}`, `Signed out (${scheme})`);
    await p.close();
    mode.signedIn = true;
  }
  await article.page.close();
  await empty.page.close();
  await results.page.close();

  // The in-page buttons, on four sites. The review build opens the shadow roots, so the button
  // can be pressed here; the production build keeps them closed.
  async function inline(url, name, label, { save = false, height = 800 } = {}) {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height });
    await page.goto(url);
    const button = page.getByTestId('tc-add').first();
    await button.waitFor({ timeout: 10_000 });
    await button.scrollIntoViewIfNeeded();
    await settle(400);
    const sizes = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    if (sizes.scroll > sizes.inner) throw new Error(`${name}: the page scrolls sideways`);
    await page.screenshot({ path: join(outDir, `${name}.png`) });
    shots.push({ file: `${name}.png`, label });
    const box = await button.boundingBox();
    if (box) {
      const clip = {
        x: Math.max(0, box.x - 260),
        y: Math.max(0, box.y - 70),
        width: Math.min(640, 1280 - Math.max(0, box.x - 260)),
        height: 170,
      };
      await page.screenshot({ path: join(outDir, `${name}-close.png`), clip });
      shots.push({ file: `${name}-close.png`, label: `${label}, close up`, small: true });
    }
    if (save) {
      await button.click();
      await page
        .getByTestId('tc-card')
        .getByRole('button', { name: 'Save to Thesis Copilot' })
        .click();
      await page.getByTestId('tc-card').getByText('Open in Thesis Copilot').first().waitFor();
      await settle(300);
      await page.screenshot({ path: join(outDir, `${name}-saved.png`) });
      shots.push({ file: `${name}-saved.png`, label: `${label}, after saving` });
      await page.getByTestId('tc-close').click();
      await settle(200);
      const after = await button.boundingBox();
      if (after) {
        await page.screenshot({
          path: join(outDir, `${name}-saved-close.png`),
          clip: {
            x: Math.max(0, after.x - 260),
            y: Math.max(0, after.y - 70),
            width: Math.min(640, 1280 - Math.max(0, after.x - 260)),
            height: 170,
          },
        });
        shots.push({
          file: `${name}-saved-close.png`,
          label: `${label}: the button says "Saved"`,
          small: true,
        });
      }
    }
    await page.close();
  }

  await inline(
    'https://scholar.google.com/scholar?q=groundwater',
    'inline-scholar',
    'Google Scholar results',
  );
  await inline('https://pubmed.ncbi.nlm.nih.gov/33333333/', 'inline-pubmed', 'PubMed article');
  await inline('https://www.mdpi.com/1660-0000/14/12/1570', 'inline-mdpi', 'MDPI article', {
    save: true,
  });
  await inline(
    'https://en.wikipedia.org/wiki/Rooftop_solar_in_villages',
    'inline-wikipedia',
    'Wikipedia references',
  );
  await context.close();
}

// ---- 2. The fresh-install check: the production build, a new profile, no switch pressed ---------

const prodBuild = mkdtempSync(join(tmpdir(), 'tc-fresh-'));
execFileSync(
  process.execPath,
  [join(root, 'scripts', 'build.mjs'), '--out', prodBuild, '--no-zip'],
  {
    stdio: 'inherit',
  },
);
const fresh = {};
{
  const { context, worker } = await launch(prodBuild);
  fresh.version = await worker.evaluate(() => chrome.runtime.getManifest().version);
  fresh.storedSettings = await worker.evaluate(() => chrome.storage.local.get(null));
  fresh.everySiteGranted = await worker.evaluate(() =>
    chrome.permissions.contains({ origins: ['https://*/*'] }),
  );
  const count = async (url) => {
    const page = await context.newPage();
    await page.goto(url);
    await settle(1500);
    // The production build keeps the buttons' shadow roots closed: count their hosts.
    const n = await page.locator('[data-tc-addon="button"]').count();
    await page.close();
    return n;
  };
  fresh.buttons = {
    'MDPI article (one of the five sites)': await count(
      'https://www.mdpi.com/1660-0000/14/12/1570',
    ),
    'A journal on no list (its citation tags)': await count(
      'https://journals.example.org/article/1570',
    ),
    'Wikipedia references': await count('https://en.wikipedia.org/wiki/Rooftop_solar_in_villages'),
    'A page with no paper': await count('https://www.example.org/'),
    'Thesis Copilot itself': await count('https://thesis.rademics.ai/app/d/x/sources'),
  };
  await context.close();
  const b = fresh.buttons;
  fresh.passed =
    fresh.everySiteGranted === true &&
    Object.keys(fresh.storedSettings).length === 0 &&
    b['MDPI article (one of the five sites)'] > 0 &&
    b['A journal on no list (its citation tags)'] > 0 &&
    b['Wikipedia references'] > 0 &&
    b['A page with no paper'] === 0 &&
    b['Thesis Copilot itself'] === 0;
  writeFileSync(join(outDir, 'fresh-install.json'), `${JSON.stringify(fresh, null, 2)}\n`);
  console.log('Fresh install:', JSON.stringify(fresh));
}
server.close();

// ---- 3. The review PDF ---------------------------------------------------------------------------------

const img = (file) =>
  `data:image/png;base64,${readFileSync(join(outDir, file)).toString('base64')}`;
const pair = (name, label) => `
  <figure class="pair"><figcaption>${label}</figcaption>
    <div class="row"><img src="${img(`popup-${name}-light.png`)}"><img src="${img(`popup-${name}-dark.png`)}"></div>
  </figure>`;
const freshRows = Object.entries(fresh.buttons)
  .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
  .join('');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Satoshi;src:url(data:font/woff2;base64,${readFileSync(join(root, 'static', 'fonts', 'Satoshi-Regular.woff2')).toString('base64')}) format("woff2");font-weight:400}
@font-face{font-family:Satoshi;src:url(data:font/woff2;base64,${readFileSync(join(root, 'static', 'fonts', 'Satoshi-Bold.woff2')).toString('base64')}) format("woff2");font-weight:700}
@page{size:A4;margin:16mm 14mm}
body{font:12px/1.5 Satoshi,system-ui,sans-serif;color:#0f1724}
h1{font-size:20px;margin:0 0 4px} h2{font-size:14px;margin:18px 0 8px;page-break-after:avoid}
p{margin:0 0 6px;color:#3a4558} .pair{margin:0 0 14px;page-break-inside:avoid}
figcaption{font-weight:700;margin-bottom:6px} .row{display:flex;gap:14px;align-items:flex-start}
.row img{width:300px;border:1px solid #cbd3de;border-radius:10px}
.wide{width:100%;border:1px solid #cbd3de;border-radius:6px;margin-bottom:6px}
.close{width:70%;border:1px solid #cbd3de;border-radius:6px}
.site{page-break-inside:avoid;margin-bottom:14px}
table{border-collapse:collapse;margin:6px 0} td{border:1px solid #cbd3de;padding:4px 8px}
.pass{color:#1d7a4b;font-weight:700} .fail{color:#b42318;font-weight:700}
</style></head><body>
<h1>Thesis Copilot for Chrome 0.4.0 — for review</h1>
<p>ADR-0156. Real Chromium with the built add-on loaded; the sites are answered with hand-written
fixtures and Thesis Copilot by a local stand-in, so every paper, person and DOI is invented
(10.5555 is Crossref's test prefix). Nothing has been shipped or submitted.</p>
<p><b>What changed:</b> Save buttons are on in every site from install (no switch to press), with
"Save buttons on all sites" and "This site" switches in Settings; the window is a header (refresh,
settings, close), the page's paper with one "Save to Thesis Copilot" button, and the signed-in
account at the bottom with "Open Thesis Copilot" and a menu.</p>
<h2>The fresh-install check</h2>
<p>The production build, loaded into a new Chromium profile; no switch pressed, nothing stored:
<span class="${fresh.passed ? 'pass' : 'fail'}">${fresh.passed ? 'PASSED' : 'FAILED'}</span>
(version ${fresh.version}; every-site access held at install: ${fresh.everySiteGranted}).</p>
<table><tr><td><b>Page</b></td><td><b>Buttons put in</b></td></tr>${freshRows}</table>
<h2>The window, light and dark</h2>
${pair('paper-found', 'A paper found')}
${pair('saving', 'Saving')}
${pair('saved', 'Saved · Open in Thesis Copilot')}
${pair('no-paper', 'No paper found on this page')}
${pair('no-paper-how', '“How it works” opened')}
${pair('signed-out', 'Signed out')}
${pair('settings', 'Settings')}
${pair('menu', 'The account menu')}
${pair('results', 'A results page')}
${pair('results-several', 'A results page, after “Select several”')}
<h2>The button in pages</h2>
${shots
  .filter((s) => s.file.startsWith('inline-'))
  .map(
    (s) =>
      `<div class="site"><p><b>${s.label}</b></p><img class="${s.small ? 'close' : 'wide'}" src="${img(s.file)}"></div>`,
  )
  .join('')}
</body></html>`;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.pdf({
  path: join(outDir, 'extension-0.4-review.pdf'),
  format: 'A4',
  printBackground: true,
});
await browser.close();
console.log(`Wrote ${shots.length} pictures and extension-0.4-review.pdf to ${outDir}`);
if (!fresh.passed) process.exitCode = 1;
