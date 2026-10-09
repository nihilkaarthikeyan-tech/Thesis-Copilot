import { expect, test } from '@playwright/test';
import { seedRecordOnlySource } from './_db.js';
import { type LayoutFault, measureLayout, settle } from './_layout.js';
import { API_URL, establishSession, freshEmail } from './_session.js';

/**
 * Jenni build plan R25 (ADR-0112): the Source quality panel's bibliography notes — a
 * publication-year chart and the venue spread of the papers the open chapter cites. "Charts reflect
 * the chapter's citations": four papers cited (one twice, one with no year or venue on record), so
 * the chart and the words must count each paper once and leave the unknown one out, and the notes
 * must fit the 288 px panel on a laptop and the drawer on a phone.
 */

const thisYear = new Date().getUTCFullYear();

test('the source quality panel charts the years and venues of the chapter’s citations', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const session = await establishSession(request, freshEmail('source-notes'));
  const cookie = `${session.cookieName}=${session.cookieValue}`;
  await page
    .context()
    .addCookies([
      { name: session.cookieName, value: session.cookieValue, domain: 'localhost', path: '/' },
    ]);
  const created = await request.post(`${API_URL}/api/v1/documents`, {
    headers: { cookie },
    data: { title: `Source notes ${Date.now()}`, entryPath: 'A_TOPIC' },
  });
  const doc = (await created.json()) as { id: string; firstChapterId: string };

  const long =
    'International Journal of Environmental Research and Public Health in South and Southeast Asia';
  const ids = [
    await seedRecordOnlySource(doc.id, { title: 'Recent', year: thisYear - 2, venue: long }),
    await seedRecordOnlySource(doc.id, { title: 'Middle', year: thisYear - 6, venue: long }),
    await seedRecordOnlySource(doc.id, {
      title: 'Old',
      year: thisYear - 14,
      venue: 'Energy Policy',
    }),
    await seedRecordOnlySource(doc.id, { title: 'Unknown', year: null, venue: null }),
  ];
  const cite = (key: string, sourceId: string) => ({
    type: 'citation',
    attrs: { key, sourceId },
  });
  const chapter = (await (
    await request.get(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, { headers: { cookie } })
  ).json()) as { version: number };
  const saved = await request.put(`${API_URL}/api/v1/chapters/${doc.firstChapterId}`, {
    headers: { cookie },
    data: {
      baseVersion: chapter.version,
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Chapter 1' }] },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Rooftop solar adoption doubled' },
              cite('c1', ids[0] as string),
              { type: 'text', text: ', as earlier work found' },
              cite('c2', ids[0] as string),
              cite('c3', ids[1] as string),
              cite('c4', ids[2] as string),
              cite('c5', ids[3] as string),
              { type: 'text', text: '.' },
            ],
          },
        ],
      },
    },
  });
  expect(saved.ok(), `save: ${saved.status()}`).toBe(true);

  const found: Array<{ where: string } & LayoutFault> = [];
  for (const width of [1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/app/d/${doc.id}/write/${doc.firstChapterId}`);
    await expect(page.locator('.thesis-editor')).toBeVisible({ timeout: 30_000 });
    await settle(page);
    const panel = page.getByTestId('tool-panel');
    if (width < 1024) await page.getByTestId('mobile-sources').click();
    await panel.getByRole('tab', { name: 'check', exact: true }).click();
    await panel.getByTestId('source-quality-run').click();

    const notes = panel.getByTestId('bibliography-notes');
    await expect(notes).toContainText('The 4 works this chapter cites', { timeout: 20_000 });
    await expect(panel.getByTestId('bibliography-years')).toContainText(
      `Median year ${thisYear - 6}. One of 3 works is over a decade old (${thisYear - 11} or earlier). One paper with no year on record is not charted.`,
    );
    await expect(panel.getByTestId('bibliography-venues')).toContainText(
      '2 unique venues across 3 works. One paper with no venue on record.',
    );
    // The long journal name is cut with an ellipsis and kept whole in its tooltip.
    await expect(panel.getByTitle(long)).toBeVisible();
    await notes.scrollIntoViewIfNeeded();
    for (const fault of await page.evaluate(measureLayout, false)) {
      found.push({ where: `${width}`, ...fault });
    }
    if (width === 1280 || width === 390) {
      await notes.screenshot({ path: `test-results/source-notes-${width}.png` });
    }
  }

  expect(
    found,
    found
      .map((f) => `${f.where}: ${f.kind} ${f.by ?? ''}px ${f.el ?? ''} in ${f.box ?? ''}`)
      .join('\n'),
  ).toEqual([]);
});
