import { expect, test } from '@playwright/test';
import { type LayoutFault, measureLayout, settle } from './_layout.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * The layout guard (2026-10-08). The owner's screenshot showed the chapter rail's word counts cut
 * off under the editor, and the audit that followed (`_measure/layout-audit.spec.ts`) found the
 * side panel's tabs running off the screen, the thesis cards' links scrolling a phone sideways,
 * and the outline's buttons pushed out of their rows. Every test that reads text passed through
 * all of it. This measures the screens where they were — with long section titles, the case that
 * broke the rail — at a laptop's widths and a phone's, and fails on anything that sticks out of
 * its box, is cut without an ellipsis, or makes the page wider than the window.
 */

const SECTIONS = [
  'Problem statement and the gap it addresses',
  'Objectives and research questions of the present study',
  'Scope and limitations of the study in its setting',
];

const heading = (level: number, text: string) => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
});
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

test('the editor, the thesis list and the outline fit their boxes on a laptop and a phone', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000);
  const session = await establishSession(request, freshEmail('layout'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: {
      title: `Night-time urban heat islands and heat illness among outdoor workers ${Date.now()}`,
      entryPath: 'A_TOPIC',
    },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  // An outline of three chapters with long section titles, as a generated outline has.
  const outline = ['Introduction', 'Literature Review', 'Conclusion and Future Work'].map(
    (title, i) => ({
      id: `ch${i + 1}`,
      title,
      scopeNote: `What chapter ${i + 1} must cover.`,
      children: SECTIONS.map((s, j) => ({
        id: `ch${i + 1}-sec${j + 1}`,
        title: s,
        scopeNote: '',
        children: [],
      })),
    }),
  );
  const saved = await request.put(`${API_URL}/api/v1/documents/${doc.id}/memory/outline`, {
    headers: { cookie },
    data: { outline },
  });
  expect(saved.ok(), `outline: ${saved.status()}`).toBe(true);

  // The first chapter with those sections as headings: the rail lists them under its name.
  const chapter = (await (
    await request.get(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, { headers: { cookie } })
  ).json()) as { version: number };
  const content = {
    type: 'doc',
    content: [
      heading(1, 'Introduction'),
      ...SECTIONS.flatMap((s) => [
        heading(2, s),
        para('Night-time heat in Chennai keeps outdoor workers from recovering.'),
      ]),
    ],
  };
  const put = await request.put(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
    headers: { cookie },
    data: { content, baseVersion: chapter.version },
  });
  expect(put.ok(), `chapter: ${put.status()}`).toBe(true);

  const found: Array<{ where: string } & LayoutFault> = [];
  const check = async (where: string) => {
    for (const fault of await page.evaluate(measureLayout, false)) found.push({ where, ...fault });
  };
  const TABS = ['sources', 'papers', 'citations', 'chat', 'flags', 'review'];

  for (const width of [1280, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });

    await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
    await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
    await settle(page);
    await check(`${width} editor`);
    // R32 (ADR-0127): the theses beside the open one, unfolded at the top of the rail (remembered
    // open after the first width). On a phone the rail is a drawer, measured in
    // documents-beside.spec.ts.
    if (width >= 768) {
      const toggle = page.getByTestId('thesis-switcher-toggle');
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
      await expect(page.getByTestId('thesis-switcher-list')).toBeVisible();
      await check(`${width} editor [theses open]`);
    }
    // On a phone the panel is a drawer: opened from the bottom bar, then its own tabs, as a
    // student does; the drawer covers the bottom bar while it is open.
    const panel = page.getByTestId('tool-panel');
    if (width < 1024) await page.getByTestId('mobile-sources').click();
    for (const [index, tab] of TABS.entries()) {
      await panel.locator('[role="tablist"] [role="tab"]').nth(index).click();
      await page.waitForTimeout(1_000);
      // "Every check, in one list" is folded shut until opened; measure it open.
      if (tab === 'flags') await panel.getByTestId('checks-index').locator('summary').click();
      await check(`${width} editor [${tab}]`);
    }
    if (width < 1024) {
      await panel.getByRole('button', { name: 'Close', exact: true }).first().click();
    }

    await page.goto('/app');
    await settle(page);
    await check(`${width} thesis list`);
    // QA 2026-10-08: the card's "More" menu opened 41 px past the left edge at 390, where the
    // card's links wrap and "More" lands on the left; the guard skipped positioned menus then.
    const more = page.getByTestId('thesis-more').first();
    await more.click();
    await expect(page.getByTestId('thesis-more-items').first()).toBeVisible();
    await page.waitForTimeout(300);
    await check(`${width} thesis list [More open]`);
    const menu = await page.getByTestId('thesis-more-items').first().boundingBox();
    expect(menu, 'the More menu is laid out').not.toBeNull();
    if (menu) {
      expect(menu.x, `${width}: More menu left edge`).toBeGreaterThanOrEqual(0);
      expect(menu.x + menu.width, `${width}: More menu right edge`).toBeLessThanOrEqual(width);
    }
    await more.click();

    await page.goto(`/app/d/${doc.id}/outline`);
    await settle(page);
    await check(`${width} outline`);
  }

  expect(
    found,
    found
      .map((f) => `${f.where}: ${f.kind} ${f.by ?? ''}px ${f.el ?? ''} in ${f.box ?? ''}`)
      .join('\n'),
  ).toEqual([]);
});
