/**
 * Import from Zotero by API key, through the real API — ADR-0062.
 *
 * Zotero itself is faked at the fetch boundary: `globalThis.fetch` is wrapped so a request to
 * api.zotero.org gets a documented-shape response (`_zotero.ts`) and everything else — the
 * harness's own calls to the API — goes through untouched.
 *
 * The last test is the one the ADR promises: after every route has been exercised with the key,
 * including the failures, the key is in no table, no Redis value and no log call.
 */

import { Logger } from '@nestjs/common';
import { jobId, jobKeyDigest } from '@tc/types';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, type MockInstance, vi } from 'vitest';
import { type Harness, startHarness } from './_harness.js';
import { COLLECTIONS, ITEMS, USER_ID, zoteroResponse } from './_zotero.js';

/** Shaped like a Zotero key, and unique enough that finding it anywhere means it leaked. */
const KEY = 'Zk7Lq2Wm9Xp4Rt6Yv8Bn3Cd5';

let h: Harness;
let documentId: string;
let redis: Redis;
let queue: Queue;

type ZoteroCall = { url: string; headers: Record<string, string> };
const zoteroCalls: ZoteroCall[] = [];
/** What the fake Zotero answers next; reset per test. */
let zotero: (url: string) => Response | Promise<Response> = () => zoteroResponse([], 0);

const realFetch = globalThis.fetch.bind(globalThis);
const logSpies: MockInstance[] = [];
const logged: string[] = [];

beforeAll(async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://api.zotero.org/')) {
      zoteroCalls.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
      return zotero(url);
    }
    return realFetch(input, init);
  });

  h = await startHarness('zotero-import@example.com');
  // Every way something reaches a log. Installed after sign-in, because the harness spies on
  // console.log itself to read the one-time code and restores it afterwards.
  const record = (...args: unknown[]) => {
    logged.push(args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' '));
  };
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    logSpies.push(
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => record(...args)),
    );
  }
  for (const method of ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const) {
    logSpies.push(
      vi
        .spyOn(Logger.prototype, method)
        .mockImplementation((...args: unknown[]) => record(...args)),
    );
  }
  const stdout = process.stdout.write.bind(process.stdout);
  logSpies.push(
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
      record(String(chunk));
      return (stdout as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stdout.write),
  );
  const stderr = process.stderr.write.bind(process.stderr);
  logSpies.push(
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
      record(String(chunk));
      return (stderr as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stderr.write),
  );

  const document = await h.prisma.document.create({
    data: { ownerId: h.userId, title: 'Fish drying', entryPath: 'A_TOPIC' },
  });
  documentId = document.id;
  redis = new Redis(process.env.REDIS_URL ?? '', { maxRetriesPerRequest: null });
  queue = new Queue('resolve-reference', { connection: redis });
}, 300_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await queue?.close();
  await redis?.quit();
  await h?.stop();
});

function safeStringify(value: unknown): string {
  try {
    if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`;
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

const post = (path: string, body: unknown) =>
  h.api(`/documents/${documentId}/sources/zotero/${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

describe('checking the key', () => {
  it('refuses a malformed user ID without calling Zotero or echoing the key', async () => {
    zoteroCalls.length = 0;
    const res = await post('collections', { userId: 'student', apiKey: KEY });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain('the number shown on the keys page');
    expect(text).not.toContain(KEY);
    expect(zoteroCalls).toHaveLength(0);
  });

  it('lists the collections, sending the key in the header and never in the URL', async () => {
    zoteroCalls.length = 0;
    zotero = () => zoteroResponse(COLLECTIONS, 1);
    const res = await post('collections', { userId: USER_ID, apiKey: KEY });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      collections: Array<{ key: string; name: string; numItems: number | null }>;
      cap: number;
    };
    expect(body.collections).toEqual([
      { key: 'BCDF2345', name: 'Chapter 2 reading', parentKey: null, numItems: 2 },
    ]);
    expect(body.cap).toBe(500);
    expect(zoteroCalls).toHaveLength(1);
    expect(zoteroCalls[0]?.url).toBe(
      `https://api.zotero.org/users/${USER_ID}/collections?format=json&limit=100&start=0`,
    );
    expect(zoteroCalls[0]?.url).not.toContain(KEY);
    expect(zoteroCalls[0]?.headers['Zotero-API-Key']).toBe(KEY);
    expect(zoteroCalls[0]?.headers['Zotero-API-Version']).toBe('3');
  });

  it('turns a 403 into a plain message', async () => {
    zotero = () => new Response('Forbidden', { status: 403 });
    const res = await post('collections', { userId: USER_ID, apiKey: KEY });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { type: string; detail: string };
    expect(body.type).toBe('ZOTERO_REFUSED');
    expect(body.detail).toMatch(/^Zotero refused that key/);
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it('turns a network failure into a plain message, even one that mentions the key', async () => {
    zotero = () => {
      throw new TypeError(`fetch failed: connect ECONNREFUSED (key ${KEY})`);
    };
    const res = await post('collections', { userId: USER_ID, apiKey: KEY });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { type: string; detail: string };
    expect(body.type).toBe('ZOTERO_UNAVAILABLE');
    expect(body.detail).toMatch(/^Could not reach Zotero/);
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it('answers 404 for a thesis that is not yours, before Zotero is called', async () => {
    const other = await h.prisma.user.create({ data: { email: 'zotero-other@example.com' } });
    const theirs = await h.prisma.document.create({
      data: { ownerId: other.id, title: 'Not yours', entryPath: 'A_TOPIC' },
    });
    zoteroCalls.length = 0;
    for (const path of ['collections', 'import']) {
      const res = await h.api(`/documents/${theirs.id}/sources/zotero/${path}`, {
        method: 'POST',
        body: JSON.stringify({ userId: USER_ID, apiKey: KEY }),
      });
      expect(res.status).toBe(404);
    }
    expect(zoteroCalls).toHaveLength(0);
  });
});

describe('importing', () => {
  it('refuses a library over the cap and adds nothing', async () => {
    zotero = () => zoteroResponse(ITEMS, 812);
    const res = await post('import', { userId: USER_ID, apiKey: KEY });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { type: string; detail: string; total: number };
    expect(body.type).toBe('ZOTERO_TOO_MANY');
    expect(body.total).toBe(812);
    expect(body.detail).toContain('812 items');
    expect(await h.prisma.source.count({ where: { documentId } })).toBe(0);
  });

  it('reads a collection into the resolve pipeline, leaves the note out, and skips a DOI already in the library', async () => {
    // Already in the library from a search, under a different reference line.
    await h.prisma.source.create({
      data: {
        documentId,
        status: 'RESOLVED',
        title: 'Moisture loss in tray dryers',
        doi: 'https://doi.org/10.1080/07373937.2018.1000001',
        rawReference: 'Iyer (2018) Moisture loss',
      },
    });
    zoteroCalls.length = 0;
    zotero = () => zoteroResponse(ITEMS, ITEMS.length);
    const res = await post('import', { userId: USER_ID, apiKey: KEY, collectionKey: 'BCDF2345' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entries: 3,
      skipped: 0,
      notReferences: 1,
      queued: 2,
      alreadyPresent: 1,
    });
    expect(zoteroCalls[0]?.url).toBe(
      `https://api.zotero.org/users/${USER_ID}/collections/BCDF2345/items/top?format=json&include=data,csljson&itemType=-attachment&limit=100&start=0`,
    );

    const rows = await h.prisma.source.findMany({
      where: { documentId, status: 'PENDING' },
      select: { rawReference: true, doi: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toEqual([
      {
        rawReference:
          'Kumar, A., Raman, S. (2021). Solar drying of marine fish in coastal Tamil Nadu. Renewable Energy. https://doi.org/10.1016/j.renene.2021.01.001',
        doi: '10.1016/j.renene.2021.01.001',
      },
      {
        rawReference:
          'Food and Agriculture Organization (2019). Post-harvest losses in small fisheries. The State of World Fisheries.',
        doi: null,
      },
    ]);
    // The .bib import's job ids: keyed on the reference line the job reads.
    for (const row of rows) {
      const raw = row.rawReference ?? '';
      const job = await queue.getJob(jobId('resolve-reference', documentId, jobKeyDigest(raw)));
      expect(job?.data).toMatchObject({ documentId, rawReference: raw });
      expect(JSON.stringify(job?.data)).not.toContain(KEY);
    }
  });

  it('a second import of the same items adds nothing', async () => {
    zotero = () => zoteroResponse(ITEMS, ITEMS.length);
    const res = await post('import', { userId: USER_ID, apiKey: KEY });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ queued: 0, alreadyPresent: 3 });
  });
});

describe('the key is not kept', () => {
  it('appears in no table, no Redis value and no log line', async () => {
    const tables = await h.prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
    expect(tables.length).toBeGreaterThan(10);
    for (const { table_name } of tables) {
      const rows = await h.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM "${table_name.replace(/"/g, '""')}" t WHERE t::text LIKE $1`,
        `%${KEY}%`,
      );
      expect({ table: table_name, n: Number(rows[0]?.n ?? 0) }).toEqual({
        table: table_name,
        n: 0,
      });
    }

    const keys = await redis.keys('*');
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const type = await redis.type(key);
      const value =
        type === 'string'
          ? await redis.get(key)
          : type === 'hash'
            ? JSON.stringify(await redis.hgetall(key))
            : type === 'list'
              ? JSON.stringify(await redis.lrange(key, 0, -1))
              : type === 'set'
                ? JSON.stringify(await redis.smembers(key))
                : type === 'zset'
                  ? JSON.stringify(await redis.zrange(key, 0, -1))
                  : type === 'stream'
                    ? JSON.stringify(await redis.xrange(key, '-', '+'))
                    : '';
      expect(value ?? '', `redis ${key}`).not.toContain(KEY);
    }

    // Something was logged (the harness's code, the 502), so the spies were live.
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.filter((line) => line.includes(KEY))).toEqual([]);
  });
});
