/**
 * The product demo video (2026-10-06), recorded by driving the app as a student would, on the real
 * models and live scholarly indexes, with captions and a visible pointer drawn on the page. The
 * owner asked for a video to show; this makes one without a screen recorder.
 *
 * Writes `raw.webm` and `timeline.json` (scene starts and the waits to speed up) to `DEMO_OUT`;
 * `demo-cut.py` beside this file turns them into the finished MP4. `MEASURE=1` runs it.
 * Every scene is allowed to fail on its own: a failed scene is written down and skipped, so one
 * slow index does not cost the whole recording.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type BrowserContext, chromium, type Locator, type Page, test } from '@playwright/test';
import { API_URL, establishSession, freshEmail } from '../_session.js';

const WEB_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const OUT = process.env.DEMO_OUT ?? join(tmpdir(), 'demo-video');
const TOPIC = 'Mobile banking adoption among rural women in Tamil Nadu';
const SIZE = { width: 1280, height: 720 };

type Mark = { t: number; kind: 'scene' | 'fast-start' | 'fast-end' | 'fail'; label: string };
const marks: Mark[] = [];
let t0 = 0;
const now = () => Date.now() - t0;

/** Caption bar and a pointer, re-drawn after every navigation. */
const OVERLAY = `
(() => {
  const install = () => {
    if (document.getElementById('demo-cap')) return;
    const style = document.createElement('style');
    style.textContent = \`
      #demo-cap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;
        max-width:980px;padding:14px 22px;border-radius:14px;background:rgba(17,24,39,.92);color:#fff;
        font:600 22px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25);
        text-align:center;transition:opacity .3s;pointer-events:none}
      #demo-cap small{display:block;font-weight:400;font-size:16px;opacity:.8;margin-top:4px}
      #demo-cap:empty{opacity:0}
      #demo-ptr{position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;
        background:rgba(37,99,235,.35);border:2px solid #2563eb;z-index:2147483647;pointer-events:none;
        transition:transform .12s;left:-50px;top:-50px}
      #demo-ptr.down{transform:scale(.7);background:rgba(37,99,235,.6)}
      [data-testid="dev-timing"]{display:none!important}\`;
    document.documentElement.append(style);
    const cap = document.createElement('div'); cap.id = 'demo-cap';
    const ptr = document.createElement('div'); ptr.id = 'demo-ptr';
    document.documentElement.append(cap, ptr);
    const saved = sessionStorage.getItem('demo-cap'); if (saved) cap.innerHTML = saved;
    const xy = sessionStorage.getItem('demo-ptr'); if (xy) { const [x,y] = xy.split(','); ptr.style.left = x+'px'; ptr.style.top = y+'px'; }
    addEventListener('mousemove', e => { ptr.style.left = e.clientX+'px'; ptr.style.top = e.clientY+'px';
      sessionStorage.setItem('demo-ptr', e.clientX+','+e.clientY); }, true);
    addEventListener('mousedown', () => ptr.classList.add('down'), true);
    addEventListener('mouseup', () => ptr.classList.remove('down'), true);
  };
  if (document.documentElement) install();
  document.addEventListener('DOMContentLoaded', install);
})();`;

async function caption(page: Page, title: string, sub = '') {
  const html = title ? `${title}${sub ? `<small>${sub}</small>` : ''}` : '';
  await page
    .evaluate((h) => {
      sessionStorage.setItem('demo-cap', h);
      const cap = document.getElementById('demo-cap');
      if (cap) cap.innerHTML = h;
    }, html)
    .catch(() => undefined);
}

async function point(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => undefined);
  const box = await target.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  await page.waitForTimeout(350);
}

async function click(page: Page, target: Locator) {
  await point(page, target);
  await target.click();
  await page.waitForTimeout(400);
}

async function slowType(page: Page, text: string, delay = 45) {
  await page.keyboard.type(text, { delay });
}

/** A wait the finished video plays fast. */
async function fast<T>(label: string, run: () => Promise<T>): Promise<T> {
  marks.push({ t: now(), kind: 'fast-start', label });
  try {
    return await run();
  } finally {
    marks.push({ t: now(), kind: 'fast-end', label });
  }
}

async function scene(label: string, run: () => Promise<void>) {
  marks.push({ t: now(), kind: 'scene', label });
  console.log(`  +${(now() / 1000).toFixed(0).padStart(4)} s  ${label}`);
  try {
    await run();
  } catch (error) {
    const message = (error as Error).message.split('\n')[0]?.slice(0, 200) ?? '';
    marks.push({ t: now(), kind: 'fail', label: `${label}: ${message}` });
    console.log(`         FAILED: ${message}`);
  }
}

async function card(page: Page, heading: string, lines: string[], ms: number) {
  await page.setContent(`<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;
    background:linear-gradient(135deg,#1e3a8a,#312e81);color:#fff;font-family:system-ui,Segoe UI,sans-serif">
    <div style="text-align:center;max-width:900px;padding:0 40px">
      <div style="font-size:56px;font-weight:800;letter-spacing:-.02em">${heading}</div>
      ${lines.map((l, i) => `<div style="font-size:${i === 0 ? 26 : 22}px;opacity:${i === 0 ? 0.95 : 0.8};margin-top:${i === 0 ? 22 : 10}px">${l}</div>`).join('')}
    </div></body></html>`);
  await page.waitForTimeout(ms);
}

let context: BrowserContext;

test('the product demo, recorded', async ({ playwright }) => {
  test.setTimeout(45 * 60_000);
  mkdirSync(OUT, { recursive: true });
  const videoDir = join(OUT, 'raw');

  const ext = mkdtempSync(join(tmpdir(), 'tc-demo-ext-'));
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
      ext,
      '--no-zip',
      '--extra-host',
      'https://arxiv.org/*',
      '--extra-host',
      'https://www.nature.com/*',
    ],
    { stdio: 'inherit' },
  );
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    viewport: SIZE,
    recordVideo: { dir: videoDir, size: SIZE },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  // The video starts with the context's first page; everything before the first scene is cut.
  t0 = Date.now();
  await context.addInitScript(OVERLAY);
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;

  const request = await playwright.request.newContext();
  const session = await establishSession(request, freshEmail('demo'));
  await context.addCookies([
    { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
  ]);

  const page = context.pages()[0] ?? (await context.newPage());
  // A step that cannot find its button fails its scene instead of waiting for ever.
  page.setDefaultTimeout(30_000);
  let documentId = '';
  let chapterUrl = '';

  await scene('title', async () => {
    await card(
      page,
      'Thesis Copilot',
      [
        'A writing partner for your PhD thesis',
        'Every suggestion grounded in papers you can check',
      ],
      4_500,
    );
  });

  await scene('landing', async () => {
    await page.goto(`${WEB_URL}/`);
    await caption(page, 'thesis.rademics.ai', 'Built for Indian PhD students and their guides');
    await page.waitForTimeout(2_500);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 420);
      await page.waitForTimeout(900);
    }
    await page.waitForTimeout(800);
  });

  await scene('new thesis', async () => {
    await page.goto(`${WEB_URL}/app`);
    await caption(page, 'Start a thesis with nothing but its title');
    const title = page.getByLabel('Working title');
    await click(page, title);
    await slowType(page, TOPIC, 40);
    await page.waitForTimeout(800);
    await caption(page, '“Start writing now” — no forms, no setup');
    await click(page, page.getByTestId('start-writing-now'));
    await page.waitForURL(/\/write\//, { timeout: 60_000 });
    chapterUrl = page.url();
    documentId = /\/app\/d\/([0-9a-f-]{36})\//.exec(chapterUrl)?.[1] ?? '';
    await page.locator('.thesis-editor').waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1_500);
  });

  await scene('papers found', async () => {
    await caption(
      page,
      'It searches the scholarly indexes and reads papers on your topic, by itself',
      'OpenAlex, Crossref, Semantic Scholar, arXiv, PubMed, Europe PMC',
    );
    await fast('library filling', async () => {
      const end = Date.now() + 240_000;
      while (Date.now() < end) {
        const res = await request.get(`${API_URL}/api/v1/documents/${documentId}/sources`, {
          headers: { cookie: `${session.cookieName}=${session.cookieValue}` },
        });
        const rows = (await res.json()) as Array<{ groundingLevel: string }>;
        if (rows.filter((r) => r.groundingLevel !== 'NONE').length >= 12) break;
        await page.waitForTimeout(3_000);
      }
    });
    await page.waitForTimeout(1_500);
  });

  await scene('cited suggestion', async () => {
    const hide = page.getByTestId('section-guide').getByRole('button', { name: 'Hide' });
    if (await hide.count()) await click(page, hide);
    await caption(page, 'Write a sentence and pause', 'It suggests the next one');
    const editor = page.locator('.thesis-editor');
    await click(page, editor.locator('p').last());
    await slowType(
      page,
      'Mobile banking could widen financial access for rural women in Tamil Nadu, yet uptake remains uneven. ',
      38,
    );
    await caption(
      page,
      'The suggestion comes with a citation — only from papers it has actually read',
    );
    const shown = page.locator('.thesis-editor span.ghost[data-status="shown"]');
    await fast('waiting for a cited suggestion', async () => {
      const end = Date.now() + 150_000;
      let pressed = 0;
      while (Date.now() < end) {
        if ((await shown.count()) && (await page.getByTestId('suggestion-evidence').count()))
          return;
        if ((await shown.count()) && !(await page.getByTestId('suggestion-evidence').count())) {
          await page.keyboard.press('Escape');
        }
        if (Date.now() - pressed > 40_000) {
          pressed = Date.now();
          await page
            .getByTestId('suggest-button')
            .click()
            .catch(() => undefined);
        }
        await page.waitForTimeout(1_500);
      }
      throw new Error('no cited suggestion');
    });
    await page.waitForTimeout(2_000);
    const evidence = page.getByTestId('suggestion-evidence').first();
    await caption(
      page,
      'Check the source before you accept',
      'The passage the sentence is based on, one click away',
    );
    await click(page, evidence);
    await page.waitForTimeout(3_500);
    await caption(page, 'Nothing enters your thesis until you accept it');
    const accept = page.getByTestId('suggestion-bar').getByRole('button', { name: 'Accept' });
    if (await accept.count()) await click(page, accept);
    else await page.keyboard.press('Tab');
    await page.waitForTimeout(2_000);
  });

  await scene('second suggestion', async () => {
    await caption(page, 'Keep going — sentence by sentence, with your sources');
    await page.keyboard.press('End');
    await slowType(page, ' Studies in South India point to ', 45);
    const shown = page.locator('.thesis-editor span.ghost[data-status="shown"]');
    await fast('second suggestion', async () => {
      await shown.waitFor({ timeout: 60_000 }).catch(async () => {
        await page
          .getByTestId('suggest-button')
          .click()
          .catch(() => undefined);
        await shown.waitFor({ timeout: 60_000 });
      });
    });
    await page.waitForTimeout(2_500);
    const accept = page.getByTestId('suggestion-bar').getByRole('button', { name: 'Accept' });
    if (await accept.count()) await click(page, accept);
    await page.waitForTimeout(1_500);
  });

  await scene('edit a selection', async () => {
    const para = page.locator('.thesis-editor p').filter({ hasText: 'Mobile banking' }).first();
    // From the paragraph's first word down three lines: a triple-click can land on a citation and
    // select only that.
    const box = await para.boundingBox();
    if (!box) throw new Error('no paragraph');
    await page.mouse.move(box.x + 2, box.y + 10, { steps: 20 });
    await page.mouse.click(box.x + 2, box.y + 10);
    await page.keyboard.press('Home');
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Shift+ArrowDown');
      await page.waitForTimeout(250);
    }
    await caption(
      page,
      'Select text to improve it',
      'Formalise, shorten, hedge, translate, turn into a table, and more',
    );
    const toolbar = page.getByTestId('command-toolbar');
    await toolbar.waitFor({ timeout: 10_000 });
    await page.waitForTimeout(1_500);
    await click(page, toolbar.getByRole('button', { name: 'Formalise' }));
    await fast('formalising', async () => {
      await page.getByTestId('command-diff').waitFor({ timeout: 90_000 });
    });
    await caption(
      page,
      'You see exactly what would change',
      'Replace it, insert it below, or discard it',
    );
    await page.waitForTimeout(4_000);
    await click(page, page.getByRole('button', { name: 'Replace' }));
    await page.waitForTimeout(1_500);
  });

  await scene('chat', async () => {
    await page.getByRole('tab', { name: 'chat', exact: true }).click();
    const panel = page.getByTestId('chat-panel');
    await caption(
      page,
      'Ask your library a question',
      'Answers cite the papers, passage by passage',
    );
    const box = panel.locator('textarea, input#chat-message').first();
    await click(page, box);
    await slowType(page, 'What stops rural women in India from using mobile banking?', 35);
    await click(page, panel.getByRole('button', { name: 'Ask', exact: true }));
    await fast('chat answer', async () => {
      await panel.getByTestId('chat-rating').last().waitFor({ timeout: 120_000 });
    });
    await page.waitForTimeout(1_000);
    const answer = panel.locator('[data-role="assistant"]').last();
    await answer.scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(5_000);
  });

  await scene('deep research', async () => {
    const panel = page.getByTestId('chat-panel');
    await caption(
      page,
      '“Research deeply” for the big questions',
      'It plans the question in parts, searches every index for each, and answers part by part',
    );
    await click(page, panel.getByTestId('chat-deep-toggle'));
    const box = panel.locator('textarea, input#chat-message').first();
    await click(page, box);
    await slowType(
      page,
      'How do trust, digital literacy and household norms shape mobile banking use by rural women?',
      30,
    );
    await click(page, panel.getByRole('button', { name: 'Ask', exact: true }));
    await page.waitForTimeout(3_000);
    await fast('deep research', async () => {
      await panel
        .getByTestId('chat-research-plan')
        .last()
        .waitFor({ timeout: 60_000 })
        .catch(() => undefined);
      await panel.getByTestId('chat-rating').nth(1).waitFor({ timeout: 240_000 });
    });
    const headings = panel.getByTestId('chat-answer-heading');
    if (await headings.count()) await headings.first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(3_000);
    for (let i = 0; i < 4; i++) {
      await panel.hover();
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(1_000);
    }
    await page.waitForTimeout(1_500);
  });

  await scene('library', async () => {
    await page.goto(`${WEB_URL}/app/d/${documentId}/sources`);
    await caption(
      page,
      'Your library',
      'Every paper, and how much of it was actually read: abstract or full text',
    );
    await page.waitForTimeout(4_000);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(2_000);
  });

  await scene('gaps and claims', async () => {
    const discover = page
      .getByRole('button', { name: /discover/i })
      .or(page.getByRole('tab', { name: /discover/i }));
    await click(page, discover.first());
    await caption(
      page,
      'Where the research gaps are',
      'Themes that are thin in the literature, and claims that are contested or under-explored',
    );
    await page.waitForTimeout(2_000);
    // Discover's search starts from a saved proposal, which "Start writing now" does not make.
    const search = page.getByRole('button', { name: 'Discover literature' });
    const noProposal = await page.getByText('Save the proposal first').count();
    if (!noProposal && (await search.count())) {
      await click(page, search);
      await fast('gap map', async () => {
        await page.getByTestId('gap-map').waitFor({ timeout: 180_000 });
      });
      await page.getByTestId('gap-map').scrollIntoViewIfNeeded();
      await page.waitForTimeout(5_000);
    }
    const run = page.getByTestId('claims-run');
    if (await run.count()) {
      await click(page, run);
      await fast('claims map', async () => {
        await page.getByTestId('claim').first().waitFor({ timeout: 120_000 });
      });
      await page.getByTestId('claims-map').scrollIntoViewIfNeeded();
      await page.waitForTimeout(5_000);
    }
  });

  await scene('citations', async () => {
    await page.goto(chapterUrl);
    await page.locator('.thesis-editor').waitFor({ timeout: 60_000 });
    await page.getByRole('tab', { name: 'citations' }).click();
    const panel = page.getByTestId('citations-panel');
    await caption(
      page,
      'Any citation style — over 10,000 of them',
      'Switch, and every citation and the reference list follow',
    );
    const switcher = panel.getByTestId('style-switcher');
    await point(page, switcher);
    const labels = await switcher.locator('option').allTextContents();
    const ieee = labels.find((l) => /IEEE/.test(l));
    await page.waitForTimeout(1_000);
    if (ieee) await switcher.selectOption({ label: ieee });
    await caption(page, 'Now IEEE: numbered citations, the reference list re-ordered');
    await page.waitForTimeout(5_000);
    const apa = labels.find((l) => /^APA/.test(l));
    if (apa) await switcher.selectOption({ label: apa });
    await page.waitForTimeout(2_000);
  });

  await scene('examiner review', async () => {
    await page.getByRole('tab', { name: 'check', exact: true }).click();
    const review = page.getByTestId('examiner-review');
    await caption(page, 'Read by an examiner before your guide sees it');
    await click(page, review.getByTestId('run-examiner-review'));
    await fast('examiner review', async () => {
      await review.getByTestId('examiner-review-result').waitFor({ timeout: 240_000 });
    });
    await review.getByTestId('examiner-review-result').scrollIntoViewIfNeeded();
    await page.waitForTimeout(5_000);
  });

  await scene('export', async () => {
    await page.goto(`${WEB_URL}/app/d/${documentId}/submit`);
    await caption(
      page,
      'Submission: your university’s format, ten compliance checks',
      'Then Word or PDF, with a real contents page',
    );
    await page.waitForTimeout(3_500);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(2_500);
    const docx = page.getByTestId('open-export');
    if (await docx.count()) await point(page, docx);
    await page.waitForTimeout(2_000);
  });

  await scene('add-on', async () => {
    const article = await context.newPage();
    await article.goto('https://arxiv.org/abs/1706.03762', { waitUntil: 'domcontentloaded' });
    // The main tab shows the page, then becomes the popup; the popup reads the other tab.
    await page.goto('https://arxiv.org/abs/1706.03762#shown', { waitUntil: 'domcontentloaded' });
    await caption(
      page,
      'Reading a paper on a journal site?',
      'The Chrome add-on saves it to your thesis in one click',
    );
    await page.waitForTimeout(3_500);
    const tabId = await page
      .context()
      .newPage()
      .then(async (probe) => {
        await probe.goto(`chrome-extension://${extensionId}/popup.html`);
        const id = await probe.evaluate(async () => {
          const { chrome } = globalThis as unknown as {
            chrome: { tabs: { query(q: object): Promise<Array<{ id?: number; url?: string }>> } };
          };
          return (await chrome.tabs.query({})).find(
            (t) => t.url?.includes('arxiv.org/abs') && !t.url.includes('#shown'),
          )?.id;
        });
        await probe.close();
        return id;
      });
    await page.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
    await page.evaluate(() => {
      document.body.style.zoom = '1.6';
      document.body.style.maxWidth = '420px';
      document.body.style.margin = '20px auto';
    });
    await caption(page, 'The add-on', 'Title, authors, year and DOI read from the page');
    await page.waitForTimeout(3_000);
    const thesis = page.getByTestId('thesis');
    if (await thesis.count()) await thesis.selectOption(documentId).catch(() => undefined);
    await click(page, page.getByTestId('add'));
    await page
      .getByTestId('message')
      .waitFor({ timeout: 60_000 })
      .catch(() => undefined);
    await caption(
      page,
      'Saved — and read — in your library',
      'Also saves whole result pages from PubMed, arXiv and Google Scholar',
    );
    await page.waitForTimeout(4_000);
    await article.close();
  });

  await scene('end', async () => {
    await card(
      page,
      'Thesis Copilot',
      [
        'thesis.rademics.ai',
        'Cited suggestions · Chat over your library · Deep research · Gap and claims maps',
        'Examiner review · 10,000+ citation styles · Word and PDF export · Chrome add-on',
      ],
      6_000,
    );
  });

  const video = page.video();
  await page.close();
  await context.close();
  await request.dispose();
  if (video) renameSync(await video.path(), join(OUT, 'raw.webm'));
  writeFileSync(
    join(OUT, 'timeline.json'),
    JSON.stringify({ topic: TOPIC, documentId, marks }, null, 2),
  );
});
