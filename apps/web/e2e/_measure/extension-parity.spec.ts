/**
 * The add-on against Jenni's own list of what its extension does (2026-10-06,
 * docs/research/jenni-docs-digest.md §4.4): single pages on the publishers it names and on any page
 * with a DOI in its metadata, direct PDFs, bulk save from PubMed, arXiv and Google Scholar lists,
 * Select all, a collection made inline, progress, "open in the app", and the pages it says it cannot
 * read. Built for the local stack with host permission in place of the toolbar click. Not a test: a
 * recorder. Screenshots and `record.json` go to `EXT_PARITY_OUT`. `MEASURE=1` runs it.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type BrowserContext, chromium, type Page, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from '../_session.js';

const WEB_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const OUT = process.env.EXT_PARITY_OUT ?? join(tmpdir(), 'ext-parity');

type Kind = 'one' | 'many' | 'none';
const PAGES: Array<{ group: string; name: string; url: string; kind: Kind }> = [
  {
    group: 'Jenni names it',
    name: 'nature',
    url: 'https://www.nature.com/articles/nature14539',
    kind: 'one',
  },
  {
    group: 'Jenni names it',
    name: 'arxiv-abs',
    url: 'https://arxiv.org/abs/1706.03762',
    kind: 'one',
  },
  {
    group: 'Jenni names it',
    name: 'pubmed-one',
    url: 'https://pubmed.ncbi.nlm.nih.gov/32109013/',
    kind: 'one',
  },
  {
    group: 'Jenni names it',
    name: 'biorxiv',
    url: 'https://www.biorxiv.org/content/10.1101/2020.03.22.002386v3',
    kind: 'one',
  },
  {
    group: 'Jenni names it',
    name: 'jstor',
    url: 'https://www.jstor.org/stable/2118364',
    kind: 'one',
  },
  {
    group: 'Jenni names it',
    name: 'lens',
    url: 'https://www.lens.org/lens/search/scholar/list?q=financial%20inclusion%20women%20india',
    kind: 'many',
  },
  {
    group: 'DOI in metadata',
    name: 'plos',
    url: 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0230527',
    kind: 'one',
  },
  {
    group: 'DOI in metadata',
    name: 'mdpi',
    url: 'https://www.mdpi.com/2071-1050/12/6/2389',
    kind: 'one',
  },
  {
    group: 'DOI in metadata',
    name: 'springer',
    url: 'https://link.springer.com/article/10.1007/s11192-019-03217-6',
    kind: 'one',
  },
  {
    group: 'DOI in metadata',
    name: 'sciencedirect',
    url: 'https://www.sciencedirect.com/science/article/pii/S0048733319301702',
    kind: 'one',
  },
  {
    group: 'DOI in metadata',
    name: 'europepmc',
    url: 'https://europepmc.org/article/MED/32109013',
    kind: 'one',
  },
  { group: 'Direct PDF', name: 'arxiv-pdf', url: 'https://arxiv.org/pdf/1810.04805', kind: 'one' },
  {
    group: 'Direct PDF',
    name: 'plos-pdf',
    url: 'https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0230527&type=printable',
    kind: 'one',
  },
  {
    group: 'Results list',
    name: 'pubmed-list',
    url: 'https://pubmed.ncbi.nlm.nih.gov/?term=mobile+banking+women+india',
    kind: 'many',
  },
  {
    group: 'Results list',
    name: 'arxiv-list',
    url: 'https://arxiv.org/list/cs.CL/recent',
    kind: 'many',
  },
  {
    group: 'Results list',
    name: 'scholar-list',
    url: 'https://scholar.google.com/scholar?q=financial+inclusion+rural+women+india',
    kind: 'many',
  },
  {
    group: 'Should refuse',
    name: 'youtube',
    url: 'https://www.youtube.com/watch?v=aircAruvnKk',
    kind: 'none',
  },
  {
    group: 'Should refuse',
    name: 'google-search',
    url: 'https://www.google.com/search?q=thesis+writing',
    kind: 'none',
  },
];

let context: BrowserContext;
let extensionId = '';

type ChromeTabs = {
  tabs: { query(filter: object): Promise<Array<{ id?: number; url?: string }>> };
};

async function openPopupFor(tab: Page): Promise<Page> {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 700 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const want = tab.url();
  const tabId = await popup.evaluate(async (target) => {
    const { chrome } = globalThis as unknown as { chrome: ChromeTabs };
    const all = await chrome.tabs.query({});
    return all.find((t) => t.url === target)?.id;
  }, want);
  if (!tabId) throw new Error(`no tab for ${want}`);
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  return popup;
}

const bodyText = async (p: Page, n = 1_400) => (await p.locator('body').innerText()).slice(0, n);

test('the add-on against the Jenni extension list, recorded', async ({ playwright }) => {
  test.setTimeout(30 * 60_000);
  mkdirSync(OUT, { recursive: true });
  const record: Record<string, unknown> = { at: new Date().toISOString(), steps: [] };
  const steps = record.steps as Array<Record<string, unknown>>;
  const save = () => writeFileSync(join(OUT, 'record.json'), JSON.stringify(record, null, 2));

  const out = mkdtempSync(join(tmpdir(), 'tc-extension-parity-'));
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
      '--no-zip',
      '--extra-host',
      '<all_urls>',
    ],
    { stdio: 'inherit' },
  );
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${out}`, `--load-extension=${out}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;

  const request = await playwright.request.newContext();
  const session = await establishSession(request, freshEmail('ext-parity'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await context.addCookies([
    { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
  ]);
  const created = (await (
    await request.post(`${API_URL}/api/v1/documents`, {
      headers: { cookie },
      data: { title: `Add-on parity ${Date.now()}`, entryPath: 'A_TOPIC' },
    })
  ).json()) as { id: string };
  record.documentId = created.id;

  let madeCollection = false;
  // EXT_PARITY_ONLY=name,name re-runs a few pages.
  const only = (process.env.EXT_PARITY_ONLY ?? '').split(',').filter(Boolean);
  for (const p of PAGES.filter((x) => !only.length || only.includes(x.name))) {
    const step: Record<string, unknown> = {
      group: p.group,
      name: p.name,
      url: p.url,
      kind: p.kind,
    };
    steps.push(step);
    const tab = await context.newPage();
    try {
      const response = await tab.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      step.httpStatus = response?.status() ?? null;
      await tab.waitForTimeout(3_000);
      step.pageTitle = await tab.title().catch(() => null);
      await tab.screenshot({ path: join(OUT, `${p.name}-page.png`) }).catch(() => undefined);

      const popup = await openPopupFor(tab);
      const t0 = Date.now();
      await popup.waitForTimeout(3_500);
      step.popupBefore = await bodyText(popup);
      step.detected = {
        single: await popup.getByTestId('add').count(),
        list: await popup.getByTestId('result').count(),
      };
      await popup.screenshot({ path: join(OUT, `${p.name}-popup.png`), fullPage: true });

      const thesis = popup.getByTestId('thesis');
      if (await thesis.count()) await thesis.selectOption(created.id).catch(() => undefined);

      // The first save also makes a collection inline, as Jenni's does.
      if (!madeCollection && (await popup.getByTestId('collection').count())) {
        await popup.getByTestId('collection').selectOption('__new__');
        await popup.waitForTimeout(500);
        const input = popup.getByTestId('new-collection');
        await input.fill('Add-on trial');
        await input.press('Enter');
        await popup.waitForTimeout(2_000);
        step.collectionAfter = await bodyText(popup, 900);
        await popup.screenshot({ path: join(OUT, `${p.name}-collection.png`), fullPage: true });
        madeCollection = true;
      }

      if (p.kind === 'one' && (await popup.getByTestId('add').count())) {
        await popup.getByTestId('add').click();
        await popup
          .getByTestId('message')
          .waitFor({ timeout: 90_000 })
          .catch(() => undefined);
        await popup.waitForTimeout(2_000);
        step.seconds = Math.round((Date.now() - t0) / 100) / 10;
        step.openInApp = await popup.getByTestId('open-source').count();
      } else if (p.kind === 'many' && (await popup.getByTestId('result').count())) {
        step.resultsListed = await popup.getByTestId('result').count();
        if (p.name === 'arxiv-list') {
          await popup.getByTestId('select-all').click();
        } else {
          const boxes = popup.getByTestId('result').locator('input[type="checkbox"]');
          for (let i = 0; i < Math.min(4, await boxes.count()); i++) await boxes.nth(i).check();
        }
        step.saveLabel = await popup.getByTestId('save-many').innerText();
        await popup.getByTestId('save-many').click();
        step.progressShown = await popup
          .getByTestId('progress')
          .waitFor({ timeout: 5_000 })
          .then(() => true)
          .catch(() => false);
        await popup
          .screenshot({ path: join(OUT, `${p.name}-saving.png`), fullPage: true })
          .catch(() => undefined);
        await popup
          .getByTestId('message')
          .waitFor({ timeout: 180_000 })
          .catch(() => undefined);
        await popup.waitForTimeout(3_000);
        step.seconds = Math.round((Date.now() - t0) / 100) / 10;
        step.afterLabel = await popup
          .getByTestId('save-many')
          .innerText()
          .catch(() => null);
      }
      await popup.screenshot({ path: join(OUT, `${p.name}-after.png`), fullPage: true });
      step.popupAfter = await bodyText(popup, 1_800);
      await popup.close();
    } catch (error) {
      step.error = (error as Error).message.slice(0, 400);
    }
    await tab.close().catch(() => undefined);
    save();
  }

  // Give indexing time, then read the library as the app sees it.
  await new Promise((r) => setTimeout(r, 90_000));
  const sources = (await (
    await request.get(`${API_URL}/api/v1/documents/${created.id}/sources`, { headers: { cookie } })
  ).json()) as Array<Record<string, unknown>>;
  record.library = sources;
  save();

  const app = await context.newPage();
  await app.goto(`${WEB_URL}/app/d/${created.id}/sources`);
  await app.waitForTimeout(6_000);
  await app.screenshot({ path: join(OUT, 'library.png'), fullPage: true });
  await request.dispose();
  await context.close();
});
