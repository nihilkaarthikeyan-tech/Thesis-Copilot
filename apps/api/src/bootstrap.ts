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
  FastifyReply,
  FastifyRequest,
  FastifyServerOptions,
  FastifyTypeProviderDefault,
  RawServerDefault,
} from 'fastify';
import { Redis } from 'ioredis';
import {
  AI_RATE_LIMIT,
  authRateLimit,
  checkRateLimit,
  classifyRequest,
  GENERAL_RATE_LIMIT,
  HEAVY_RATE_LIMITS,
  type RateLimitVerdict,
  rateIdentity,
} from './common/rate-limit.js';

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
 * Only the routes that reach a provider. `/assist/outcome` is telemetry written after the fact;
 * counting it would let a student's own dismissals rate-limit their next suggestion.
 */
const AI_PATHS = [
  '/api/v1/assist/suggest',
  '/api/v1/citations/suggest',
  '/api/v1/draft/',
  '/api/v1/chat',
  // ADR-0132: a research question asked with no thesis. Its list and reads are not counted.
  '/api/v1/research-chats/ask',
  // ADR-0026: a burst of proofreading runs is shaped like any other AI call; the cap bounds cost.
  '/api/v1/proofread',
  // ADR-0030: a question set or an answer's feedback. The page's own read is under /documents.
  '/api/v1/viva/',
];

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

  const authRule = authRateLimit(env);
  fastify.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith(AUTH_PATH)) return;
    // The dev sink (`/auth/dev/last-otp`, `last-link`) is a lookup, not a sign-in attempt, and
    // does not exist in production. Counting it made a refused lookup answer with a 429 body the
    // test then read as "no code" — the shape of CI's failure on 2026-09-26.
    if (request.url.startsWith(`${AUTH_PATH}dev/`)) return;

    // Per user when signed in, per IP otherwise (PRD §12.1).
    const identity = (request as { user?: { id?: string } }).user?.id ?? request.ip;
    const verdict = await checkRateLimit(redis, 'auth', identity, authRule);
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

  // PRD §12.1 / PHASES 5.4: the AI endpoints get a per-user burst limit too, keyed on the session
  // cookie (the guard has not run yet at onRequest); the monthly cap (per user) is enforced
  // inside each handler, before any provider call.
  fastify.addHook('onRequest', async (request, reply) => {
    if (!AI_PATHS.some((prefix) => request.url.startsWith(prefix))) return;

    const identity = rateIdentity(request.headers.cookie, request.ip);
    const verdict = await checkRateLimit(redis, 'ai', identity, AI_RATE_LIMIT);
    if (verdict.allowed) return;

    reply
      .status(429)
      .header('retry-after', String(verdict.retryAfter))
      .type('application/problem+json')
      .send({
        type: 'RATE_LIMITED',
        title: 'Too many requests',
        status: 429,
        detail: `Too many AI requests. Try again in ${verdict.retryAfter} seconds.`,
        instance: request.url,
        requestId: request.id,
      });
  });

  // 2026-09-28: every other API request is limited too, and the expensive ones twice — the
  // general rule and a tighter one for uploads, searches and exports (common/rate-limit.ts).
  const refuse = (
    request: FastifyRequest,
    reply: FastifyReply,
    verdict: RateLimitVerdict,
    what: string,
  ) =>
    reply
      .status(429)
      .header('retry-after', String(verdict.retryAfter))
      .type('application/problem+json')
      .send({
        type: 'RATE_LIMITED',
        title: 'Too many requests',
        status: 429,
        detail: `Too many ${what} in a minute. Try again in ${verdict.retryAfter} seconds.`,
        instance: request.url,
        requestId: request.id,
      });
  fastify.addHook('onRequest', async (request, reply) => {
    const kind = classifyRequest(request.method, request.url);
    if (!kind) return;
    const identity = rateIdentity(request.headers.cookie, request.ip);

    const general = await checkRateLimit(redis, 'api', identity, GENERAL_RATE_LIMIT);
    if (!general.allowed) return refuse(request, reply, general, 'requests');

    if (kind.heavy) {
      const heavy = await checkRateLimit(
        redis,
        kind.heavy,
        identity,
        HEAVY_RATE_LIMITS[kind.heavy],
      );
      const what = {
        upload: 'uploads',
        search: 'searches',
        export: 'exports',
        link: 'requests to a shared link',
        copy: 'copies',
        file: 'paper downloads',
      }[kind.heavy];
      if (!heavy.allowed) return refuse(request, reply, heavy, what);
    }
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
