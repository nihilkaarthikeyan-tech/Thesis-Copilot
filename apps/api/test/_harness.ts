/**
 * Shared integration harness: the real Nest application on Postgres, Redis and MinIO in
 * Testcontainers, plus a signed-in session.
 *
 * Extracted from `week1.spec.ts` so later weeks reuse it rather than copying ninety lines of
 * container setup — a copy would drift, and a drifted harness makes two suites disagree about what
 * the application is.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@tc/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { GenericContainer, Wait } from 'testcontainers';
import { expect, vi } from 'vitest';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../packages/db/prisma/migrations/', import.meta.url),
);

export type Harness = {
  /** The running Nest application, for reaching a provider the HTTP surface does not expose. */
  app: NestFastifyApplication;
  baseUrl: string;
  prisma: PrismaClient;
  cookie: string;
  userId: string;
  /** Calls the API under `/api/v1`, carrying the session cookie unless one is passed. */
  api: (path: string, init?: RequestInit) => Promise<Response>;
  stop: () => Promise<void>;
};

async function applyMigrations(container: StartedPostgreSqlContainer): Promise<void> {
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const dir of dirs) {
    await container.copyFilesToContainer([
      { source: join(MIGRATIONS_DIR, dir, 'migration.sql'), target: `/tmp/m/${dir}.sql` },
    ]);
    const result = await container.exec([
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
    if (result.exitCode !== 0) throw new Error(`migration ${dir} failed:\n${result.output}`);
  }
}

/**
 * Boots everything and signs `email` in through the real OTP flow. The dev sender prints the code,
 * which is the only way to get one without a mail provider.
 */
export async function startHarness(email: string): Promise<Harness> {
  const [pg, redis, minio] = await Promise.all([
    new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('tc_test')
      .withUsername('tc')
      .withPassword('tc')
      .start(),
    new RedisContainer('redis:7-alpine').start(),
    // ADR-0024: MinIO's own images are gone — `docker.io/minio/minio` 404s (2025) and
    // `quay.io/minio/minio` refuses anonymous pulls (2026-09-24), which failed every suite here
    // at container start. Chainguard's build, whose entrypoint is `minio` itself.
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
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(buildFastify()),
    // `rawBody` matches `main.ts`: FR-9.5's webhook verifies an HMAC over the exact bytes, and a
    // harness that omitted it made every correctly signed request fail with a 401 — the harness
    // and the application disagreeing about what the application is.
    { logger: false, rawBody: true },
  );
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.setGlobalPrefix('api/v1', { exclude: ['metrics'] });
  await registerPlugins(app, loadEnv());
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.API_URL = baseUrl;

  const prisma = new PrismaClient({ datasources: { db: { url: pg.getConnectionUri() } } });

  let cookie = '';
  const api = (path: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`${baseUrl}/api/v1${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(init.headers ?? {}),
      },
    });

  const spy = vi.spyOn(console, 'log');
  const sent = await api('/auth/email-otp/send-verification-otp', {
    method: 'POST',
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
  expect(sent.status).toBe(200);
  const line = spy.mock.calls
    .map((call) => call.join(' '))
    .find((text) => text.includes(`one-time code for ${email}`));
  spy.mockRestore();
  const otp = /:\s*(\d{6})/.exec(line ?? '')?.[1];
  expect(otp, 'the dev sender should print the one-time code').toBeTruthy();

  const signedIn = await api('/auth/sign-in/email-otp', {
    method: 'POST',
    body: JSON.stringify({ email, otp }),
  });
  expect(signedIn.status).toBe(200);
  cookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  expect(cookie).toContain('better-auth.session_token');
  const userId = ((await signedIn.json()) as { user: { id: string } }).user.id;

  return {
    app,
    baseUrl,
    prisma,
    get cookie() {
      return cookie;
    },
    userId,
    api,
    stop: async () => {
      await prisma.$disconnect();
      await app.close();
      await Promise.all([pg.stop(), redis.stop(), minio.stop()]);
    },
  };
}

/** A one-page PDF carrying the given lines, for upload paths that need a real file. */
export function buildPdf(lines: readonly string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const parts = ['BT'];
  lines.forEach((text, i) => {
    parts.push('/F1 11 Tf', `1 0 0 1 72 ${700 - i * 18} Tm`, `(${esc(text)}) Tj`);
  });
  parts.push('ET');
  const stream = parts.join('\n');

  const objects = [
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Page /Parent 4 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 1 0 R >> >> /Contents 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Catalog /Pages 4 0 R >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
