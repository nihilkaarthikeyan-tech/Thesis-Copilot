/**
 * The Chrome add-on on real websites, not fixtures (2026-10-05). The owner asked to see it used
 * the way a student uses it. The add-on is built for the local stack, loaded into Chromium, and
 * opened on live pages: a journal article, an arXiv abstract, an arXiv listing, a PubMed search,
 * a real PDF, and one Google Scholar results page (read once, as a student's tab would hold it;
 * a CAPTCHA is recorded and left alone). Each popup is screenshotted and every outcome written to
 * `EXT_LIVE_OUT` for reading. Not a test: a recorder. `MEASURE=1` runs it.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type BrowserContext, chromium, type Page, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from '../_session.js';

const WEB_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const OUT = process.env.EXT_LIVE_OUT ?? join(tmpdir(), 'ext-live');

const PAGES = [
  { name: 'nature-article', url: 'https://www.nature.com/articles/nature14539', kind: 'one' },
  { name: 'arxiv-abstract', url: 'https://arxiv.org/abs/1706.03762', kind: 'one' },
  { name: 'arxiv-pdf', url: 'https://arxiv.org/pdf/1706.03762', kind: 'one' },
  {
    name: 'pubmed-search',
    url: 'https://pubmed.ncbi.nlm.nih.gov/?term=mobile+banking+women+india',
    kind: 'many',
  },
  { name: 'arxiv-listing', url: 'https://arxiv.org/list/cs.CL/recent', kind: 'many' },
  {
    name: 'scholar-search',
    url: 'https://scholar.google.com/scholar?q=mobile+banking+rural+women+india',
    kind: 'many',
  },
] as const;

let context: BrowserContext;
let extensionId = '';

type ChromeTabs = {
  tabs: { query(filter: { url: string }): Promise<Array<{ id?: number; url?: string }>> };
};

async function openPopupFor(tab: Page): Promise<Page> {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 640 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const want = tab.url();
  const tabId = await popup.evaluate(async (target) => {
    const { chrome } = globalThis as unknown as { chrome: ChromeTabs };
    const all = await chrome.tabs.query({ url: '<all_urls>' } as never);
    return all.find((t) => t.url === target)?.id;
  }, want);
  if (!tabId) throw new Error(`no tab for ${want}`);
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  return popup;
}

test('the add-on on real websites, recorded', async ({ playwright }) => {
  test.setTimeout(15 * 60_000);
  mkdirSync(OUT, { recursive: true });
  const record: Record<string, unknown> = { at: new Date().toISOString(), steps: [] };
  const steps = record.steps as Array<Record<string, unknown>>;
  const save = () => writeFileSync(join(OUT, 'record.json'), JSON.stringify(record, null, 2));

  const out = mkdtempSync(join(tmpdir(), 'tc-extension-live-'));
  execFileSync(
    process.execPath,
    [
      resolve(__dirname, '../../../extension/scripts/build.mjs'),
      '--target',
      'development',
      '--api',
      API_URL,
      '--web',
      WEB_URL,
      '--out',
      out,
      // Host permission for the live sites, in place of the toolbar click a test cannot make;
      // the production build relies on `activeTab` for the same pages.
      ...[
        'https://www.nature.com/*',
        'https://arxiv.org/*',
        'https://pubmed.ncbi.nlm.nih.gov/*',
        'https://scholar.google.com/*',
      ].flatMap((h) => ['--extra-host', h]),
    ],
    { stdio: 'inherit' },
  );
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [`--disable-extensions-except=${out}`, `--load-extension=${out}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;

  const request = await playwright.request.newContext();
  const session = await establishSession(request, freshEmail('ext-live'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await context.addCookies([
    { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
  ]);
  const created = (await (
    await request.post(`${API_URL}/api/v1/documents`, {
      headers: { cookie },
      data: { title: `Add-on live trial ${Date.now()}`, entryPath: 'A_TOPIC' },
    })
  ).json()) as { id: string };
  record.documentId = created.id;

  for (const p of PAGES) {
    const step: Record<string, unknown> = { name: p.name, url: p.url };
    steps.push(step);
    const tab = await context.newPage();
    try {
      const response = await tab.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      step.httpStatus = response?.status() ?? null;
      await tab.waitForTimeout(2_500);
      step.pageTitle = await tab.title().catch(() => null);
      await tab.screenshot({ path: join(OUT, `${p.name}-page.png`) }).catch(() => undefined);

      const popup = await openPopupFor(tab);
      await popup.waitForTimeout(3_000);
      await popup.screenshot({ path: join(OUT, `${p.name}-popup.png`), fullPage: true });
      step.popupBefore = (await popup.locator('body').innerText()).slice(0, 1_200);

      const thesis = popup.getByTestId('thesis');
      if (await thesis.count()) await thesis.selectOption(created.id).catch(() => undefined);

      if (p.kind === 'one' && (await popup.getByTestId('add').count())) {
        await popup.getByTestId('add').click();
        await popup
          .getByTestId('message')
          .waitFor({ timeout: 60_000 })
          .catch(() => undefined);
        await popup.waitForTimeout(2_000);
      } else if (p.kind === 'many' && (await popup.getByTestId('result').count())) {
        step.resultsListed = await popup.getByTestId('result').count();
        // Three, as a student would tick a few, not the whole page.
        const boxes = popup.getByTestId('result').locator('input[type="checkbox"]');
        for (let i = 0; i < Math.min(3, await boxes.count()); i++) await boxes.nth(i).check();
        await popup.getByTestId('save-many').click();
        await popup
          .getByTestId('message')
          .waitFor({ timeout: 90_000 })
          .catch(() => undefined);
        await popup.waitForTimeout(4_000);
      }
      await popup.screenshot({ path: join(OUT, `${p.name}-after.png`), fullPage: true });
      step.popupAfter = (await popup.locator('body').innerText()).slice(0, 1_500);
      await popup.close();
    } catch (error) {
      step.error = (error as Error).message.slice(0, 400);
    }
    await tab.close().catch(() => undefined);
    save();
  }

  // What the library holds now, as the app sees it.
  const sources = (await (
    await request.get(`${API_URL}/api/v1/documents/${created.id}/sources`, { headers: { cookie } })
  ).json()) as Array<{
    title: string | null;
    doi: string | null;
    hasFile?: boolean;
    status: string;
  }>;
  record.library = sources.map((s) => ({
    title: s.title,
    doi: s.doi,
    hasFile: s.hasFile ?? false,
    status: s.status,
  }));
  save();
  await request.dispose();
  await context.close();
});
