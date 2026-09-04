/**
 * `GET /api/v1/health` — PHASES.md task 0.6 DoD: "returns DB/Redis/MinIO/provider status".
 * PRD §14 points Uptime Kuma at this endpoint.
 *
 * Every dependency is probed on each call. The endpoint answers 200 only when all of them are up;
 * otherwise 503 with the failing check named, so a monitor says which dependency broke.
 */

import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Env } from '@tc/config';
import type { FastifyReply } from 'fastify';
import { Client as MinioClient } from 'minio';
import { ENV } from '../../common/env.token.js';
import type { PrismaService } from '../../common/prisma.service.js';
import type { RedisService } from '../../common/redis.service.js';

type CheckState = 'up' | 'down';

type HealthReport = {
  status: 'ok' | 'degraded';
  uptimeSeconds: number;
  checks: Record<string, { status: CheckState; latencyMs: number; error?: string }>;
};

@Controller('health')
export class HealthController {
  private readonly minio: MinioClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {
    const endpoint = new URL(env.S3_ENDPOINT);
    this.minio = new MinioClient({
      endPoint: endpoint.hostname,
      port: Number(endpoint.port) || (endpoint.protocol === 'https:' ? 443 : 80),
      useSSL: endpoint.protocol === 'https:',
      accessKey: env.S3_ACCESS_KEY,
      secretKey: env.S3_SECRET_KEY,
      region: env.S3_REGION,
    });
  }

  @Get()
  async check(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthReport> {
    const checks: HealthReport['checks'] = {};

    checks.database = await timed(() => this.prisma.$queryRaw`SELECT 1`);
    checks.redis = await timed(() => this.redis.client.ping());
    checks.objectStorage = await timed(() => this.minio.bucketExists(this.env.S3_BUCKET));
    checks.aiProvider = await timed(() => this.probeProvider());

    const healthy = Object.values(checks).every((c) => c.status === 'up');
    reply.status(healthy ? 200 : 503);

    return {
      status: healthy ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      checks,
    };
  }

  /**
   * Reachability only — a TCP/TLS handshake against the provider host, never a completion.
   * A health check must not cost money or count against a cap (PRD §11).
   */
  private async probeProvider(): Promise<void> {
    if (this.env.AI_PROVIDER === 'mock') return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    try {
      // 401 is a fine answer: it proves the host is reachable and serving.
      await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        signal: controller.signal,
        headers: { 'anthropic-version': '2023-06-01' },
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function timed(
  probe: () => Promise<unknown>,
): Promise<{ status: CheckState; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await probe();
    return { status: 'up', latencyMs: Date.now() - started };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
