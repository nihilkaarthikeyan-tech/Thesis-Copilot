/**
 * Phase 1 week 1 — API side. PHASES tasks 1.4 and 1.7 (server half), B.9 test 8.
 *
 * Boots the real Nest application against Postgres, Redis and MinIO in Testcontainers, signs in
 * through Better Auth's email-OTP flow, and drives the HTTP surface the editor uses:
 *
 *   1.4  /assist/suggest streams a 3-sentence mock at 250 ms simulated latency; `start` arrives
 *        before the first token; `done` carries usage; disconnecting the client aborts the provider stream
 *        (asserted on the mock's recorded request signal); a second request while one is open is
 *        refused with 409; the ASSIST counter increments; cap exhaustion answers 429.
 *   1.7  PUT /chapters/:id with a stale baseVersion answers 409 (B.9 test 8).
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { MockLlmProvider } from '@tc/ai';
import { PLAN_LIMITS } from '@tc/config';
import { PrismaClient } from '@tc/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let pg: StartedPostgreSqlContainer;
let redis: StartedRedisContainer;
let minio: StartedTestContainer;
let app: NestFastifyApplication;
let baseUrl: string;
let prisma: PrismaClient;
let cookie = '';
let chapterId = '';
let documentId = '';
let userId = '';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../packages/db/prisma/migrations/', import.meta.url),
);

async function applyMigrations(container: StartedPostgreSqlContainer): Promise<void> {
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const dir of dirs) {
    await container.copyFilesToContainer([
      { source: join(MIGRATIONS_DIR, dir, 'migration.sql'), target: `/tmp/m/${dir}.sql` },
    ]);
    const r = await container.exec([
      'psql',
      '-U',
      'tc',
      '-d',
      'tc_test',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      `/tmp/m/${dir}.sql`,
    ]);
    if (r.exitCode !== 0) throw new Error(`migration ${dir} failed:\n${r.output}`);
  }
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
}

/** Parses an SSE body into events, invoking `onEvent` as they arrive. */
async function readSse(
  response: Response,
  onEvent: (event: string, data: Record<string, unknown>, at: number) => 'stop' | undefined,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('no body');
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf('\n\n');
    while (idx !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = /^event: (.+)$/m.exec(chunk)?.[1] ?? 'message';
      const data = /^data: (.+)$/m.exec(chunk)?.[1] ?? '{}';
      if (onEvent(event, JSON.parse(data) as Record<string, unknown>, Date.now()) === 'stop') {
        await reader.cancel();
        return;
      }
      idx = buffer.indexOf('\n\n');
    }
  }
}

beforeAll(async () => {
  [pg, redis, minio] = await Promise.all([
    new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('tc_test')
      .withUsername('tc')
      .withPassword('tc')
      .start(),
    new RedisContainer('redis:7-alpine').start(),
    // ADR-0024: MinIO's own images are gone — `docker.io/minio/minio` 404s (2025) and
    // `quay.io/minio/minio` refuses anonymous pulls (2026-09-24). This file starts its own
    // containers rather than using the harness, and was missed when the harness moved.
    new GenericContainer('cgr.dev/chainguard/minio:latest')
      .withCommand(['server', '/data'])
      .withEnvironment({ MINIO_ROOT_USER: 'tcadmin', MINIO_ROOT_PASSWORD: 'tc-secret-key' })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
      .start(),
  ]);
  await applyMigrations(pg);

  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3000',
    API_URL: 'http://localhost:3001',
    DATABASE_URL: pg.getConnectionUri(),
    REDIS_URL: redis.getConnectionUrl(),
    S3_ENDPOINT: `http://${minio.getHost()}:${minio.getMappedPort(9000)}`,
    S3_ACCESS_KEY: 'tcadmin',
    S3_SECRET_KEY: 'tc-secret-key',
    S3_BUCKET: 'tc-test',
    AUTH_SECRET: 'test-only-secret-0123456789abcdef0123456789',
    AI_PROVIDER: 'mock',
    AI_MOCK_LATENCY_MS: '250',
    AI_FAST_MODEL: 'mock-fast',
    AI_STRONG_MODEL: 'mock-strong',
    EMBED_PROVIDER: 'mock',
    AI_EMBED_MODEL: 'mock-embed',
    EMBED_DIMS: '1024',
    OPENALEX_MAILTO: 'test@example.com',
    CROSSREF_MAILTO: 'test@example.com',
    UNPAYWALL_EMAIL: 'test@example.com',
    GOTENBERG_URL: 'http://localhost:3002',
    SEED_ADMIN_EMAIL: 'admin@example.com',
  });

  // Imported after env is set: config validation runs at module construction.
  const { AppModule } = await import('../src/app.module.js');
  const { buildFastify, registerPlugins } = await import('../src/bootstrap.js');
  const { ProblemDetailsFilter } = await import('../src/common/problem-details.filter.js');
  const { loadEnv } = await import('@tc/config');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(buildFastify()),
    {
      logger: false,
    },
  );
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.setGlobalPrefix('api/v1', { exclude: ['metrics'] });
  await registerPlugins(app, loadEnv());
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.API_URL = baseUrl;

  prisma = new PrismaClient({ datasources: { db: { url: pg.getConnectionUri() } } });

  // Sign in through the real OTP flow; the code is printed by the dev sender.
  const email = 'w1@example.com';
  const spy = vi.spyOn(console, 'log');
  const sent = await api('/auth/email-otp/send-verification-otp', {
    method: 'POST',
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
  expect(sent.status).toBe(200);
  const line = spy.mock.calls
    .map((c) => c.join(' '))
    .find((l) => l.includes(`one-time code for ${email}`));
  spy.mockRestore();
  const otp = /:\s*(\d{6})/.exec(line ?? '')?.[1];
  expect(otp).toBeTruthy();
  const signedIn = await api('/auth/sign-in/email-otp', {
    method: 'POST',
    body: JSON.stringify({ email, otp }),
  });
  expect(signedIn.status).toBe(200);
  cookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  expect(cookie).toContain('better-auth.session_token');
  userId = ((await signedIn.json()) as { user: { id: string } }).user.id;

  const created = await api('/documents', {
    method: 'POST',
    body: JSON.stringify({ title: 'Week 1', entryPath: 'B_PAPER' }),
  });
  expect(created.status).toBe(201);
  const doc = (await created.json()) as { id: string; firstChapterId: string };
  documentId = doc.id;
  chapterId = doc.firstChapterId;
  expect(chapterId).toBeTruthy();
}, 240_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await app?.close();
  await Promise.all([pg?.stop(), redis?.stop(), minio?.stop()]);
});

describe('PHASES 1.7 / B.9 test 8 — autosave conflict', () => {
  it('a stale baseVersion is refused with 409 and the server version', async () => {
    const content = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'v2' }] }],
    };
    const first = await api(`/chapters/${chapterId}`, {
      method: 'PUT',
      body: JSON.stringify({ content, baseVersion: 1 }),
    });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { version: number }).version).toBe(2);

    const stale = await api(`/chapters/${chapterId}`, {
      method: 'PUT',
      body: JSON.stringify({ content, baseVersion: 1 }),
    });
    expect(stale.status).toBe(409);
    expect(stale.headers.get('content-type')).toContain('application/problem+json');
    const problem = (await stale.json()) as { type: string; serverVersion: number };
    expect(problem.type).toBe('CONFLICT');
    expect(problem.serverVersion).toBe(2);

    const next = await api(`/chapters/${chapterId}`, {
      method: 'PUT',
      body: JSON.stringify({ content, baseVersion: 2 }),
    });
    expect(next.status).toBe(200);
  });

  it('stores per-provenance word counts on save (B.4)', async () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'one two ',
              marks: [{ type: 'provenance', attrs: { kind: 'HUMAN', actionId: null } }],
            },
            {
              type: 'text',
              text: 'three four five',
              marks: [{ type: 'provenance', attrs: { kind: 'ASSIST', actionId: 'x' } }],
            },
          ],
        },
      ],
    };
    const res = await api(`/chapters/${chapterId}`, {
      method: 'PUT',
      body: JSON.stringify({ content, baseVersion: 3 }),
    });
    expect(res.status).toBe(200);
    const row = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(row.wordCounts).toMatchObject({ HUMAN: 2, ASSIST: 3 });
    expect(row.wordCount).toBe(5);
  });

  it('a chapter owned by someone else reads as 404, never 403 (§12.1)', async () => {
    const other = await prisma.user.create({ data: { email: 'other@example.com' } });
    const doc = await prisma.document.create({
      data: {
        ownerId: other.id,
        title: 'x',
        entryPath: 'A_TOPIC',
        chapters: {
          create: {
            outlineNodeId: 'c',
            title: 'c',
            order: 1,
            content: { type: 'doc', content: [] },
          },
        },
      },
      include: { chapters: true },
    });
    const res = await api(`/chapters/${doc.chapters[0]?.id}`);
    expect(res.status).toBe(404);
  });
});

describe('PHASES 1.4 — /assist/suggest over SSE', () => {
  const body = () =>
    JSON.stringify({
      chapterId,
      before: 'Prior studies found ',
      after: '',
      cursorContext: { blockType: 'paragraph' },
    });

  it('streams the 3-sentence mock: start before any token, tokens, then done with usage', async () => {
    const t0 = Date.now();
    const res = await api('/assist/suggest', { method: 'POST', body: body() });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('x-accel-buffering')).toBe('no');

    const events: Array<{ event: string; data: Record<string, unknown>; at: number }> = [];
    await readSse(res, (event, data, at) => {
      events.push({ event, data, at });
      return undefined;
    });

    const start = events.find((e) => e.event === 'start');
    expect(start).toBeDefined();

    const tokens = events.filter((e) => e.event === 'token');
    // What §6.2 actually requires is that the editor can show "thinking" before any text arrives,
    // so `start` must precede the first token — and the first token is gated behind the mock's own
    // 250 ms, which makes this ordering the real property rather than a stopwatch.
    //
    // It used to be `start` within 100 ms of the request, wall-clock. That measured the machine:
    // it passed alone and failed at 116 ms when the whole suite booted its containers at once.
    // The generous bound below still catches a `start` held back by buffering, which is the
    // failure this line exists for.
    expect(start?.at ?? 0).toBeLessThan(tokens[0]?.at ?? Number.POSITIVE_INFINITY);
    expect((start?.at ?? 0) - t0).toBeLessThan(1_000);
    expect(tokens.length).toBeGreaterThan(3);
    const text = tokens.map((t) => String(t.data.t)).join('');
    expect(text.split(/[.!?]\s/).length).toBeGreaterThanOrEqual(3);
    // This document has no indexed sources, so the prompt carries no passages and the mock —
    // like a real model under A.0 rule 3 — cites nothing. Nothing for §10.6 to strip.
    expect(text).not.toContain('{{cite:');

    const done = events.at(-1);
    expect(done?.event).toBe('done');
    expect(done?.data.usage).toMatchObject({ outputTokens: expect.any(Number) });
    expect(done?.data.citations).toEqual([]);
    // A.1 step 3: the three streamed sentences are cut to two on `done`, and that is what the
    // editor keeps.
    expect(String(done?.data.text).split(/[.!?]\s/).length).toBe(2);
    expect(String(done?.data.text)).not.toContain('The following section therefore');
    expect(done?.data.ttfbMs).toBeGreaterThanOrEqual(240);
    expect(done?.data.ttfbMs).toBeLessThan(600);

    const suggestion = await prisma.suggestionEvent.findUniqueOrThrow({
      where: { id: String(done?.data.suggestionId) },
    });
    expect(suggestion.outcome).toBe('SHOWN');
    expect(suggestion.shownChars).toBe(String(done?.data.text).length);
    expect(suggestion.ttfbMs).toBeGreaterThan(0);

    const ledger = await prisma.usageLedger.findFirst({ where: { userId, action: 'ASSIST' } });
    expect(ledger?.count).toBe(1);

    const call = await prisma.aiCallLog.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    expect(call?.model).toBe('mock-fast');
    expect(call?.costMicroInr).toBe(0n); // mock: cost 0, counter still increments (PHASES 1.4)
  });

  it('records the outcome the editor reports', async () => {
    const suggestion = await prisma.suggestionEvent.findFirstOrThrow({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    const res = await api('/assist/outcome', {
      method: 'POST',
      body: JSON.stringify({ suggestionId: suggestion.id, outcome: 'ACCEPTED', keptChars: 42 }),
    });
    expect(res.status).toBe(201);
    const updated = await prisma.suggestionEvent.findUniqueOrThrow({
      where: { id: suggestion.id },
    });
    expect(updated.outcome).toBe('ACCEPTED');
    expect(updated.keptChars).toBe(42);
  });

  it('disconnecting the client aborts the provider stream (assert on the mock)', async () => {
    const { AssistService } = await import('../src/modules/assist/assist.service.js');
    const assist = app.get(AssistService);
    const mock = assist.llm as MockLlmProvider;
    const before = mock.calls.length;

    const controller = new AbortController();
    const res = await api('/assist/suggest', {
      method: 'POST',
      body: body(),
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    await readSse(res, (event) => {
      if (event === 'token') {
        controller.abort();
        return 'stop';
      }
      return undefined;
    }).catch(() => undefined);

    // The server notices the closed socket and aborts the LlmRequest it handed the provider.
    await vi.waitFor(
      () => {
        const call = mock.calls[before];
        expect(call?.signal?.aborted).toBe(true);
      },
      { timeout: 3_000 },
    );

    await vi.waitFor(
      async () => {
        const last = await prisma.suggestionEvent.findFirstOrThrow({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        });
        expect(last.outcome).toBe('CANCELLED');
      },
      { timeout: 3_000 },
    );
  });

  it('a second request while one is open is refused with 409 (single in-flight per user)', async () => {
    const first = await api('/assist/suggest', { method: 'POST', body: body() });
    expect(first.status).toBe(200);
    // Do not read the first stream yet; it is open and holds the in-flight key.
    const second = await api('/assist/suggest', { method: 'POST', body: body() });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { type: string }).type).toBe('ASSIST_IN_FLIGHT');
    await readSse(first, () => undefined);
  });

  it('exhausting the ASSIST cap answers 429 CAP_EXCEEDED with resetsAt, and makes no provider call', async () => {
    const cap = PLAN_LIMITS.FREE_TRIAL.caps.ASSIST;
    await prisma.usageLedger.updateMany({
      where: { userId, action: 'ASSIST' },
      data: { count: cap },
    });
    const { AssistService } = await import('../src/modules/assist/assist.service.js');
    const mock = app.get(AssistService).llm as MockLlmProvider;
    const calls = mock.calls.length;

    const res = await api('/assist/suggest', { method: 'POST', body: body() });
    expect(res.status).toBe(429);
    const problem = (await res.json()) as { type: string; cap: number; resetsAt: string };
    expect(problem.type).toBe('CAP_EXCEEDED');
    expect(problem.cap).toBe(cap);
    expect(new Date(problem.resetsAt).getUTCDate()).toBe(1);
    expect(mock.calls.length).toBe(calls);

    await prisma.usageLedger.updateMany({
      where: { userId, action: 'ASSIST' },
      data: { count: 0 },
    });
  });

  it('a chapter the user does not own answers 404 before any stream opens', async () => {
    const res = await api('/assist/suggest', {
      method: 'POST',
      body: JSON.stringify({
        chapterId: '01a06d00-0000-7000-8000-000000000000',
        before: '',
        after: '',
      }),
    });
    expect(res.status).toBe(404);
  });
});

describe('snapshots and versions (B.7)', () => {
  it('a manual snapshot lands in object storage and the version list', async () => {
    const res = await api(`/chapters/${chapterId}/snapshot`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'MANUAL' }),
    });
    expect(res.status).toBe(201);
    const list = await api(`/documents/${documentId}/versions`);
    const versions = (await list.json()) as Array<{ reason: string }>;
    expect(versions.some((v) => v.reason === 'MANUAL')).toBe(true);
    expect(versions.some((v) => v.reason === 'AUTOSAVE')).toBe(true);
  });
});
