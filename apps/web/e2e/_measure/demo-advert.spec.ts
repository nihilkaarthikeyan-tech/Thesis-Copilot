/**
 * The advertising video (2026-10-06): every part of the product, slower than the first demo, in
 * nine parts with a title card each. Driven as a student on the real models and live indexes,
 * against the local stack (`api-real`, `worker-real`, `web`); the demo account is moved to the
 * student plan in the local database first, so no scene stops at a trial allowance.
 *
 * Writes `raw.webm` and `timeline.json` to `DEMO_OUT`; `demo-cut.py` makes the MP4, playing each
 * marked wait in about five seconds and leaving out any scene that failed. `MEASURE=1` runs it.
 * The video stays on the machine that recorded it: `DEMO_OUT` is outside the repository.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  type APIRequestContext,
  type BrowserContext,
  chromium,
  type Locator,
  type Page,
  test,
} from '@playwright/test';
import { API_URL, establishSession, freshEmail, type Session } from '../_session.js';

const WEB_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const OUT = process.env.DEMO_OUT ?? join(tmpdir(), 'demo-advert');
const TOPIC = 'Mobile banking adoption among rural women in Tamil Nadu';
const SIZE = { width: 1280, height: 720 };
/** Every pause is this much longer than the first demo's: the owner asked for slower. */
const PACE = 1.5;

type Mark = { t: number; kind: 'scene' | 'fast-start' | 'fast-end' | 'fail'; label: string };
const marks: Mark[] = [];
let t0 = 0;
const now = () => Date.now() - t0;

const OVERLAY = `
(() => {
  const install = () => {
    if (document.getElementById('demo-cap')) return;
    const style = document.createElement('style');
    style.textContent = \`
      #demo-cap{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;
        max-width:1000px;padding:14px 24px;border-radius:14px;background:rgba(17,24,39,.92);color:#fff;
        font:600 22px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25);
        text-align:center;pointer-events:none}
      #demo-cap small{display:block;font-weight:400;font-size:16px;opacity:.85;margin-top:4px}
      #demo-cap:empty{display:none}
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

const hold = (page: Page, ms: number) => page.waitForTimeout(ms * PACE);

async function point(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => undefined);
  const box = await target.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 30 });
  await hold(page, 350);
}

async function click(page: Page, target: Locator) {
  await point(page, target);
  await target.click();
  await hold(page, 500);
}

const slowType = (page: Page, text: string, delay = 55) => page.keyboard.type(text, { delay });

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

async function card(page: Page, kicker: string, heading: string, lines: string[], ms: number) {
  await page.setContent(`<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;
    background:linear-gradient(135deg,#1e3a8a,#312e81);color:#fff;font-family:system-ui,Segoe UI,sans-serif">
    <div style="text-align:center;max-width:980px;padding:0 40px">
      ${kicker ? `<div style="font-size:18px;letter-spacing:.18em;text-transform:uppercase;opacity:.75">${kicker}</div>` : ''}
      <div style="font-size:54px;font-weight:800;letter-spacing:-.02em;margin-top:10px">${heading}</div>
      ${lines.map((l, i) => `<div style="font-size:${i === 0 ? 25 : 21}px;opacity:${i === 0 ? 0.95 : 0.8};margin-top:${i === 0 ? 20 : 10}px">${l}</div>`).join('')}
    </div></body></html>`);
  await hold(page, ms);
}

/** The local database: the demo student gets the student plan, and room for every scene. */
function grantPlan(email: string) {
  const sql = `
    UPDATE "User" SET plan = 'STUDENT_MONTHLY', "trialEndsAt" = NULL WHERE email = '${email}';
    INSERT INTO "UsageLedger" ("userId", period, action, count, bonus)
      SELECT u.id, to_char(now() at time zone 'utc', 'YYYY-MM'), a::"AiAction", 0, 30
      FROM "User" u, unnest(enum_range(NULL::"AiAction")) a WHERE u.email = '${email}'
    ON CONFLICT ("userId", period, action) DO UPDATE SET bonus = 30;`;
  execFileSync('docker', [
    'exec',
    'thesis-copilot-dev-postgres-1',
    'psql',
    '-U',
    'tc',
    '-d',
    'tc',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ]);
}

const cookieOf = (s: Session) => ({
  name: s.cookieName,
  value: s.cookieValue,
  domain: 'localhost',
  path: '/',
});

async function readyPapers(request: APIRequestContext, session: Session, documentId: string) {
  const res = await request.get(`${API_URL}/api/v1/documents/${documentId}/sources`, {
    headers: { cookie: `${session.cookieName}=${session.cookieValue}` },
  });
  const rows = (await res.json()) as Array<{ groundingLevel: string }>;
  return rows.filter((r) => r.groundingLevel !== 'NONE').length;
}

const editorOf = (page: Page) => page.locator('.thesis-editor');
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });

async function endOfText(page: Page) {
  await editorOf(page).locator('p').last().click();
  await page.keyboard.press('Control+End');
}

let context: BrowserContext;

test('the advertising video, recorded', async ({ playwright }) => {
  test.setTimeout(120 * 60_000);
  mkdirSync(OUT, { recursive: true });

  const ext = mkdtempSync(join(tmpdir(), 'tc-advert-ext-'));
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
      '<all_urls>',
    ],
    { stdio: 'inherit' },
  );
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    viewport: SIZE,
    recordVideo: { dir: join(OUT, 'raw'), size: SIZE },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  t0 = Date.now();
  await context.addInitScript(OVERLAY);
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).host;

  const request = await playwright.request.newContext({ timeout: 120_000 });
  const email = freshEmail('advert');
  const session = await establishSession(request, email);
  grantPlan(email);
  const cookie = `${session.cookieName}=${session.cookieValue}`;

  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(30_000);
  let documentId = '';
  let chapterUrl = '';
  const goWrite = async () => {
    await page.goto(chapterUrl);
    await editorOf(page).waitFor({ timeout: 60_000 });
    await hold(page, 800);
  };

  // ── 0 · Opening ────────────────────────────────────────────────────────────────────────────
  await scene('title', async () => {
    await card(
      page,
      '',
      'Thesis Copilot',
      [
        'The writing partner for your PhD thesis',
        'Every suggestion grounded in papers you can check · Built for Indian universities',
      ],
      4_000,
    );
  });

  // ── 1 · Start in a minute ──────────────────────────────────────────────────────────────────
  await scene('card 1', async () => {
    await card(page, 'Part 1', 'Start in a minute', ['From a title to a planned thesis'], 2_500);
  });

  await scene('landing', async () => {
    await page.goto(`${WEB_URL}/`);
    await caption(page, 'thesis.rademics.ai', 'For PhD students — and their guides');
    await hold(page, 2_500);
    for (let i = 0; i < 7; i++) {
      await page.mouse.wheel(0, 380);
      await hold(page, 900);
    }
  });

  await scene('sign in', async () => {
    await page.goto(`${WEB_URL}/sign-in`);
    await caption(
      page,
      'Sign in with a code sent to your email',
      'Or with Google, or a password — no forms to fill',
    );
    const field = page.getByLabel('University or personal email');
    await click(page, field);
    await slowType(page, 'scholar@university.ac.in', 60);
    await hold(page, 2_000);
    await context.addCookies([cookieOf(session)]);
  });

  await scene('proposal path', async () => {
    await page.goto(`${WEB_URL}/app`);
    await click(page, page.getByTestId('new-menu-button'));
    await click(page, page.getByRole('menuitem', { name: /Upload a paper/ }));
    await caption(
      page,
      'Start from a topic, or from a paper you have written',
      'A short conversation turns it into a proposal: problem, objectives, the gap',
    );
    await page.getByLabel(/Start from a topic/).check();
    await click(page, page.getByLabel('Working title'));
    await slowType(page, 'Solar dryers for small fishing communities in Kerala', 45);
    await click(page, page.getByRole('button', { name: 'Continue' }));
    const chat = page.getByTestId('path-a-chat');
    await chat.waitFor({ timeout: 30_000 });
    await click(page, chat.getByRole('button', { name: 'Send' }));
    await fast('proposal question', async () => {
      await chat.locator('[data-role="assistant"]').first().waitFor({ timeout: 120_000 });
    });
    await hold(page, 4_000);
  });

  await scene('new thesis', async () => {
    // With one thesis already made, /app lists it; the form is at ?new=1.
    await page.goto(`${WEB_URL}/app?new=1`);
    await caption(
      page,
      'Or just give it a title',
      '“Start writing now” — the editor opens at once',
    );
    await click(page, page.getByLabel('Working title'));
    await slowType(page, TOPIC, 45);
    await hold(page, 800);
    await click(page, page.getByTestId('start-writing-now'));
    await page.waitForURL(/\/write\//, { timeout: 60_000 });
    chapterUrl = page.url();
    documentId = /\/app\/d\/([0-9a-f-]{36})\//.exec(chapterUrl)?.[1] ?? '';
    await editorOf(page).waitFor({ timeout: 60_000 });
    await hold(page, 1_500);
  });

  await scene('chapters planned', async () => {
    await caption(
      page,
      'Your chapters are planned from the title',
      'Each with what it must argue, and its sections',
    );
    await fast('planning chapters', async () => {
      const rail = page.getByTestId('chapter-rail');
      const end = Date.now() + 120_000;
      while (Date.now() < end) {
        if ((await rail.locator('a, button').count()) > 3) break;
        await page.waitForTimeout(2_000);
      }
    });
    await point(page, page.getByTestId('chapter-rail'));
    await hold(page, 2_500);
    await point(page, page.getByTestId('section-guide'));
    await hold(page, 3_500);
  });

  // ── 2 · Write with your sources ────────────────────────────────────────────────────────────
  await scene('card 2', async () => {
    await card(
      page,
      'Part 2',
      'Write with your sources',
      ['Suggestions that cite only papers it has actually read'],
      2_500,
    );
    await goWrite();
  });

  await scene('papers found', async () => {
    await caption(
      page,
      'It finds and reads papers on your topic, by itself',
      'OpenAlex, Crossref, Semantic Scholar, arXiv, PubMed, Europe PMC, CORE',
    );
    await click(page, tab(page, 'sources'));
    await fast('library filling', async () => {
      const end = Date.now() + 300_000;
      while (Date.now() < end) {
        if ((await readyPapers(request, session, documentId)) >= 8) break;
        await page.waitForTimeout(4_000);
      }
    });
    await page.reload();
    await editorOf(page).waitFor({ timeout: 60_000 });
    await tab(page, 'sources')
      .click()
      .catch(() => undefined);
    await hold(page, 3_500);
  });

  await scene('cited suggestion', async () => {
    const hide = page.getByTestId('section-guide').getByRole('button', { name: 'Hide' });
    if (await hide.count()) await click(page, hide);
    await caption(page, 'Write a sentence and pause', 'It suggests the next one');
    await click(page, editorOf(page).locator('p').last());
    await slowType(
      page,
      'Mobile banking could widen financial access for rural women in Tamil Nadu, yet uptake remains uneven. ',
      42,
    );
    await caption(page, 'Every suggestion carries a citation', 'Only from passages it has read');
    const shown = page.locator('.thesis-editor span.ghost[data-status="shown"]');
    await fast('waiting for a cited suggestion', async () => {
      const end = Date.now() + 180_000;
      let pressed = 0;
      while (Date.now() < end) {
        const cited = (await page.getByTestId('suggestion-evidence').count()) > 0;
        if ((await shown.count()) && cited) return;
        if ((await shown.count()) && !cited) await page.keyboard.press('Escape');
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
    await hold(page, 2_500);
    await caption(
      page,
      'Check the source before you accept',
      'The exact passage the sentence is based on',
    );
    await click(page, page.getByTestId('suggestion-evidence').getByRole('button').first());
    await hold(page, 4_000);
    // Escape would dismiss the suggestion itself; the card closes when Refine is pressed.
  });

  await scene('refine', async () => {
    const bar = page.getByTestId('suggestion-bar');
    await caption(
      page,
      'Not quite right? Refine it',
      'Shorter, more formal, closer to your topic, a contrasting finding — or your own words',
    );
    await click(page, bar.getByRole('button', { name: 'Refine', exact: true }));
    await hold(page, 2_500);
    await click(page, page.getByRole('menuitem', { name: 'Shorter' }));
    await fast('refining', async () => {
      await page.getByTestId('suggestion-history').waitFor({ timeout: 90_000 });
    });
    await hold(page, 1_500);
    await caption(page, 'Step back to the earlier version with ‹ ›', 'And rate it with the thumbs');
    const history = page.getByTestId('suggestion-history');
    await click(page, history.getByRole('button', { name: 'Previous suggestion' }));
    await hold(page, 1_500);
    await click(page, history.getByRole('button', { name: 'Next suggestion' }));
    await click(page, bar.getByRole('button', { name: 'Useful suggestion', exact: true }));
    await hold(page, 1_500);
    await caption(
      page,
      'Nothing enters your thesis until you accept it',
      'Accept it all, or one word at a time',
    );
    await point(page, bar.getByRole('button', { name: 'One word', exact: true }));
    await hold(page, 1_200);
    await click(page, bar.getByRole('button', { name: 'Accept', exact: true }));
    await hold(page, 2_000);
  });

  await scene('more suggestions', async () => {
    await caption(page, 'Keep going, sentence by sentence');
    await page.keyboard.press('Control+End');
    await slowType(page, ' Studies in South India point to ', 50);
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
    await hold(page, 2_500);
    await click(
      page,
      page.getByTestId('suggestion-bar').getByRole('button', { name: 'Accept', exact: true }),
    );
    await hold(page, 1_500);
  });

  await scene('draft a section', async () => {
    await caption(
      page,
      'Draft a whole section from the papers you choose',
      'It arrives as a draft you accept, regenerate or discard',
    );
    await click(page, tab(page, 'sources'));
    const pinAll = page.getByRole('button', { name: 'Pin all' });
    if (await pinAll.count()) await click(page, pinAll);
    await endOfText(page);
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('Barriers to adoption');
    await page.getByRole('combobox', { name: 'Text' }).selectOption('Heading');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await hold(page, 1_000);
    await page.keyboard.press('Escape');
    await click(page, page.getByTestId('draft-section-button'));
    await fast('drafting', async () => {
      await editorOf(page).locator('[data-draft="true"]').first().waitFor({ timeout: 300_000 });
    });
    const block = editorOf(page).locator('[data-draft="true"]').first();
    await block.scrollIntoViewIfNeeded();
    await hold(page, 4_500);
    await click(page, block.getByRole('button', { name: /Accept/ }));
    await hold(page, 2_000);
  });

  await scene('slash menu', async () => {
    await caption(
      page,
      'Type “/” to insert anything',
      'Tables, equations, charts, diagrams, footnotes, an AI-use declaration',
    );
    await endOfText(page);
    await page.keyboard.press('Enter');
    await slowType(page, '/', 80);
    await page.getByTestId('slash-menu').waitFor();
    await hold(page, 3_000);
    await slowType(page, 'tab', 120);
    await hold(page, 1_200);
    await page.keyboard.press('Enter');
    await hold(page, 1_000);
    for (const cell of ['District', 'Users (%)']) {
      await slowType(page, cell, 50);
      await page.keyboard.press('Tab');
    }
    for (const cell of ['Madurai', '34', 'Salem', '21']) {
      await page.keyboard.press('Tab');
      await slowType(page, cell, 50);
    }
    await hold(page, 2_000);
  });

  await scene('equation', async () => {
    await caption(
      page,
      'Equations: say it in words, or snap a photo',
      'Typeset with a live preview and a cheat sheet',
    );
    await endOfText(page);
    await page.keyboard.press('Enter');
    await click(page, page.getByTestId('fmt-math'));
    const help = page.getByTestId('math-help');
    await help.waitFor();
    const words = help.getByTestId('math-words');
    await click(page, words.getByLabel(/describe it in words/i));
    await slowType(page, 'y equals beta zero plus beta one times x plus epsilon', 45);
    await click(page, words.getByRole('button', { name: 'Write it' }));
    await fast('equation from words', async () => {
      await help.getByTestId('math-words-reading').waitFor({ timeout: 60_000 });
    });
    await hold(page, 3_500);
    await click(page, page.getByTestId('inline-prompt-apply'));
    await hold(page, 2_000);
  });

  await scene('chart', async () => {
    await caption(
      page,
      'Charts drawn from your own numbers',
      'No AI involved — the numbers stay on the figure',
    );
    await endOfText(page);
    await page.keyboard.press('Enter');
    await click(page, page.getByTestId('fmt-chart'));
    const dialog = page.getByTestId('chart-dialog');
    await dialog.waitFor();
    await dialog.getByTestId('chart-title-input').fill('Mobile banking use by district');
    await dialog.getByLabel('Series 1 name').fill('Women using mobile banking (%)');
    const rows = [
      ['Madurai', '34'],
      ['Salem', '21'],
      ['Tirunelveli', '27'],
    ];
    for (const [i, [cat, val]] of rows.entries()) {
      const c = dialog.getByLabel(`Category ${i + 1}`);
      if (!(await c.count())) break;
      await c.fill(cat ?? '');
      await dialog.getByLabel(`Row ${i + 1}, series 1`).fill(val ?? '');
      await hold(page, 500);
    }
    await hold(page, 2_500);
    await click(page, dialog.getByTestId('chart-insert'));
    await hold(page, 2_500);
  });

  await scene('diagram', async () => {
    await caption(page, 'Diagrams from the steps you type', 'A research framework in seconds');
    await endOfText(page);
    await page.keyboard.press('Enter');
    await click(page, page.getByTestId('fmt-diagram'));
    const dialog = page.getByTestId('diagram-dialog');
    await dialog.waitFor();
    await click(page, dialog.getByTestId('diagram-source'));
    await slowType(
      page,
      'Digital literacy -> Trust\nTrust -> Mobile banking use\nHousehold norms -> Mobile banking use',
      30,
    );
    await dialog.getByTestId('diagram-title-input').fill('Conceptual framework');
    await hold(page, 2_500);
    await click(page, dialog.getByTestId('diagram-insert'));
    await hold(page, 2_500);
  });

  await scene('edit a selection', async () => {
    const para = editorOf(page).locator('p').filter({ hasText: 'Mobile banking' }).first();
    const box = await para.boundingBox();
    if (!box) throw new Error('no paragraph');
    await page.mouse.move(box.x + 2, box.y + 10, { steps: 25 });
    await page.mouse.click(box.x + 2, box.y + 10);
    await page.keyboard.press('Home');
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press('Shift+ArrowDown');
      await hold(page, 250);
    }
    await caption(
      page,
      'Select text to improve it',
      'Formalise, shorten, expand, hedge, active voice, translate, turn into a table…',
    );
    const toolbar = page.getByTestId('command-toolbar');
    await toolbar.waitFor({ timeout: 10_000 });
    await hold(page, 2_000);
    await click(page, toolbar.getByRole('button', { name: 'Formalise' }));
    await fast('formalising', async () => {
      await page.getByTestId('command-diff').waitFor({ timeout: 90_000 });
    });
    await caption(
      page,
      'You see exactly what would change',
      'Replace it, insert it below, or discard it',
    );
    await hold(page, 4_500);
    await click(page, page.getByTestId('command-apply'));
    await hold(page, 2_000);
  });

  // ── 3 · Ask and research ───────────────────────────────────────────────────────────────────
  await scene('card 3', async () => {
    await card(
      page,
      'Part 3',
      'Ask your library',
      ['Answers that cite your papers — and research that goes further'],
      2_500,
    );
    await goWrite();
  });

  await scene('chat', async () => {
    await click(page, tab(page, 'chat'));
    const panel = page.getByTestId('chat-panel');
    await caption(page, 'Ask a question about your papers', 'Every claim in the answer is cited');
    await click(page, panel.locator('textarea, input#chat-message').first());
    await slowType(page, 'What stops rural women in India from using mobile banking?', 40);
    await click(page, panel.getByRole('button', { name: 'Ask', exact: true }));
    await fast('chat answer', async () => {
      await panel.getByTestId('chat-rating').last().waitFor({ timeout: 150_000 });
    });
    await hold(page, 2_000);
    for (let i = 0; i < 3; i++) {
      await panel.hover();
      await page.mouse.wheel(0, 250);
      await hold(page, 1_200);
    }
    const add = panel.getByTestId('chat-add-to-document').last();
    if (await add.count()) {
      await caption(
        page,
        'Add the answer to your chapter',
        'With its citations, as text you then edit',
      );
      await point(page, add);
      await hold(page, 2_500);
    }
  });

  await scene('mention a paper', async () => {
    const panel = page.getByTestId('chat-panel');
    await caption(page, 'Type @ to ask about one paper', 'Or / for the prompts you have saved');
    const box = panel.locator('textarea, input#chat-message').first();
    await click(page, box);
    await slowType(page, '@', 100);
    const picker = panel.getByTestId('chat-mention-picker');
    await picker.waitFor({ timeout: 15_000 });
    await hold(page, 2_000);
    await click(page, picker.getByTestId('chat-mention-option').first());
    await slowType(page, 'What sample and method did this study use?', 40);
    await click(page, panel.getByRole('button', { name: 'Ask', exact: true }));
    await fast('mention answer', async () => {
      await panel.getByTestId('chat-rating').nth(1).waitFor({ timeout: 150_000 });
    });
    await hold(page, 4_000);
  });

  await scene('deep research', async () => {
    const panel = page.getByTestId('chat-panel');
    await caption(
      page,
      '“Research deeply” for the big questions',
      'It plans the question in parts, searches every index for each, and answers part by part',
    );
    // Deep research is offered for the whole library, not while a paper is @-mentioned.
    const stop = panel.getByRole('button', { name: /Stop answering from/ });
    while (await stop.count()) await click(page, stop.first());
    await click(page, panel.getByTestId('chat-deep-toggle'));
    await click(page, panel.locator('textarea, input#chat-message').first());
    await slowType(
      page,
      'How do trust, digital literacy and household norms shape mobile banking use by rural women?',
      32,
    );
    await click(page, panel.getByRole('button', { name: 'Ask', exact: true }));
    await fast('deep research', async () => {
      await panel.getByTestId('chat-rating').nth(2).waitFor({ timeout: 300_000 });
    });
    const headings = panel.getByTestId('chat-answer-heading');
    if (await headings.count()) await headings.first().scrollIntoViewIfNeeded();
    await hold(page, 3_000);
    for (let i = 0; i < 5; i++) {
      await panel.hover();
      await page.mouse.wheel(0, 300);
      await hold(page, 1_200);
    }
  });

  await scene('find papers', async () => {
    await caption(
      page,
      'Find papers right beside your text',
      'Read the passage, add it to your library, cite it where your cursor is',
    );
    await click(page, tab(page, 'papers'));
    const panel = page.getByTestId('find-papers');
    const search = panel.getByLabel('Search papers');
    await click(page, search);
    await slowType(page, 'digital literacy rural women financial inclusion', 40);
    await page.keyboard.press('Enter');
    await fast('paper search', async () => {
      await panel.getByTestId('paper-result').first().waitFor({ timeout: 90_000 });
    });
    await hold(page, 3_500);
    const first = panel.getByTestId('paper-result').first();
    await click(page, first.getByTestId('paper-add'));
    await fast('adding paper', async () => {
      await first.getByTestId('paper-cite').waitFor({ timeout: 120_000 });
    });
    await endOfText(page);
    await click(page, first.getByTestId('paper-cite'));
    await hold(page, 2_500);
  });

  // ── 4 · Your library ───────────────────────────────────────────────────────────────────────
  await scene('card 4', async () => {
    await card(
      page,
      'Part 4',
      'Your library, read for you',
      ['Every paper, how much of it was read, and where the gaps are'],
      2_500,
    );
  });

  await scene('library', async () => {
    await page.goto(`${WEB_URL}/app/d/${documentId}/sources`);
    await caption(
      page,
      'Every paper, and how much of it was read',
      'Full text or abstract · cited-by · open access · journal standing',
    );
    await hold(page, 4_000);
    await page.mouse.wheel(0, 350);
    await hold(page, 2_500);
    await page.mouse.wheel(0, -350);
    await caption(
      page,
      'Bring your own papers in',
      'PDFs, .bib and .ris files, your Zotero library, or chapters from Word',
    );
    for (const name of ['Import .bib / .ris', 'From Zotero', 'Add a PDF']) {
      const b = page.getByText(name, { exact: true }).first();
      if (await b.count()) await point(page, b);
      await hold(page, 900);
    }
    await caption(page, 'Keep papers for each chapter in collections');
    await click(page, page.getByTestId('new-collection'));
    await click(page, page.getByTestId('collection-name'));
    await slowType(page, 'Chapter 2 · Literature', 50);
    await click(page, page.getByTestId('collection-save'));
    await hold(page, 2_500);
  });

  await scene('reader', async () => {
    await caption(
      page,
      'Read any paper inside Thesis Copilot',
      'Search it, select a passage, cite it where you were writing',
    );
    // The new collection is empty and selected; the reader opens from All papers.
    await click(page, page.getByRole('button', { name: /^All papers/ }).first());
    await click(page, page.getByTestId('library-read-title').first());
    await page.getByTestId('paper-reader').waitFor({ timeout: 60_000 });
    await hold(page, 3_500);
    await page.keyboard.press('Control+f');
    await slowType(page, 'women', 90);
    await hold(page, 2_500);
    await page.keyboard.press('Escape');
    const selected = await page.evaluate(() => {
      const root =
        document.querySelector('[data-testid="pdf-text-layer"]') ??
        document.querySelector('[data-testid="text-view"]');
      if (!root) return false;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && (node.textContent ?? '').trim().length < 40) node = walker.nextNode();
      if (!node) return false;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, Math.min(120, node.textContent?.length ?? 0));
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return true;
    });
    if (!selected) throw new Error('nothing to select');
    const menu = page.getByTestId('reader-selection-menu');
    await menu.waitFor({ timeout: 10_000 });
    await hold(page, 2_500);
    await click(page, page.getByTestId('reader-cite'));
    await page.getByTestId('reader-cite-bar').waitFor({ timeout: 30_000 });
    await endOfText(page);
    await hold(page, 1_000);
    await click(page, page.getByTestId('reader-cite-here'));
    await hold(page, 2_500);
  });

  await scene('gap map', async () => {
    await page.goto(`${WEB_URL}/app/d/${documentId}/sources`);
    const discover = page
      .getByRole('button', { name: /^discover$/i })
      .or(page.getByRole('tab', { name: /^discover$/i }));
    await click(page, discover.first());
    await caption(
      page,
      'Discover: where the research gaps are',
      'Themes that are thin in the literature, marked as open gaps',
    );
    await click(page, page.getByRole('button', { name: 'Discover literature' }));
    await fast('gap map', async () => {
      await page.getByTestId('gap-map').waitFor({ timeout: 300_000 });
    });
    await page.getByTestId('gap-map').scrollIntoViewIfNeeded();
    await hold(page, 4_000);
    await page.mouse.wheel(0, 400);
    await hold(page, 2_500);
  });

  await scene('claims map', async () => {
    await caption(
      page,
      'The claims map',
      'What your papers claim — well supported, contested or under-explored — and what your thesis can do',
    );
    const run = page.getByTestId('claims-run');
    await click(page, run);
    await fast('claims map', async () => {
      await page.getByTestId('claim').first().waitFor({ timeout: 180_000 });
    });
    await page.getByTestId('claims-map').scrollIntoViewIfNeeded();
    await hold(page, 4_500);
    await page.mouse.wheel(0, 350);
    await hold(page, 2_500);
  });

  // ── 5 · Check before your guide does ───────────────────────────────────────────────────────
  await scene('card 5', async () => {
    await card(
      page,
      'Part 5',
      'Check before your guide does',
      ['An examiner, a proofreader and a citation checker, on call'],
      2_500,
    );
    await goWrite();
  });

  await scene('examiner review', async () => {
    await click(page, tab(page, 'check'));
    const review = page.getByTestId('examiner-review');
    await caption(
      page,
      'Examiner review',
      'A strict examiner reads your chapter against the papers it cites',
    );
    await click(page, review.getByTestId('run-examiner-review'));
    await fast('examiner review', async () => {
      await review.getByTestId('examiner-review-result').waitFor({ timeout: 300_000 });
    });
    await review.getByTestId('examiner-review-result').scrollIntoViewIfNeeded();
    await hold(page, 4_000);
    const flag = page.getByTestId('flag').first();
    if (await flag.count()) {
      await caption(
        page,
        'Each issue is flagged on the sentence',
        'Y to resolve, N to ignore — or Find a source for an unsupported claim',
      );
      await point(page, flag);
      await hold(page, 3_500);
    }
  });

  await scene('proofread', async () => {
    const panel = page.getByTestId('proofread-panel');
    await panel.scrollIntoViewIfNeeded();
    await caption(
      page,
      'Proofreading',
      'Spelling, grammar and punctuation — it never changes your words or meaning',
    );
    await click(page, panel.getByTestId('proofread-run'));
    await fast('proofreading', async () => {
      await panel.getByTestId('proofread-summary').waitFor({ timeout: 180_000 });
    });
    await hold(page, 4_000);
  });

  await scene('tone', async () => {
    const panel = page.getByTestId('tone-panel');
    await panel.scrollIntoViewIfNeeded();
    await caption(
      page,
      'Tone of voice',
      'Read against your own writing, or a paper you want to sound like',
    );
    await click(page, panel.getByTestId('tone-run'));
    await fast('tone review', async () => {
      await panel.getByTestId('proofread-summary').waitFor({ timeout: 420_000 });
    });
    await hold(page, 4_000);
  });

  await scene('citation report', async () => {
    await page.goto(`${WEB_URL}/app/d/${documentId}/submit`);
    await click(page, page.getByTestId('open-citation-report'));
    await page.waitForURL(/\/citations/, { timeout: 30_000 });
    await caption(
      page,
      'Every citation problem, on one page',
      'Missing sources, typed citations, claims a source does not support',
    );
    await hold(page, 5_000);
    await page.mouse.wheel(0, 350);
    await hold(page, 2_000);
  });

  await scene('originality', async () => {
    await page.goto(`${WEB_URL}/app/d/${documentId}/originality`);
    await caption(
      page,
      'Too close to a source?',
      'Paste a paragraph and see where it follows a paper too closely',
    );
    const box = page.getByPlaceholder('Paste a paragraph of your draft…');
    await click(page, box);
    await box.fill(
      'Mobile banking has the potential to expand financial access for rural women in Tamil Nadu; however, uptake remains uneven because of limited digital literacy and restricted smartphone access.',
    );
    await click(page, page.getByRole('button', { name: 'Check' }));
    await fast('originality', async () => {
      await page.getByTestId('overlap-report').waitFor({ timeout: 120_000 });
    });
    await hold(page, 4_500);
  });

  // ── 6 · Build and defend ───────────────────────────────────────────────────────────────────
  await scene('card 6', async () => {
    await card(
      page,
      'Part 6',
      'Build a chapter. Practise your viva.',
      ['A whole chapter from your library — every section a draft you approve'],
      2_500,
    );
  });

  await scene('chapter build', async () => {
    await page.goto(`${WEB_URL}/app/d/${documentId}/build`);
    await caption(
      page,
      'Build a chapter',
      'Planned from your objectives, written from your library, checked, then read by an examiner',
    );
    await hold(page, 3_000);
    await click(page, page.getByTestId('build-plan'));
    await fast('planning the chapter', async () => {
      await page.getByTestId('build-plan-editor').waitFor({ timeout: 180_000 });
    });
    await hold(page, 4_000);
    await page.mouse.wheel(0, 350);
    await hold(page, 2_000);
    await click(page, page.getByTestId('build-start'));
    await fast('building the chapter', async () => {
      await page.getByTestId('build-report').waitFor({ timeout: 40 * 60_000 });
    });
    await caption(
      page,
      'A quality report with every build',
      'Checks, open issues, key terms, references — download it as PDF',
    );
    await page.getByTestId('build-report').scrollIntoViewIfNeeded();
    await hold(page, 5_000);
  });

  await scene('viva', async () => {
    await page.goto(`${WEB_URL}/app/d/${documentId}/viva`);
    await caption(
      page,
      'Viva practice',
      'Questions an examiner would ask about your own thesis — and feedback on your answers',
    );
    await click(page, page.getByTestId('viva-ask'));
    await fast('viva questions', async () => {
      await page.getByTestId('viva-question').first().waitFor({ timeout: 180_000 });
    });
    await hold(page, 3_500);
    const first = page.getByTestId('viva-question').first();
    await click(page, first.getByTestId('viva-answer'));
    await slowType(
      page,
      'My study surveys women in three districts and tests how trust and digital literacy shape use, which earlier work assumed rather than measured.',
      25,
    );
    await click(page, first.getByTestId('viva-submit'));
    await fast('viva feedback', async () => {
      await first.getByTestId('viva-feedback').waitFor({ timeout: 180_000 });
    });
    await first.getByTestId('viva-feedback').scrollIntoViewIfNeeded();
    await hold(page, 5_000);
  });

  // ── 7 · Work with your guide ───────────────────────────────────────────────────────────────
  await scene('card 7', async () => {
    await card(
      page,
      'Part 7',
      'Work with your guide',
      ['Share as Guide, Co-author or Reader — and see every change'],
      2_500,
    );
    await goWrite();
  });

  let guideUrl = '';
  await scene('share', async () => {
    await caption(
      page,
      'Share with your guide',
      'Guide, Co-author or Reader — or a read-only link you can turn off',
    );
    await click(page, page.getByTestId('share-button'));
    await click(page, page.getByTestId('share-email'));
    await slowType(page, 'guide@university.ac.in', 50);
    await page.getByTestId('share-role').selectOption('GUIDE');
    await hold(page, 1_500);
    await click(page, page.getByTestId('share-send'));
    await hold(page, 2_000);
    await click(page, page.getByTestId('share-link-on'));
    await hold(page, 3_000);
    await page.keyboard.press('Escape');
  });

  await scene('guide view', async () => {
    const guideEmail = freshEmail('advert-guide');
    const made = await request.post(`${API_URL}/api/v1/documents/${documentId}/feedback/shares`, {
      headers: { cookie },
      data: { guideEmail },
    });
    guideUrl = ((await made.json()) as { url: string }).url;
    const guideRq = await playwright.request.newContext();
    const guide = await establishSession(guideRq, guideEmail);
    await guideRq.dispose();
    await context.clearCookies();
    await context.addCookies([cookieOf(guide)]);
    await page.goto(`${WEB_URL}${new URL(guideUrl).pathname}`);
    await caption(
      page,
      'What your guide sees',
      'Live progress, what changed since they last looked, comments pinned to the sentence',
    );
    await page.getByTestId('guide-progress').waitFor({ timeout: 60_000 });
    await hold(page, 4_500);
    await page.mouse.wheel(0, 400);
    await hold(page, 3_000);
    await context.clearCookies();
    await context.addCookies([cookieOf(session)]);
  });

  await scene('version history', async () => {
    await goWrite();
    await caption(page, 'Every version kept', 'See any earlier version and restore it');
    await click(page, page.getByTestId('open-history'));
    const history = page.getByTestId('version-history');
    const rows = history.getByTestId('version-row');
    await rows.first().waitFor({ timeout: 30_000 });
    await hold(page, 2_000);
    if ((await rows.count()) > 1) await click(page, rows.nth(1));
    await hold(page, 3_500);
    await page.keyboard.press('Escape');
  });

  // ── 8 · Submit ─────────────────────────────────────────────────────────────────────────────
  await scene('card 8', async () => {
    await card(
      page,
      'Part 8',
      'Submit with confidence',
      ['Your university’s format, any citation style, Word or PDF'],
      2_500,
    );
    await goWrite();
  });

  await scene('citation styles', async () => {
    await click(page, tab(page, 'citations'));
    const panel = page.getByTestId('citations-panel');
    await caption(
      page,
      'Over 10,000 citation styles',
      'Switch, and every citation and the reference list follow',
    );
    const switcher = panel.getByTestId('style-switcher');
    await point(page, switcher);
    const labels = await switcher.locator('option').allTextContents();
    const ieee = labels.find((l) => /IEEE/.test(l));
    if (ieee) await switcher.selectOption({ label: ieee });
    await caption(page, 'Now IEEE', 'Numbered citations, the reference list re-ordered');
    await hold(page, 4_500);
    const apa = labels.find((l) => /^APA/.test(l));
    if (apa) await switcher.selectOption({ label: apa });
    await hold(page, 2_000);
  });

  await scene('journals', async () => {
    await page.goto(`${WEB_URL}/app/d/${documentId}/journals`);
    await caption(
      page,
      'Where to publish',
      'Journals matched to your thesis and library — open access and fees shown',
    );
    await fast('matching journals', async () => {
      await page
        .getByText(/Matched on/)
        .first()
        .waitFor({ timeout: 120_000 });
    });
    await hold(page, 4_500);
  });

  await scene('submission', async () => {
    await page.goto(`${WEB_URL}/app/d/${documentId}/submit`);
    await caption(
      page,
      'Ten compliance checks against your university’s template',
      'Then Word, PDF, LaTeX or HTML — with a real contents page',
    );
    await page.getByTestId('compliance-checks').waitFor({ timeout: 30_000 });
    await hold(page, 3_500);
    await page.mouse.wheel(0, 500);
    await hold(page, 2_000);
    await click(page, page.getByTestId('export-docx'));
    await fast('exporting', async () => {
      await page.getByTestId('downloads').waitFor({ timeout: 120_000 });
    });
    await hold(page, 3_000);
  });

  // ── 9 · Anywhere ───────────────────────────────────────────────────────────────────────────
  await scene('card 9', async () => {
    await card(
      page,
      'Part 9',
      'Wherever you read and write',
      ['The Chrome add-on · your phone · Hindi · dark mode'],
      2_500,
    );
  });

  const popupFor = async (url: string) => {
    const article = await context.newPage();
    await article.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.goto(`${url}${url.includes('#') ? '' : '#shown'}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await hold(page, 3_000);
    const probe = await context.newPage();
    await probe.goto(`chrome-extension://${extensionId}/popup.html`);
    const tabId = await probe.evaluate(async (want) => {
      const { chrome } = globalThis as unknown as {
        chrome: { tabs: { query(q: object): Promise<Array<{ id?: number; url?: string }>> } };
      };
      return (await chrome.tabs.query({})).find((t) => t.url === want)?.id;
    }, url);
    await probe.close();
    await page.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
    await page.evaluate(() => {
      document.body.style.zoom = '1.5';
      document.body.style.maxWidth = '420px';
      document.body.style.margin = '12px auto';
    });
    return article;
  };

  await scene('add-on one paper', async () => {
    await caption(
      page,
      'Reading a paper on a journal site?',
      'The Chrome add-on saves it to your thesis in one click',
    );
    const article = await popupFor('https://arxiv.org/abs/1706.03762');
    await caption(page, 'The add-on reads the paper off the page', 'Title, authors, year and DOI');
    await hold(page, 2_500);
    const thesis = page.getByTestId('thesis');
    if (await thesis.count()) await thesis.selectOption(documentId).catch(() => undefined);
    await click(page, page.getByTestId('add'));
    await page.getByTestId('message').waitFor({ timeout: 60_000 });
    await caption(page, 'Saved — and read — in your library');
    await hold(page, 3_500);
    await article.close();
  });

  await scene('add-on results page', async () => {
    await caption(
      page,
      'Or a whole page of search results',
      'PubMed, arXiv and Google Scholar — tick the papers you want',
    );
    const article = await popupFor(
      'https://pubmed.ncbi.nlm.nih.gov/?term=mobile+phone+use+women+india',
    );
    await page.getByTestId('result').first().waitFor({ timeout: 30_000 });
    const thesis = page.getByTestId('thesis');
    if (await thesis.count()) await thesis.selectOption(documentId).catch(() => undefined);
    const boxes = page.getByTestId('result').locator('input[type="checkbox"]');
    for (let i = 0; i < Math.min(3, await boxes.count()); i++) {
      await point(page, boxes.nth(i));
      await boxes.nth(i).check();
      await hold(page, 500);
    }
    await click(page, page.getByTestId('save-many'));
    await fast('saving the list', async () => {
      await page.getByTestId('message').waitFor({ timeout: 120_000 });
    });
    await hold(page, 3_500);
    await article.close();
  });

  await scene('phone', async () => {
    // The caption is set first so the page that loads at phone width shows it, not the last one.
    await caption(page, 'On your phone too', 'Suggestions, chat and citations');
    await page.setViewportSize({ width: 390, height: 720 });
    await goWrite();
    await editorOf(page).locator('p').first().waitFor({ timeout: 60_000 });
    await hold(page, 3_000);
    const bar = page.getByTestId('mobile-bar');
    if (await bar.count()) {
      await click(page, bar.getByTestId('mobile-chat'));
      await hold(page, 3_000);
    }
    await page.setViewportSize(SIZE);
  });

  await scene('hindi and dark', async () => {
    await page.goto(`${WEB_URL}/app/settings`);
    await caption(
      page,
      'In Hindi, too',
      'Hindi interface (beta) — citations in the language you choose',
    );
    await page.getByTestId('interface-language').selectOption('hi');
    await page.getByRole('heading', { name: 'सेटिंग्स', level: 1 }).waitFor({ timeout: 30_000 });
    await hold(page, 2_500);
    await goWrite();
    // Wait for the chapter itself, not the "loading" line.
    await editorOf(page).locator('p').first().waitFor({ timeout: 60_000 });
    await hold(page, 4_000);
    await caption(page, '');
    await page.goto(`${WEB_URL}/app/settings`);
    await page.getByTestId('interface-language').selectOption('en');
    await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor({ timeout: 30_000 });
    await caption(page, 'Light, dark or high contrast');
    await goWrite();
    await editorOf(page).locator('p').first().waitFor({ timeout: 60_000 });
    const theme = page.getByRole('button', { name: /^Colour theme:/ }).first();
    if (await theme.count()) {
      await click(page, theme);
      await hold(page, 3_000);
      await click(page, theme);
      await click(page, theme);
    }
    await hold(page, 1_500);
  });

  await scene('end', async () => {
    await card(
      page,
      '',
      'Thesis Copilot',
      [
        'thesis.rademics.ai',
        'Cited suggestions · Draft sections · Chat over your library · Deep research · Gap and claims maps',
        'Examiner review · Proofreading · Viva practice · Chapter builds · Guide sharing',
        '10,000+ citation styles · Word, PDF and LaTeX · Chrome add-on · Hindi',
      ],
      7_000,
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
