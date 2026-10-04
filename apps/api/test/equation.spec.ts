/**
 * `POST /equations/from-words` (ADR-0063), against real Postgres and Redis with the mock model.
 * The cap test every metered AI action carries: one COMMAND unit, taken before the call, given
 * back when nothing usable came of it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { periodFor } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;

beforeAll(async () => {
  h = await startHarness('equation@example.com');
  const created = await h.api('/documents', {
    method: 'POST',
    body: JSON.stringify({ title: 'Equations', entryPath: 'A_TOPIC' }),
  });
  documentId = ((await created.json()) as { id: string }).id;
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

const ask = (description: string, extra: Record<string, unknown> = {}) =>
  h.api('/equations/from-words', {
    method: 'POST',
    body: JSON.stringify({ documentId, description, ...extra }),
  });

async function commandsUsed(): Promise<number> {
  const row = await h.prisma.usageLedger.findFirst({
    where: { userId: h.userId, action: 'COMMAND', period: periodFor() },
  });
  return row?.count ?? 0;
}

describe('an equation described in words', () => {
  it('returns LaTeX that renders, and its reading, for one COMMAND unit', async () => {
    const before = await commandsUsed();
    const res = await ask('alpha over n');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      latex: '\\frac{\\alpha}{n}',
      reading: 'alpha over n',
    });
    expect(await commandsUsed()).toBe(before + 1);
    const call = await h.prisma.aiCallLog.findFirst({
      where: { userId: h.userId, action: 'COMMAND' },
      orderBy: { createdAt: 'desc' },
    });
    expect(call?.ok).toBe(true);
  });

  it('gives the unit back when the answer does not render', async () => {
    const before = await commandsUsed();
    // The mock passes an unknown phrase through as text; a lone brace cannot render.
    const res = await ask('{ open brace');
    const body = (await res.json()) as { ok: boolean; refusal?: string };
    expect(body.ok).toBe(false);
    expect(body.refusal).toBeTruthy();
    expect(await commandsUsed()).toBe(before);
  });

  it('at the cap, refuses with 429 before any model call', async () => {
    await h.prisma.usageLedger.upsert({
      where: { userId_period_action: { userId: h.userId, period: periodFor(), action: 'COMMAND' } },
      create: { userId: h.userId, period: periodFor(), action: 'COMMAND', count: 1_000 },
      update: { count: 1_000 },
    });
    const calls = await h.prisma.aiCallLog.count({ where: { userId: h.userId } });
    const res = await ask('beta over two');
    expect(res.status).toBe(429);
    expect(await h.prisma.aiCallLog.count({ where: { userId: h.userId } })).toBe(calls);
    await h.prisma.usageLedger.updateMany({
      where: { userId: h.userId, action: 'COMMAND' },
      data: { count: 0 },
    });
  });

  it('refuses an empty description, someone else’s thesis, and a description too long', async () => {
    expect((await ask('')).status).toBe(400);
    expect((await ask('x'.repeat(700))).status).toBe(400);
    const other = await h.api('/equations/from-words', {
      method: 'POST',
      body: JSON.stringify({
        documentId: '01a10000-0000-7000-8000-000000000000',
        description: 'a over b',
      }),
    });
    expect(other.status).toBe(404);
  });

  it('reads an equation from a PNG for one unit, and refuses a file that is not a picture', async () => {
    const upload = (bytes: Uint8Array, name: string) => {
      const form = new FormData();
      form.append('file', new Blob([bytes]), name);
      // Straight to fetch: the harness's helper sets a JSON content type, which breaks multipart.
      return fetch(`${h.baseUrl}/api/v1/equations/from-photo?documentId=${documentId}`, {
        method: 'POST',
        headers: { cookie: h.cookie },
        body: form,
      });
    };
    const before = await commandsUsed();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const res = await upload(png, 'equation.png');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, latex: 'E = mc^{2}' });
    expect(await commandsUsed()).toBe(before + 1);

    // A text file named .png is still refused, and costs nothing.
    const fake = await upload(new TextEncoder().encode('not an image'), 'equation.png');
    expect(fake.status).toBe(400);
    expect(await commandsUsed()).toBe(before + 1);
  });
});
