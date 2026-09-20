/**
 * `GET /api/v1/health` — PHASES.md task 0.6 DoD: "returns DB/Redis/MinIO/provider status".
 * PRD §14 points Uptime Kuma at this endpoint.
 *
 * Every dependency is probed on each call, but they do not all carry the same weight — ADR-0014.
 *
 * Three things read this endpoint and act on it very differently: Docker's `healthcheck` marks the
 * container unhealthy after three failures, `deploy.sh` **rolls back the release**, and Uptime Kuma
 * alerts a human on the body's `"status":"ok"` keyword. So the two signals in one response are
 * split by what can actually be done about each failure:
 *
 * - **HTTP status** carries only what replacing this container might fix: Postgres, Redis, MinIO.
 * - **`status` in the body** goes `degraded` when a provider is unreachable. Kuma pages someone;
 *   Docker and the deploy leave a working release alone, because restarting our container has
 *   never once fixed OpenAI.
 */

import { Controller, Get, Inject, Res } from '@nestjs/common';
import { providerForModel, type Vendor } from '@tc/ai';
import type { Env } from '@tc/config';
import type { FastifyReply } from 'fastify';
import { Client as MinioClient } from 'minio';
import { ENV } from '../../common/env.token.js';
import { PrismaService } from '../../common/prisma.service.js';
import { RedisService } from '../../common/redis.service.js';

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

    // Core: this process cannot serve without them, and replacing the container might help.
    checks.database = await timed(() => this.prisma.$queryRaw`SELECT 1`);
    checks.redis = await timed(() => this.redis.client.ping());
    checks.objectStorage = await timed(() => this.minio.bucketExists(this.env.S3_BUCKET));
    const coreHealthy = Object.values(checks).every((c) => c.status === 'up');

    // Reported, never fatal (ADR-0014). A vendor outage is somebody's problem, not this
    // container's, and killing this container is not one of the ways it gets fixed.
    checks.llmProvider = await timed(() => this.probeLlmProvider());
    checks.embeddings = await timed(() => this.probeEmbeddings());

    const allHealthy = Object.values(checks).every((c) => c.status === 'up');
    reply.status(coreHealthy ? 200 : 503);

    return {
      status: allHealthy ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      checks,
    };
  }

  /**
   * The vendors the configured models actually route to.
   *
   * Derived from the model ids by the same function the router uses, rather than named here, so
   * this check cannot drift away from the configuration. It had: the probe pointed at Anthropic
   * for months after ADR-0011 moved both tiers to OpenAI, which meant an OpenAI outage read as
   * healthy and an Anthropic blip read as broken.
   */
  private vendors(): Vendor[] {
    const both = [
      providerForModel(this.env.AI_FAST_MODEL),
      providerForModel(this.env.AI_STRONG_MODEL),
    ];
    return [...new Set(both)];
  }

  /**
   * Reachability only — a TCP/TLS handshake against the provider host, never a completion.
   * A health check must not cost money or count against a cap (PRD §11).
   */
  private async probeLlmProvider(): Promise<void> {
    if (this.env.AI_PROVIDER === 'mock') return;

    // Both tiers are checked when they run on different vendors; one failing fails the check.
    await Promise.all(this.vendors().map((vendor) => reachable(VENDOR_PROBE[vendor])));
  }

  /**
   * Embeddings are as load-bearing as the LLM — without them nothing indexes, retrieves or
   * answers a library question — and nothing was watching them until ADR-0014.
   */
  private async probeEmbeddings(): Promise<void> {
    if (this.env.EMBED_PROVIDER === 'mock') return;
    await reachable('https://api.voyageai.com/v1/embeddings');
  }
}

/** Where to knock for each vendor. Any HTTP answer proves the host is up; only the network fails. */
const VENDOR_PROBE: Record<Vendor, string> = {
  anthropic: 'https://api.anthropic.com/v1/models',
  openai: 'https://api.openai.com/v1/models',
};

/**
 * A request with no credentials, whose *response code is irrelevant*. 401 and 405 both prove the
 * host is reachable and serving; only a network-level failure or a timeout throws.
 */
async function reachable(url: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    await fetch(url, { method: 'GET', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
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
