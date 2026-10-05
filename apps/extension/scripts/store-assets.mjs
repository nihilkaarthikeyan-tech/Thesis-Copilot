/**
 * Pictures of the add-on for review and for the Chrome Web Store — ADR-0069.
 *
 *   node scripts/store-assets.mjs
 *
 * Writes into `store/`:
 * - `states/<state>-<light|dark>.png` — the popup in every state, 360 px wide, as a student sees it;
 * - `screenshot-1-save-a-paper.png` and `screenshot-2-save-results.png` — 1280×800, the store's size;
 * - `promo-small-440x280.png` — the store's small promotional tile.
 *
 * The popup is the real built `popup.html`/`popup.js`, served locally, with a stand-in `chrome`
 * object that answers as Thesis Copilot would — so no account, no network and no real site are
 * involved. Every paper, thesis and journal in the pictures is invented: the DOIs use Crossref's
 * test prefix 10.5555, and "Open Journal of Groundwater Studies" is not a real journal. No browser
 * tab bar, address bar or personal data appears in any picture.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const store = join(root, 'store');
mkdirSync(join(store, 'states'), { recursive: true });

// 1. The production build, without its zip, somewhere temporary.
const out = mkdtempSync(join(tmpdir(), 'tc-store-'));
execFileSync(process.execPath, [join(root, 'scripts/build.mjs'), '--out', out, '--no-zip'], {
  stdio: 'inherit',
});

// 2. The pages around the popup (an invented article, the two store compositions, the tile).
const LOGO = (tile, glyph, dot, size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="${tile}"/><path d="M11 15h30v7.5H29.8V50h-7.6V22.5H11z" fill="${glyph}"/><circle cx="48" cy="19" r="6" fill="${dot}"/></svg>`;

const FONTS = `
@font-face{font-family:Satoshi;src:url(/fonts/Satoshi-Regular.woff2) format("woff2");font-weight:400}
@font-face{font-family:Satoshi;src:url(/fonts/Satoshi-Medium.woff2) format("woff2");font-weight:500}
@font-face{font-family:Satoshi;src:url(/fonts/Satoshi-Bold.woff2) format("woff2");font-weight:700}
*{box-sizing:border-box}html,body{margin:0}`;

const popupFrame = (scenario, height, top = 18, right = 24) => `
<div style="position:absolute;top:${top}px;right:${right}px;width:362px;height:${height}px;border:1px solid #cbd3de;border-radius:12px;overflow:hidden;box-shadow:0 18px 50px rgba(15,23,36,.22),0 2px 8px rgba(15,23,36,.10);background:#f5f7fa">
  <iframe src="/popup.html?scenario=${scenario}" style="border:0;width:360px;height:${height}px;display:block" title="Thesis Copilot"></iframe>
</div>`;

const ARTICLE_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}
body{width:1280px;height:800px;overflow:hidden;background:#fbfaf7;color:#22252a;font:16px/1.65 Georgia,"Times New Roman",serif;position:relative}
.bar{height:58px;background:#2f3b33;color:#eef1ea;display:flex;align-items:center;padding:0 48px;font:600 17px/1 Satoshi,sans-serif;letter-spacing:.01em}
.bar span{opacity:.7;font-weight:400;margin-left:18px;font-size:14px}
.wrap{padding:38px 48px 0 48px;width:800px}
.kicker{font:600 12px/1 Satoshi,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#5b6a5f}
h1{font:700 34px/1.2 Georgia,serif;margin:14px 0 14px;color:#1d2420}
.authors{font:15px/1.5 Satoshi,sans-serif;color:#3a4540}
.meta{font:13px/1.5 Satoshi,sans-serif;color:#6b746e;margin:6px 0 22px}
h2{font:700 13px/1 Satoshi,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#5b6a5f;margin:26px 0 10px}
p{margin:0 0 12px;color:#2c3330}
</style></head><body>
<div class="bar">Open Journal of Groundwater Studies<span>Volume 12 · Issue 3</span></div>
<div class="wrap">
<div class="kicker">Research article · Open access</div>
<h1>Aquifer recharge under changing monsoon patterns in peninsular India</h1>
<div class="authors">K. Raman, S. Iyer, P. Das, A. Mehta</div>
<div class="meta">Published 14 March 2023 · https://doi.org/10.5555/ojgs.2023.0147</div>
<h2>Abstract</h2>
<p>Recharge to the hard-rock aquifers of peninsular India depends on a few intense monsoon events. Using fifteen years of observation-well records from 212 sites, we estimate how the shift towards shorter, heavier rain spells has changed the share of rainfall that reaches the water table.</p>
<p>Recharge fell by a median of 11 per cent in districts where the number of rainy days declined, even where seasonal totals were unchanged. Check dams and percolation tanks offset roughly half of that loss where they were maintained.</p>
<h2>1. Introduction</h2>
<p>Groundwater supplies most of the irrigation water in the region, and most of its drinking water outside the cities. Whether the aquifers refill each year is therefore a question for farmers, planners and households alike…</p>
</div>
${popupFrame('saved', 520)}
</body></html>`;

const RESULTS_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}
body{width:1280px;height:800px;overflow:hidden;background:#0f1724;color:#edf1f7;font-family:Satoshi,sans-serif;position:relative}
.copy{position:absolute;left:96px;top:190px;width:560px}
.brand{display:flex;align-items:center;gap:12px;font-weight:700;font-size:20px;margin-bottom:44px}
h1{font-size:48px;line-height:1.1;letter-spacing:-.02em;margin:0 0 20px;font-weight:700}
p{font-size:20px;line-height:1.5;color:#a3adbd;margin:0 0 14px}
.dot{color:#8ea2ff}
</style></head><body>
<div class="copy">
<div class="brand">${LOGO('#edf1f7', '#0f1724', '#2743c4', 34)}Thesis Copilot</div>
<h1>Save a whole page of results<span class="dot">.</span></h1>
<p>On PubMed, arXiv and Google Scholar results, tick the papers you want and save them in one go — each one once, into the thesis and collection you choose.</p>
</div>
${popupFrame('list-done', 640, 48, 120)}
</body></html>`;

const PROMO = `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}
body{width:440px;height:280px;overflow:hidden;background:#0f1724;color:#edf1f7;font-family:Satoshi,sans-serif;display:flex;flex-direction:column;justify-content:center;padding:0 40px}
.brand{display:flex;align-items:center;gap:14px;font-weight:700;font-size:28px;letter-spacing:-.01em}
p{margin:20px 0 0;font-size:19px;line-height:1.4;color:#a3adbd;font-weight:500}
p b{color:#edf1f7;font-weight:700}
</style></head><body>
<div class="brand">${LOGO('#edf1f7', '#0f1724', '#2743c4', 52)}Thesis Copilot</div>
<p><b>Save the paper you are reading</b> to your thesis library in one click.</p>
</body></html>`;

const PAGES = {
  '/store/article.html': ARTICLE_PAGE,
  '/store/results.html': RESULTS_PAGE,
  '/store/promo.html': PROMO,
};
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://x').pathname;
  if (PAGES[path]) {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(PAGES[path]);
    return;
  }
  const file = normalize(join(out, path));
  if (!file.startsWith(out)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = readFileSync(file);
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;

// 3. The stand-in for Chrome's extension API: answers as Thesis Copilot would, per scenario.
function fakeChrome() {
  if (!location.pathname.endsWith('/popup.html')) return;
  const scenario = new URLSearchParams(location.search).get('scenario') ?? 'ready';
  const never = () => new Promise(() => undefined);
  const DOC = '0190a3c4-0000-7000-8000-000000000001';
  const theses = [
    { id: DOC, title: 'Groundwater governance in Tamil Nadu' },
    {
      id: '0190a3c4-0000-7000-8000-000000000002',
      title: 'Rooftop solar adoption in rural Karnataka',
    },
  ];
  const collections = [
    { id: '0190a3c4-0000-7000-8000-0000000000c1', name: 'Chapter 2 · Literature', count: 18 },
    { id: '0190a3c4-0000-7000-8000-0000000000c2', name: 'Methods', count: 6 },
  ];
  const article = {
    url: 'https://journal.example.org/articles/ojgs.2023.0147',
    title: 'Aquifer recharge under changing monsoon patterns in peninsular India',
    contentType: 'text/html',
    meta: [
      ['citation_title', 'Aquifer recharge under changing monsoon patterns in peninsular India'],
      ['citation_author', 'Raman, K.'],
      ['citation_author', 'Iyer, S.'],
      ['citation_author', 'Das, P.'],
      ['citation_author', 'Mehta, A.'],
      ['citation_journal_title', 'Open Journal of Groundwater Studies'],
      ['citation_publication_date', '2023/03/14'],
      ['citation_doi', '10.5555/ojgs.2023.0147'],
    ],
  };
  const pdfTab = {
    ...article,
    url: 'https://journal.example.org/articles/ojgs.2023.0147.pdf',
    contentType: 'application/pdf',
  };
  const results = [
    [
      '2601.04417',
      'Monsoon variability and groundwater depletion: a district-level panel',
      'Meera Iyer, Rohan Shah',
    ],
    [
      '2601.03982',
      'Learning recharge rates from sparse observation wells',
      'Arun Kumar, Priya Natarajan, Lee Wong',
    ],
    ['2601.03310', 'Check dams, percolation tanks and who benefits', 'S. Raghavan'],
    [
      '2601.02871',
      'A benchmark of aquifer models for hard-rock terrain',
      'J. Okafor, M. Silva, A. Rao, T. Berg',
    ],
    [
      '2601.02254',
      'Electricity subsidies and pumping: evidence from feeder separation',
      'N. Gupta, R. Menon',
    ],
    ['2601.01906', 'Satellite gravimetry for local water budgets', 'H. Ito'],
  ].map(([id, title, authors]) => ({
    title,
    byline: authors,
    citation: 'Submitted 4 January, 2026;',
    pmid: '',
    arxivId: id,
    href: `https://arxiv.org/abs/${id}`,
  }));
  const listing = { site: 'arxiv', items: results };
  const isList = scenario.startsWith('list');
  const page =
    scenario === 'not-paper'
      ? {
          url: 'https://news.example.org/story',
          title: 'A news story',
          contentType: 'text/html',
          meta: [],
        }
      : scenario === 'ready-pdf' || scenario === 'saved-pdf-blocked'
        ? pdfTab
        : isList
          ? {
              url: 'https://arxiv.org/list/physics.geo-ph/recent',
              title: 'Geophysics',
              contentType: 'text/html',
              meta: [],
            }
          : article;
  const tabUrl = scenario === 'restricted' ? 'chrome://extensions/' : page.url;

  const listeners = [];
  const keyOf = (id) => `10.48550/arxiv.${id}`;
  const listResults = (statuses) =>
    results.slice(0, statuses.length).map((r, i) => ({
      key: keyOf(r.arxivId),
      status: statuses[i],
      sourceId: statuses[i] === 'failed' ? null : `0190a3c4-0000-7000-8000-00000000010${i}`,
      ...(statuses[i] === 'failed' ? { message: 'Thesis Copilot answered 429.' } : {}),
    }));

  async function answer(request) {
    switch (request.type) {
      case 'theses':
        if (scenario === 'reading-theses') return never();
        if (scenario === 'signed-out')
          return { ok: false, status: 401, message: 'You are signed out of Thesis Copilot.' };
        if (scenario === 'no-thesis') return { ok: true, value: [] };
        if (scenario === 'load-failed')
          return {
            ok: false,
            status: 0,
            message: 'Thesis Copilot could not be reached. Check your connection and try again.',
          };
        return { ok: true, value: theses };
      case 'collections':
        return { ok: true, value: collections };
      case 'create-collection':
        return {
          ok: true,
          value: { id: '0190a3c4-0000-7000-8000-0000000000c3', name: request.name, count: 0 },
        };
      case 'save': {
        const { job } = request;
        if (scenario === 'saving' || scenario === 'list-saving') {
          if (scenario === 'list-saving') {
            setTimeout(() => {
              for (const listener of listeners) {
                listener(
                  {
                    type: 'progress',
                    runId: job.runId,
                    results: listResults(['saved', 'present']),
                    total: job.items.length,
                  },
                  { id: 'fake' },
                );
              }
            }, 50);
          }
          return never();
        }
        const key = job.items[0].key;
        if (scenario === 'error') {
          return {
            ok: true,
            value: {
              results: [
                {
                  key,
                  status: 'failed',
                  sourceId: null,
                  message:
                    'Your plan allows 10 library PDFs. Remove one or move to the Student plan.',
                },
              ],
              pdf: null,
              collection: null,
              signedOut: false,
            },
          };
        }
        if (scenario === 'already') {
          return {
            ok: true,
            value: {
              results: [
                { key, status: 'present', sourceId: '0190a3c4-0000-7000-8000-000000000099' },
              ],
              pdf: null,
              collection: null,
              signedOut: false,
            },
          };
        }
        if (scenario === 'list-done') {
          return {
            ok: true,
            value: {
              results: listResults(['saved', 'saved', 'present', 'saved', 'failed']),
              pdf: null,
              collection: 'added',
              signedOut: false,
            },
          };
        }
        return {
          ok: true,
          value: {
            results: [{ key, status: 'saved', sourceId: '0190a3c4-0000-7000-8000-000000000042' }],
            pdf:
              scenario === 'saved-pdf-blocked'
                ? {
                    kind: 'not-fetched',
                    message: 'This site would not let the add-on download the PDF.',
                  }
                : job.pdf
                  ? { kind: 'attached' }
                  : null,
            collection: job.collectionId ? 'added' : null,
            signedOut: false,
          },
        };
      }
    }
    return { ok: false, status: 0, message: 'unknown' };
  }

  const local = { lastDocumentId: DOC, lastCollectionId: '0190a3c4-0000-7000-8000-0000000000c1' };
  window.chrome = {
    runtime: {
      id: 'fake',
      getManifest: () => ({ version: '0.2.0' }),
      sendMessage: (request) => answer(request),
      onMessage: { addListener: (listener) => listeners.push(listener) },
    },
    storage: {
      local: {
        get: async () => ({ ...local }),
        set: async (values) => Object.assign(local, values),
      },
      session: { get: async () => ({}), remove: async () => undefined },
    },
    action: { setBadgeText: async () => undefined },
    commands: { getAll: async () => [{ name: '_execute_action', shortcut: 'Alt+Shift+S' }] },
    tabs: {
      query: async () => [{ id: 7, url: tabUrl, title: page.title }],
      get: async () => ({ id: 7, url: tabUrl, title: page.title }),
      create: async () => undefined,
    },
    scripting: {
      executeScript: async ({ func }) => {
        if (scenario === 'reading') return never();
        if (scenario === 'restricted') throw new Error('Cannot access a chrome:// URL');
        if (func.name === 'collectPageMeta') return [{ result: page }];
        return [{ result: isList ? listing : null }];
      },
    },
  };
}

// 4. Every state, light and dark.
const STATES = [
  { name: 'reading', scenario: 'reading' },
  { name: 'finding-theses', scenario: 'reading-theses' },
  { name: 'not-a-paper', scenario: 'not-paper' },
  { name: 'chrome-page', scenario: 'restricted' },
  { name: 'signed-out', scenario: 'signed-out' },
  { name: 'no-thesis', scenario: 'no-thesis' },
  { name: 'cannot-reach', scenario: 'load-failed' },
  { name: 'ready', scenario: 'ready' },
  { name: 'ready-pdf', scenario: 'ready-pdf' },
  { name: 'new-collection', scenario: 'ready', act: 'new-collection' },
  { name: 'saving', scenario: 'saving', act: 'save' },
  { name: 'saved', scenario: 'saved', act: 'save' },
  { name: 'saved-pdf-attached', scenario: 'ready-pdf', act: 'save' },
  { name: 'saved-pdf-blocked', scenario: 'saved-pdf-blocked', act: 'save' },
  { name: 'already-in-library', scenario: 'already', act: 'save' },
  { name: 'error-retry', scenario: 'error', act: 'save' },
  { name: 'results-page', scenario: 'list', act: 'tick' },
  { name: 'results-saving', scenario: 'list-saving', act: 'save-all' },
  { name: 'results-done', scenario: 'list-done', act: 'save-all' },
];

async function act(page, action) {
  if (action === 'save') {
    await page.getByTestId('add').click();
  } else if (action === 'new-collection') {
    await page.getByTestId('collection').selectOption('__new__');
    await page.getByTestId('new-collection').fill('Chapter 3 · Methods');
  } else if (action === 'tick') {
    for (const n of [0, 1, 3]) await page.getByTestId('result').nth(n).locator('input').check();
  } else if (action === 'save-all') {
    await page.getByTestId('select-all').click();
    await page.getByTestId('result').nth(5).locator('input').uncheck();
    await page.getByTestId('save-many').click();
  }
}

const browser = await chromium.launch();
for (const colorScheme of ['light', 'dark']) {
  const context = await browser.newContext({
    colorScheme,
    deviceScaleFactor: 2,
    viewport: { width: 360, height: 700 },
  });
  await context.addInitScript(fakeChrome);
  for (const state of STATES) {
    const page = await context.newPage();
    await page.goto(`${base}/popup.html?scenario=${state.scenario}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    if (state.act) await act(page, state.act);
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const list = document.querySelector('.results');
      if (list) list.scrollTop = 0;
    });
    // The popup's own size: Chrome sizes the window to the page, 360 wide.
    await page.locator('body').screenshot({
      path: join(store, 'states', `${state.name}-${colorScheme}.png`),
      animations: 'disabled',
    });
    await page.close();
  }
  await context.close();
}

// 5. The store's pictures: 1280×800 and the 440×280 tile, light, at 1×, as the store asks.
const context = await browser.newContext({
  colorScheme: 'light',
  deviceScaleFactor: 1,
  viewport: { width: 1280, height: 800 },
});
await context.addInitScript(fakeChrome);
for (const [path, file, frameAct] of [
  ['/store/article.html', 'screenshot-1-save-a-paper.png', 'save'],
  ['/store/results.html', 'screenshot-2-save-results.png', 'save-all'],
]) {
  const page = await context.newPage();
  await page.goto(`${base}${path}`);
  await page.evaluate(() => document.fonts.ready);
  const frame = page.frameLocator('iframe');
  if (frameAct === 'save') await frame.getByTestId('add').click();
  else {
    await frame.getByTestId('select-all').click();
    await frame.getByTestId('result').nth(5).locator('input').uncheck();
    await frame.getByTestId('save-many').click();
  }
  await page.waitForTimeout(300);
  // A picture, not a session: no focus ring, and the list from its top.
  await frame.locator('body').evaluate(() => {
    (document.activeElement instanceof HTMLElement ? document.activeElement : null)?.blur();
    const list = document.querySelector('.results');
    if (list) list.scrollTop = 0;
  });
  // The window takes the height of what it shows, as Chrome's popup does.
  await page.evaluate(() => {
    const frame = document.querySelector('iframe');
    const height = frame?.contentDocument?.body.scrollHeight ?? 0;
    if (frame && height) {
      frame.style.height = `${height}px`;
      if (frame.parentElement) frame.parentElement.style.height = `${height}px`;
    }
  });
  await page.screenshot({ path: join(store, file), animations: 'disabled' });
  await page.close();
}
await context.close();
const tile = await browser.newPage({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1 });
await tile.goto(`${base}/store/promo.html`);
await tile.evaluate(() => document.fonts.ready);
await tile.screenshot({ path: join(store, 'promo-small-440x280.png') });
await browser.close();
server.close();
console.log(
  `Wrote ${STATES.length * 2} state pictures, two 1280×800 screenshots and the 440×280 tile to ${store}`,
);
