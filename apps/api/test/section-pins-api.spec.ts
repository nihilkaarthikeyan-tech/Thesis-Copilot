/**
 * Pins per section through the API — ADR-0085. The chapter's pins and a section's own are kept
 * apart; reading with `?section=` returns both; setting with `section` replaces only that
 * section's; a heading is matched by its key ("2.1 Financial Constraints" is "financial
 * constraints"); a source outside the thesis is refused either way.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let chapterId: string;
let a: string;
let b: string;

beforeAll(async () => {
  h = await startHarness('section-pins@example.com');
  const document = await h.prisma.document.create({
    data: { ownerId: h.userId, title: 'Rooftop solar', entryPath: 'A_TOPIC' },
  });
  const chapter = await h.prisma.chapter.create({
    data: {
      documentId: document.id,
      outlineNodeId: 'n1',
      title: 'Literature Review',
      scopeNote: null,
      order: 1,
      content: { type: 'doc', content: [] },
    },
  });
  chapterId = chapter.id;
  const sources = await Promise.all(
    ['A', 'B'].map((t) =>
      h.prisma.source.create({
        data: { documentId: document.id, status: 'RESOLVED', title: t, groundingLevel: 'ABSTRACT' },
      }),
    ),
  );
  a = sources[0]?.id as string;
  b = sources[1]?.id as string;
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('pins per section', () => {
  it('the chapter’s and a section’s pins are kept apart, and read together', async () => {
    await h.api(`/chapters/${chapterId}/pins`, {
      method: 'PUT',
      body: JSON.stringify({ sourceIds: [a, b] }),
    });
    const set = await h.api(`/chapters/${chapterId}/pins`, {
      method: 'PUT',
      body: JSON.stringify({ sourceIds: [b], section: '2.1 Financial Constraints' }),
    });
    expect(set.status).toBe(200);

    const chapterOnly = (await (await h.api(`/chapters/${chapterId}/pins`)).json()) as {
      sourceIds: string[];
      section?: unknown;
    };
    expect(chapterOnly.sourceIds.sort()).toEqual([a, b].sort());
    expect(chapterOnly.section).toBeUndefined();

    const withSection = (await (
      await h.api(
        `/chapters/${chapterId}/pins?section=${encodeURIComponent('Financial constraints')}`,
      )
    ).json()) as { sourceIds: string[]; section?: { title: string; sourceIds: string[] } };
    expect(withSection.sourceIds.sort()).toEqual([a, b].sort());
    expect(withSection.section).toEqual({ title: 'Financial constraints', sourceIds: [b] });

    const other = (await (
      await h.api(`/chapters/${chapterId}/pins?section=${encodeURIComponent('Trust')}`)
    ).json()) as { section?: { sourceIds: string[] } };
    expect(other.section).toEqual({ title: 'Trust', sourceIds: [] });
  });

  it('clearing a section’s pins leaves the chapter’s', async () => {
    await h.api(`/chapters/${chapterId}/pins`, {
      method: 'PUT',
      body: JSON.stringify({ sourceIds: [], section: 'Financial constraints' }),
    });
    const after = (await (await h.api(`/chapters/${chapterId}/pins`)).json()) as {
      sourceIds: string[];
    };
    expect(after.sourceIds.sort()).toEqual([a, b].sort());
  });

  it('a source outside the thesis is refused for a section too', async () => {
    const res = await h.api(`/chapters/${chapterId}/pins`, {
      method: 'PUT',
      body: JSON.stringify({
        sourceIds: ['01a10000-0000-7000-8000-00000000beef'],
        section: 'Trust',
      }),
    });
    expect(res.status).toBe(400);
  });
});
