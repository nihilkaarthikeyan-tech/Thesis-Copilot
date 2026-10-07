/**
 * Jenni build plan R6 — the source settings changed from inside the editor.
 *
 * Pinned:
 * - `PUT /documents/:id/source-prefs` stores the settings on `meta.sourcePrefs` and nothing else on
 *   `meta` is touched (the proposal conversation stays).
 * - A later change replaces the earlier one.
 * - Both searches off, or another student's thesis, is refused.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;

const PREFS = {
  webSearch: true,
  librarySearch: true,
  yearFrom: 2018,
  yearTo: null,
  indexedIn: ['doaj'],
  preprints: false,
};

async function put(id: string, body: unknown): Promise<Response> {
  return h.api(`/documents/${id}/source-prefs`, { method: 'PUT', body: JSON.stringify(body) });
}

beforeAll(async () => {
  h = await startHarness('source-prefs-edit@example.com');
  const document = await h.prisma.document.create({
    data: {
      ownerId: h.userId,
      title: 'Rooftop solar in Karnataka',
      entryPath: 'A_TOPIC',
      meta: { proposalChat: { messages: [{ role: 'user', content: 'Rooftop solar' }] } },
    },
  });
  documentId = document.id;
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('source settings inside the editor', () => {
  it('stores the settings and leaves the rest of meta alone', async () => {
    const res = await put(documentId, PREFS);
    expect(res.status).toBe(200);
    const doc = await h.prisma.document.findUnique({
      where: { id: documentId },
      select: { meta: true },
    });
    const meta = doc?.meta as { sourcePrefs?: unknown; proposalChat?: { messages: unknown[] } };
    expect(meta.sourcePrefs).toEqual(PREFS);
    expect(meta.proposalChat?.messages).toHaveLength(1);
  });

  it('a later change replaces the earlier one', async () => {
    const next = { ...PREFS, webSearch: false, indexedIn: [] };
    expect((await put(documentId, next)).status).toBe(200);
    const doc = await h.prisma.document.findUnique({
      where: { id: documentId },
      select: { meta: true },
    });
    expect((doc?.meta as { sourcePrefs?: unknown } | undefined)?.sourcePrefs).toEqual(next);
  });

  it('refuses both searches off, and a thesis that is not yours', async () => {
    expect(
      (await put(documentId, { ...PREFS, webSearch: false, librarySearch: false })).status,
    ).toBe(400);
    const stranger = await h.prisma.user.create({
      data: { email: 'stranger-prefs@example.com', name: 'Stranger' },
    });
    const theirs = await h.prisma.document.create({
      data: { ownerId: stranger.id, title: 'Theirs', entryPath: 'A_TOPIC' },
    });
    expect((await put(theirs.id, PREFS)).status).toBe(404);
  });
});
