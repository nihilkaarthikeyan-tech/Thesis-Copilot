/**
 * `GET /citation-styles/:id/preview` (2026-10-04): a style shown before it is chosen, rendered by
 * citeproc from a fixed example reference. No model call, a session needed, an unknown style a
 * 404, and the same answer from the cache the second time.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

type Preview = {
  styleId: string;
  label: string;
  family: string;
  noteStyle: boolean;
  inText: string;
  bibliography: string;
  sampleLabel: string;
};

describe('citation style preview', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness('style-preview@example.com');
  });

  afterAll(async () => {
    await h?.stop();
  });

  it('renders a shipped style from the example reference', async () => {
    const res = await h.api('/citation-styles/apa/preview');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Preview;
    expect(body.styleId).toBe('apa');
    expect(body.family).toBe('author-date');
    expect(body.inText).toBe('(Example & Sample, 2024)');
    expect(body.bibliography).toContain('Journal of Example Studies');
    expect(body.sampleLabel).toMatch(/not a real paper/);
  });

  it('numbers a numeric style', async () => {
    const res = await h.api('/citation-styles/vancouver/preview');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Preview;
    expect(body.family).toBe('numeric');
    expect(body.inText).toMatch(/1/);
  });

  it('answers the same from the cache', async () => {
    const first = await (await h.api('/citation-styles/ieee/preview')).json();
    const second = await (await h.api('/citation-styles/ieee/preview')).json();
    expect(second).toEqual(first);
  });

  it('makes no AI call', async () => {
    const calls = await h.prisma.aiCallLog.count({ where: { userId: h.userId } });
    expect(calls).toBe(0);
  });

  it('is a 404 for a style that does not exist', async () => {
    const res = await h.api('/citation-styles/no-such-style-anywhere/preview');
    expect(res.status).toBe(404);
  });

  it('needs a session', async () => {
    const res = await fetch(`${h.baseUrl}/api/v1/citation-styles/apa/preview`);
    expect(res.status).toBe(401);
  });
});
