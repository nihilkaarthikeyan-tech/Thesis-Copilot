/**
 * `GET /api/v1/health` — ADR-0014.
 *
 * The thing worth pinning is not that the endpoint answers. It is *which failures change the HTTP
 * status*, because three things act on that number and two of them act destructively: Docker
 * replaces the container after three failures, and `deploy.sh` rolls the release back. A vendor
 * outage moving that number means somebody else's bad afternoon restarts our containers and undoes
 * a good release, and neither of those has ever fixed somebody else's API.
 *
 * Before ADR-0014 it did exactly that. It also probed Anthropic for months after ADR-0011 moved
 * both tiers to OpenAI, so a real OpenAI outage read as perfectly healthy — a test that only
 * checked the status code would have passed throughout.
 *
 * Driven directly rather than through `_harness.ts`, because the harness runs every provider on
 * the mock (rightly — no other test should make outbound calls), and the mock short-circuits the
 * exact probes under test here.
 */

import type { Env } from '@tc/config';
import { Client as MinioClient } from 'minio';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthController } from '../src/modules/health/health.controller.js';

type CheckState = { status: 'up' | 'down'; error?: string };
type Report = { status: 'ok' | 'degraded'; checks: Record<string, CheckState> };

const realFetch = globalThis.fetch;

/** Just enough Env for the controller; the rest is never read on this path. */
const env = (over: Partial<Env> = {}): Env =>
  ({
    S3_ENDPOINT: 'http://minio:9000',
    S3_ACCESS_KEY: 'key',
    S3_SECRET_KEY: 'secret',
    S3_BUCKET: 'bucket',
    S3_REGION: 'us-east-1',
    AI_PROVIDER: 'anthropic', // the env flag means "not the mock"; the vendor comes from the ids
    AI_FAST_MODEL: 'gpt-5-nano',
    AI_STRONG_MODEL: 'gpt-5-mini',
    EMBED_PROVIDER: 'voyage',
    ...over,
  }) as Env;

/** Records the status the controller set, the way Fastify's reply would receive it. */
function makeReply() {
  const state = { code: 0 };
  return {
    reply: { status: (code: number) => ((state.code = code), undefined) } as never,
    state,
  };
}

function makeController(over: Partial<Env> = {}, dbFails = false) {
  const prisma = {
    $queryRaw: dbFails
      ? vi.fn().mockRejectedValue(new Error('simulated database outage'))
      : vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  };
  const redis = { client: { ping: vi.fn().mockResolvedValue('PONG') } };
  return new HealthController(prisma as never, redis as never, env(over));
}

/** Every outbound call answers, except ones whose URL contains a host in `broken`. */
function stubFetch(broken: string[] = []): string[] {
  const seen: string[] = [];
  globalThis.fetch = (async (input: Parameters<typeof globalThis.fetch>[0]) => {
    const url = typeof input === 'string' ? input : input.toString();
    seen.push(url);
    if (broken.some((host) => url.includes(host))) throw new Error(`simulated outage: ${url}`);
    // 401 is what these endpoints really answer without credentials, and it proves reachability.
    return new Response('{}', { status: 401 });
  }) as typeof globalThis.fetch;
  return seen;
}

beforeEach(() => {
  vi.spyOn(MinioClient.prototype, 'bucketExists').mockResolvedValue(true);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('when everything is up', () => {
  it('answers 200 and reports every dependency', async () => {
    stubFetch();
    const { reply, state } = makeReply();

    const body = (await makeController().check(reply)) as Report;

    expect(state.code).toBe(200);
    expect(body.status).toBe('ok');
    // PHASES 0.6 DoD: DB / Redis / MinIO / provider. Embeddings added by ADR-0014.
    expect(Object.keys(body.checks).sort()).toEqual([
      'database',
      'embeddings',
      'llmProvider',
      'objectStorage',
      'redis',
    ]);
  });
});

describe('which vendor it probes', () => {
  it('follows the configured model ids rather than a hardcoded host', async () => {
    // The original defect. Both this and the old code answered 200, so only asserting on the URL
    // actually requested catches it.
    const seen = stubFetch();
    const { reply } = makeReply();

    await makeController().check(reply);

    expect(seen.some((u) => u.includes('api.openai.com'))).toBe(true);
    expect(seen.some((u) => u.includes('api.anthropic.com'))).toBe(false);
  });

  it('follows the ids back to Anthropic if a Claude model is configured', async () => {
    const seen = stubFetch();
    const { reply } = makeReply();

    await makeController({
      AI_FAST_MODEL: 'claude-haiku-4-5-20251001',
      AI_STRONG_MODEL: 'claude-sonnet-5',
    }).check(reply);

    expect(seen.some((u) => u.includes('api.anthropic.com'))).toBe(true);
    expect(seen.some((u) => u.includes('api.openai.com'))).toBe(false);
  });

  it('checks both vendors when the tiers are split across them', async () => {
    const seen = stubFetch();
    const { reply } = makeReply();

    await makeController({
      AI_FAST_MODEL: 'gpt-5-nano',
      AI_STRONG_MODEL: 'claude-sonnet-5',
    }).check(reply);

    expect(seen.some((u) => u.includes('api.openai.com'))).toBe(true);
    expect(seen.some((u) => u.includes('api.anthropic.com'))).toBe(true);
  });

  it('calls nothing at all on the mock', async () => {
    const seen = stubFetch();
    const { reply, state } = makeReply();

    const body = (await makeController({ AI_PROVIDER: 'mock', EMBED_PROVIDER: 'mock' }).check(
      reply,
    )) as Report;

    expect(seen).toEqual([]);
    expect(state.code).toBe(200);
    expect(body.status).toBe('ok');
  });
});

describe('when an AI vendor is unreachable', () => {
  it('stays 200 — this must not restart the container or roll back a release', async () => {
    stubFetch(['api.openai.com']);
    const { reply, state } = makeReply();

    const body = (await makeController().check(reply)) as Report;

    expect(state.code).toBe(200);
    expect(body.checks.llmProvider?.status).toBe('down');
  });

  it('still says degraded in the body, which is what pages a human', async () => {
    // §14's Uptime Kuma monitor matches the keyword `"status":"ok"`. Losing it is the alert.
    stubFetch(['api.openai.com']);
    const { reply } = makeReply();

    const body = (await makeController().check(reply)) as Report;

    expect(body.status).toBe('degraded');
  });

  it('names embeddings separately, since they fail independently', async () => {
    stubFetch(['api.voyageai.com']);
    const { reply, state } = makeReply();

    const body = (await makeController().check(reply)) as Report;

    expect(state.code).toBe(200);
    expect(body.status).toBe('degraded');
    expect(body.checks.embeddings?.status).toBe('down');
    expect(body.checks.llmProvider?.status).toBe('up');
  });
});

describe('when core infrastructure is down', () => {
  it('answers 503, because replacing this container might actually help', async () => {
    stubFetch();
    const { reply, state } = makeReply();

    const body = (await makeController({}, true).check(reply)) as Report;

    expect(state.code).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.checks.database?.status).toBe('down');
  });

  it('503s on storage too, and says which one broke', async () => {
    stubFetch();
    vi.spyOn(MinioClient.prototype, 'bucketExists').mockRejectedValue(new Error('minio is gone'));
    const { reply, state } = makeReply();

    const body = (await makeController().check(reply)) as Report;

    expect(state.code).toBe(503);
    expect(body.checks.objectStorage?.status).toBe('down');
    expect(body.checks.objectStorage?.error).toContain('minio is gone');
  });
});
