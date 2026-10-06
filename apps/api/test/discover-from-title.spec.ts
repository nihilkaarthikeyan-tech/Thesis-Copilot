/**
 * Discover for a thesis started with "Start writing now" (2026-10-06): no proposal is saved, so
 * the search starts from the thesis title instead of refusing with "Save the proposal first".
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;

beforeAll(async () => {
  h = await startHarness('discover-title@example.com');
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('POST /documents/:id/search with no proposal', () => {
  it('starts a discover run from the thesis title', async () => {
    const document = await h.prisma.document.create({
      data: {
        ownerId: h.userId,
        title: 'Mobile banking adoption among rural women in Tamil Nadu',
        entryPath: 'A_TOPIC',
        memory: { create: { scope: {}, outline: [], glossary: {} } },
      },
    });
    const res = await h.api(`/documents/${document.id}/search`, {
      method: 'POST',
      body: JSON.stringify({ mode: 'discover' }),
    });
    expect(res.status).toBeLessThan(300);
    const body = (await res.json()) as { runId: string; mode: string };
    expect(body.mode).toBe('discover');
    expect(body.runId).toBeTruthy();
  });

  it('still refuses a thesis with neither a proposal nor a title', async () => {
    const document = await h.prisma.document.create({
      data: {
        ownerId: h.userId,
        title: '   ',
        entryPath: 'A_TOPIC',
        memory: { create: { scope: {}, outline: [], glossary: {} } },
      },
    });
    const res = await h.api(`/documents/${document.id}/search`, {
      method: 'POST',
      body: JSON.stringify({ mode: 'discover' }),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Give the thesis a title first');
  });
});
