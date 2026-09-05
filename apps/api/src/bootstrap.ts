/**
 * Fastify wiring shared by `main.ts` and the integration tests, so tests exercise the same stack
 * the server runs.
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Env } from '@tc/config';
import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyServerOptions,
  FastifyTypeProviderDefault,
  RawServerDefault,
} from 'fastify';
import { Redis } from 'ioredis';
import { AUTH_RATE_LIMIT, checkRateLimit } from './common/rate-limit.js';

/**
 * The fully instantiated Fastify instance. The cookie plugin augments exactly this instantiation
 * (with `FastifyTypeProviderDefault`), so a bare `FastifyInstance` would silently drop its helpers.
 */
type ApiFastify = FastifyInstance<
  RawServerDefault,
  IncomingMessage,
  ServerResponse<IncomingMessage>,
  FastifyBaseLogger,
  FastifyTypeProviderDefault
>;

export function buildFastify(): FastifyServerOptions {
  return {
    // PRD §14: a request id on every request, propagated to jobs. Honour an inbound header so a
    // trace survives the proxy hop.
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    requestIdHeader: 'x-request-id',
    trustProxy: true,
    // Uploads are checked per plan in the sources module (PRD §11.3); this is the outer ceiling.
    bodyLimit: 100 * 1024 * 1024,
    // Fastify's own request logging is off: nestjs-pino does it, with redaction (PRD §12.1).
    disableRequestLogging: true,
  };
}

/** Sign-in is the endpoint worth brute-forcing, so it gets the strict limit. */
const AUTH_PATH = '/api/v1/auth/';

/**
 * PRD §12.1: rate limiting per IP and per user on auth and AI endpoints, HSTS, and the security
 * headers that cost nothing.
 *
 * AI endpoints do not exist yet in Phase 0; they get the same treatment when they land in week 3,
 * on top of the per-month caps in `UsageService` — rate limiting shapes bursts, caps bound cost.
 */
export async function registerPlugins(app: NestFastifyApplication, env: Env): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance() as unknown as ApiFastify;

  await fastify.register(cookie);

  // Uploads (PRD FR-1.1, FR-2.3). The outer ceiling matches `bodyLimit`; the per-plan limit from
  // §11.3 is enforced in `upload-rules.ts`, which needs the bytes to check the magic number anyway.
  await fastify.register(multipart, {
    limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  });

  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  redis.on('error', () => {
    // Swallowed on purpose: checkRateLimit fails open, and /health reports Redis separately.
  });

  fastify.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith(AUTH_PATH)) return;

    // Per user when signed in, per IP otherwise (PRD §12.1).
    const identity = (request as { user?: { id?: string } }).user?.id ?? request.ip;
    const verdict = await checkRateLimit(redis, 'auth', identity, AUTH_RATE_LIMIT);
    if (verdict.allowed) return;

    reply
      .status(429)
      .header('retry-after', String(verdict.retryAfter))
      .type('application/problem+json')
      .send({
        type: 'RATE_LIMITED',
        title: 'Too many requests',
        status: 429,
        detail: `Too many sign-in attempts. Try again in ${verdict.retryAfter} seconds.`,
        instance: request.url,
        requestId: request.id,
      });
  });

  fastify.addHook('onSend', async (request, reply, payload) => {
    if (env.NODE_ENV === 'production') {
      reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    }
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-request-id', request.id);
    return payload;
  });
}
