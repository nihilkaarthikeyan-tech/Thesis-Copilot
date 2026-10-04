/**
 * ADR-0058 through the real HTTP path: a visible tab's poll of a running job stamps the
 * `job-watch:<runId>` heartbeat the worker reads; a hidden tab's poll, a finished run and someone
 * else's run do not. And the "Email me when a long job finishes" setting, on unless turned off.
 */

import { randomUUID } from 'node:crypto';
import { jobWatchKey } from '@tc/types';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let redis: Redis;
let documentId: string;

beforeAll(async () => {
  h = await startHarness('job-watch@example.com');
  redis = new Redis(process.env.REDIS_URL as string, { maxRetriesPerRequest: null });
  const document = await h.prisma.document.create({
    data: { ownerId: h.userId, title: 'Solar drying', entryPath: 'A_TOPIC' },
  });
  documentId = document.id;
}, 240_000);

afterAll(async () => {
  redis?.disconnect();
  await h?.stop();
});

async function searchRun(status: 'RUNNING' | 'DONE', owner = documentId): Promise<string> {
  const runId = randomUUID();
  await h.prisma.document.update({
    where: { id: owner },
    data: {
      meta: {
        searchRuns: {
          [runId]: {
            runId,
            mode: 'discover',
            status,
            startedAt: new Date().toISOString(),
            counts: {},
          },
        },
      },
    },
  });
  return runId;
}

describe('the heartbeat', () => {
  it('is written by a visible poll of a running search', async () => {
    const runId = await searchRun('RUNNING');
    const before = Date.now();
    const res = await h.api(`/documents/${documentId}/search/${runId}?watching=1`);
    expect(res.status).toBe(200);
    const stamp = Number(await redis.get(jobWatchKey(runId)));
    expect(stamp).toBeGreaterThanOrEqual(before);
    expect(await redis.ttl(jobWatchKey(runId))).toBeGreaterThan(0);
  });

  it('is not written by a hidden tab’s poll', async () => {
    const runId = await searchRun('RUNNING');
    expect((await h.api(`/documents/${documentId}/search/${runId}`)).status).toBe(200);
    expect(await redis.get(jobWatchKey(runId))).toBeNull();
  });

  it('is not written for a finished run', async () => {
    const runId = await searchRun('DONE');
    expect((await h.api(`/documents/${documentId}/search/${runId}?watching=1`)).status).toBe(200);
    expect(await redis.get(jobWatchKey(runId))).toBeNull();
  });

  it('is not written for someone else’s run', async () => {
    const other = await h.prisma.user.create({
      data: { email: `other-${randomUUID()}@example.com`, name: 'Other' },
    });
    const theirs = await h.prisma.document.create({
      data: { ownerId: other.id, title: 'Theirs', entryPath: 'A_TOPIC' },
    });
    const runId = await searchRun('RUNNING', theirs.id);
    expect((await h.api(`/documents/${theirs.id}/search/${runId}?watching=1`)).status).toBe(404);
    expect(await redis.get(jobWatchKey(runId))).toBeNull();
  });
});

describe('the setting', () => {
  it('is on by default and can be turned off', async () => {
    const initial = (await (await h.api('/settings')).json()) as { emailWhenJobDone: boolean };
    expect(initial.emailWhenJobDone).toBe(true);
    const put = await h.api('/settings', {
      method: 'PUT',
      body: JSON.stringify({ emailWhenJobDone: false }),
    });
    expect(put.status).toBe(200);
    const after = (await (await h.api('/settings')).json()) as { emailWhenJobDone: boolean };
    expect(after.emailWhenJobDone).toBe(false);
    const row = await h.prisma.user.findUnique({
      where: { id: h.userId },
      select: { settings: true },
    });
    expect((row?.settings as { emailWhenJobDone?: boolean } | null)?.emailWhenJobDone).toBe(false);
  });

  it('refuses a value that is not a boolean', async () => {
    const put = await h.api('/settings', {
      method: 'PUT',
      body: JSON.stringify({ emailWhenJobDone: 'yes' }),
    });
    expect(put.status).toBe(400);
  });
});
