/**
 * ADR-0087: the setup steps after the title — structure and source preferences on create.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;

beforeAll(async () => {
  h = await startHarness('start-setup@example.com');
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const prefs = {
  webSearch: true,
  librarySearch: true,
  yearFrom: 2022,
  yearTo: null,
  indexedIn: ['doaj', 'abdc'],
  preprints: false,
};

describe('POST /documents with the setup steps', () => {
  it('Standard headings make the six thesis chapters at once, each with its note', async () => {
    const res = await h.api('/documents', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Mobile banking adoption among rural women in Tamil Nadu',
        entryPath: 'A_TOPIC',
        start: 'writing',
        structure: 'standard',
        sourcePrefs: prefs,
      }),
    });
    expect(res.status).toBeLessThan(300);
    const { id } = (await res.json()) as { id: string };
    const chapters = await h.prisma.chapter.findMany({
      where: { documentId: id },
      orderBy: { order: 'asc' },
      select: { title: true, scopeNote: true },
    });
    expect(chapters.map((c) => c.title)).toEqual([
      'Introduction',
      'Literature Review',
      'Methodology',
      'Results',
      'Discussion',
      'Conclusion and Future Work',
    ]);
    expect(chapters.every((c) => (c.scopeNote ?? '').length > 0)).toBe(true);
    const doc = await h.prisma.document.findUnique({ where: { id }, select: { meta: true } });
    expect((doc?.meta as { sourcePrefs?: unknown } | undefined)?.sourcePrefs).toEqual(prefs);
    const memory = await h.prisma.documentMemory.findUnique({
      where: { documentId: id },
      select: { outline: true },
    });
    expect((memory?.outline as unknown[] | undefined)?.length).toBe(6);
  });

  it('Smart headings plan from the title at once, but not when the questions come first (ADR-0091)', async () => {
    const make = async (askFirst: boolean) => {
      const res = await h.api('/documents', {
        method: 'POST',
        body: JSON.stringify({
          title: `Mobile banking adoption among women SHGs ${askFirst ? 'asked' : 'plain'}`,
          entryPath: 'A_TOPIC',
          start: 'writing',
          structure: 'smart',
          ...(askFirst ? { askFirst: true } : {}),
        }),
      });
      const { id } = (await res.json()) as { id: string };
      const doc = await h.prisma.document.findUnique({ where: { id }, select: { meta: true } });
      return (doc?.meta as { outlineRun?: { status?: string } } | null)?.outlineRun?.status;
    };
    expect(await make(false)).toBe('RUNNING');
    expect(await make(true)).toBeUndefined();
  });

  it('No headings keeps one chapter', async () => {
    const res = await h.api('/documents', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Solar dryers for small fishing communities',
        entryPath: 'A_TOPIC',
        start: 'writing',
        structure: 'none',
      }),
    });
    const { id } = (await res.json()) as { id: string };
    expect(await h.prisma.chapter.count({ where: { documentId: id } })).toBe(1);
  });

  it('refuses both searches off', async () => {
    const res = await h.api('/documents', {
      method: 'POST',
      body: JSON.stringify({
        title: 'A thesis',
        entryPath: 'A_TOPIC',
        sourcePrefs: { ...prefs, webSearch: false, librarySearch: false },
      }),
    });
    expect(res.status).toBe(400);
  });
});
