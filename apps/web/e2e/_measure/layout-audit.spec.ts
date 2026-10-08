/**
 * Layout audit (2026-10-08). The owner found the chapter rail's word counts cut off under the
 * editor: a list wider than its column, invisible to every test that reads text. This visits
 * every screen a student sees, at five widths, and measures three faults:
 *
 * - **The page is wider than the window** (a sideways scrollbar).
 * - **Something sticks out of its box** — a rail, panel, card, list item, button or table cell —
 *   or is cut off by it. Popovers and other positioned overlays are left out; they float on
 *   purpose. A box that scrolls is fine.
 * - **Text cut mid-word** by a hidden overflow with no ellipsis.
 *
 * Not a test: a recorder. `MEASURE=1` runs it, against the running dev stack, signed in as
 * `AUDIT_EMAIL` on that account's thesis `AUDIT_DOC` / chapter `AUDIT_CHAPTER`. The report goes to
 * `AUDIT_OUT` (default: the OS temp folder) and the console.
 */

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { type LayoutFault, measureLayout, settle } from '../_layout.js';
import { API_URL, establishSession } from '../_session.js';

const EMAIL = process.env.AUDIT_EMAIL ?? 'r1-midsentence@example.com';
const DOC = process.env.AUDIT_DOC ?? '01a11610-10d3-7824-9e6d-d73a0d1dbea8';
const CHAPTER = process.env.AUDIT_CHAPTER ?? '01a11610-10de-7cdd-ac92-3cfa54a8db43';
const OUT = process.env.AUDIT_OUT ?? join(tmpdir(), 'layout-audit.json');
const WIDTHS = (process.env.AUDIT_WIDTHS ?? '1440,1280,1024,768,390').split(',').map(Number);
/** Only the routes containing one of these (comma-separated), and each fault's HTML. */
const ONLY = process.env.AUDIT_ONLY?.split(',');
const DETAIL = Boolean(process.env.AUDIT_DETAIL);

test('layout audit: nothing sticks out, nothing is cut, no sideways scroll', async ({
  page,
  request,
}) => {
  test.setTimeout(45 * 60_000);
  const session = await establishSession(request, EMAIL);
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const sources = (await (
    await request.get(`${API_URL}/api/v1/documents/${DOC}/sources`, { headers: { cookie } })
  ).json()) as Array<{ id: string }>;
  const sourceId = sources[0]?.id;

  const d = `/app/d/${DOC}`;
  const routes = [
    '/',
    '/pricing',
    '/help',
    '/changelog',
    '/contact',
    '/privacy',
    '/terms',
    '/refunds',
    '/app',
    '/app/new',
    '/app/account',
    '/app/settings',
    `${d}/proposal`,
    `${d}/outline`,
    `${d}/sources`,
    ...(sourceId ? [`${d}/sources/${sourceId}`] : []),
    `${d}/citations`,
    `${d}/journals`,
    `${d}/originality`,
    `${d}/review`,
    `${d}/submit`,
    `${d}/viva`,
    `${d}/build`,
    `${d}/write/${CHAPTER}`,
  ];
  const TABS = ['sources', 'papers', 'citations', 'chat', 'check', 'comments'];

  const report: Array<{ route: string; width: number; faults: LayoutFault[] }> = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      if (ONLY && !ONLY.some((o) => route.includes(o))) continue;
      await page.goto(route);
      await settle(page);
      report.push({ route, width, faults: await page.evaluate(measureLayout, DETAIL) });
      if (route.includes('/write/')) {
        for (const tab of TABS) {
          // Wide: the panel's own tabs. Narrow: the bottom bar opens the panel as a drawer.
          const inPanel = page.getByRole('tab', { name: tab, exact: true });
          if (await inPanel.isVisible().catch(() => false)) {
            await inPanel.click();
          } else {
            const bottom = page.getByTestId(
              `mobile-${tab === 'check' ? 'flags' : tab === 'comments' ? 'review' : tab}`,
            );
            if (!(await bottom.isVisible().catch(() => false))) continue;
            await bottom.click();
          }
          await page.waitForTimeout(1_500);
          report.push({
            route: `${route} [${tab}]`,
            width,
            faults: await page.evaluate(measureLayout, DETAIL),
          });
        }
      }
    }
  }

  writeFileSync(OUT, JSON.stringify(report, null, 2));
  const bad = report.filter((r) => r.faults.length > 0);
  console.log(`\n${report.length} screens measured, ${bad.length} with faults. Report: ${OUT}`);
  for (const r of bad) {
    console.log(`\n${r.width}px ${r.route}`);
    for (const f of r.faults.slice(0, 8)) {
      console.log(
        `  - ${f.kind}${f.by ? ` (${f.by}px)` : ''}${f.el ? `: ${f.el}` : ''}${f.box ? ` in ${f.box}` : ''}`,
      );
    }
    if (r.faults.length > 8) console.log(`  … and ${r.faults.length - 8} more`);
  }
});
