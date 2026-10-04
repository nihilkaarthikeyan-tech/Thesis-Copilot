/**
 * ADR-0058: the citation locale. `PUT /documents/:id/citation-locale` changes one column and
 * re-renders; automatic English leaves a thesis exactly as it rendered before the choice existed;
 * a German thesis gets German terms without asking; an unknown locale is refused; the style
 * preview renders in the locale it is asked for; a copy keeps the choice.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

type Rendered = {
  labels: Record<string, string>;
  bibliography: Array<{ sourceId: string; text: string }>;
  citationLocale: string | null;
  localeOverride: string | null;
  locale: string;
  locales: Array<{ id: string; label: string }>;
};

describe('the citation locale', () => {
  let h: Harness;
  let documentId: string;
  let chapterId: string;

  const call = (path: string, init: RequestInit = {}) =>
    h.api(path, { ...init, headers: { origin: 'http://localhost:3000', ...(init.headers ?? {}) } });

  const setLocale = (locale: string | null) =>
    call(`/documents/${documentId}/citation-locale`, {
      method: 'PUT',
      body: JSON.stringify({ locale }),
    });

  beforeAll(async () => {
    h = await startHarness('citation-locale@example.com');
    const created = await call('/documents', {
      method: 'POST',
      body: JSON.stringify({ title: 'Drip irrigation uptake', entryPath: 'A_TOPIC' }),
    });
    const document = (await created.json()) as { id: string; firstChapterId: string };
    documentId = document.id;
    chapterId = document.firstChapterId;
    await h.prisma.document.update({
      where: { id: documentId },
      data: { citationStyle: 'harvard' },
    });

    // A book chapter: the edition, editor and access date are where the locales differ.
    const source = await h.prisma.source.create({
      data: {
        documentId,
        status: 'RESOLVED',
        title: 'A chapter',
        year: 2021,
        authors: [
          { family: 'Kumar', given: 'Anil' },
          { family: 'Rao', given: 'B' },
        ],
        cslJson: {
          type: 'chapter',
          title: 'A chapter',
          author: [
            { family: 'Kumar', given: 'Anil' },
            { family: 'Rao', given: 'B' },
          ],
          editor: [{ family: 'Ed', given: 'C' }],
          'container-title': 'Book',
          publisher: 'Pub',
          issued: { 'date-parts': [[2021, 3, 5]] },
          accessed: { 'date-parts': [[2024, 1, 2]] },
          edition: '2',
          URL: 'https://x.org/a',
        },
      },
    });
    const current = (await (await call(`/chapters/${chapterId}`)).json()) as { version: number };
    const saved = await call(`/chapters/${chapterId}`, {
      method: 'PUT',
      body: JSON.stringify({
        baseVersion: current.version,
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Uptake stalled ' },
                {
                  type: 'citation',
                  attrs: { key: 'cite-1', sourceId: source.id, role: 'parenthetical' },
                },
              ],
            },
          ],
        },
      }),
    });
    expect(saved.status).toBe(200);
  });

  afterAll(async () => {
    await h?.stop();
  });

  it('renders an English thesis exactly as before when nothing is chosen', async () => {
    const body = (await (await call(`/documents/${documentId}/citations`)).json()) as Rendered;
    expect(body.citationLocale).toBeNull();
    expect(body.localeOverride).toBeNull();
    expect(body.locale).toBe('en-US');
    expect(body.labels['cite-1']).toBe('(Kumar and Rao, 2021)');
    expect(body.bibliography[0]?.text).toContain('“A chapter,”');
    expect(body.bibliography[0]?.text).toContain('(Accessed: January 2, 2024)');
    expect(body.locales.map((l) => l.id)).toContain('en-GB');
  });

  it('switches to British English and back', async () => {
    const res = await setLocale('en-GB');
    expect(res.status).toBe(200);
    const gb = (await res.json()) as Rendered;
    expect(gb.citationLocale).toBe('en-GB');
    expect(gb.locale).toBe('en-GB');
    expect(gb.bibliography[0]?.text).toContain('‘A chapter’');
    expect(gb.bibliography[0]?.text).toContain('2nd edn');
    expect(gb.bibliography[0]?.text).toContain('(Accessed: 2 January 2024)');
    const row = await h.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(row.citationLocale).toBe('en-GB');

    const back = (await (await setLocale(null)).json()) as Rendered;
    expect(back.citationLocale).toBeNull();
    expect(back.locale).toBe('en-US');
  });

  it('follows a German thesis language without being asked', async () => {
    await h.prisma.document.update({ where: { id: documentId }, data: { language: 'de' } });
    const body = (await (await call(`/documents/${documentId}/citations`)).json()) as Rendered;
    expect(body.localeOverride).toBe('de-DE');
    expect(body.labels['cite-1']).toBe('(Kumar und Rao, 2021)');
    await h.prisma.document.update({ where: { id: documentId }, data: { language: 'en' } });
  });

  it('refuses a locale it cannot render', async () => {
    expect((await setLocale('en-IN')).status).toBe(400);
    expect((await setLocale('')).status).toBe(400);
    const row = await h.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(row.citationLocale).toBeNull();
  });

  it('previews a style in the locale asked for', async () => {
    const gb = await call('/citation-styles/harvard/preview?locale=en-GB');
    expect(gb.status).toBe(200);
    expect(((await gb.json()) as { bibliography: string }).bibliography).toContain('‘An example');
    const us = (await (await call('/citation-styles/harvard/preview')).json()) as {
      bibliography: string;
    };
    expect(us.bibliography).toContain('“An example');
    expect((await call('/citation-styles/harvard/preview?locale=xx-YY')).status).toBe(400);
  });

  it('keeps the choice on a copy', async () => {
    await setLocale('en-GB');
    const copied = await call(`/documents/${documentId}/copy`, { method: 'POST', body: '{}' });
    expect(copied.status).toBe(200);
    const { id } = (await copied.json()) as { id: string };
    const row = await h.prisma.document.findUniqueOrThrow({ where: { id } });
    expect(row.citationLocale).toBe('en-GB');
  });

  it('makes no AI call', async () => {
    expect(await h.prisma.aiCallLog.count({ where: { userId: h.userId } })).toBe(0);
  });
});
