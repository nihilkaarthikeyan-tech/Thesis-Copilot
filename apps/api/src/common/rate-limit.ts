/**
 * Rate limiting — PRD §12.1: "Rate limiting per IP and per user (Redis) on auth and AI endpoints."
 *
 * A fixed-window counter in Redis: `INCR` the key, and set the TTL on the first hit of a window.
 * Both commands go in one pipeline, so it is a single round trip.
 *
 * Written directly rather than via `@fastify/rate-limit` because that plugin's `createRateLimit`
 * decorator did not pick up its per-call `max`/`timeWindow` (the Redis key came out as
 * `fastify-rate-limit-undefinedundefined-<ip>` and every request was refused). Fifteen lines we
 * control beat a plugin we have to guess at — PRD §0.3 rule 6, prefer boring. Recorded in
 * docs/BUILD_LOG.md.
 *
 * Redis-backed, so the limit holds across the two API replicas in §13.2 rather than being per
 * process. It fails open: if Redis is unreachable the request is allowed, because a broken limiter
 * must not take the product down. Redis being down is already reported by `/health`.
 */

import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';

export type RateLimitRule = {
  /** Requests allowed per window. */
  readonly max: number;
  /** Window length in seconds. */
  readonly windowSeconds: number;
};

export type RateLimitVerdict = {
  readonly allowed: boolean;
  readonly remaining: number;
  /** Seconds until the window resets. */
  readonly retryAfter: number;
};

/** 20 sign-in attempts per minute (PRD §12.1). */
export const AUTH_RATE_LIMIT: RateLimitRule = { max: 20, windowSeconds: 60 };

/**
 * The rule in force: the PRD's twenty unless `AUTH_RATE_LIMIT_PER_MINUTE` says otherwise, which
 * only a test environment does (see `packages/config`). Production never sets it.
 */
export function authRateLimit(env: { AUTH_RATE_LIMIT_PER_MINUTE?: number }): RateLimitRule {
  return { ...AUTH_RATE_LIMIT, max: env.AUTH_RATE_LIMIT_PER_MINUTE ?? AUTH_RATE_LIMIT.max };
}

/**
 * PRD §12.1 also limits the AI endpoints. This is a per-user burst guard, not the monthly cap:
 * the cap (§11.3) says how much a student gets, this says how fast they may ask for it. Sixty a
 * minute is far above any human typing rate and far below what a runaway client would send.
 */
export const AI_RATE_LIMIT: RateLimitRule = { max: 60, windowSeconds: 60 };

export async function checkRateLimit(
  redis: Redis,
  scope: string,
  identity: string,
  rule: RateLimitRule,
): Promise<RateLimitVerdict> {
  // The window is part of the key, so a window rolls over by moving to a new key. No cleanup needed.
  const window = Math.floor(Date.now() / (rule.windowSeconds * 1000));
  const key = `rl:${scope}:${identity}:${window}`;

  try {
    const results = await redis.multi().incr(key).expire(key, rule.windowSeconds, 'NX').exec();

    const count = Number(results?.[0]?.[1] ?? 0);
    const elapsed = (Date.now() % (rule.windowSeconds * 1000)) / 1000;

    return {
      allowed: count <= rule.max,
      remaining: Math.max(rule.max - count, 0),
      retryAfter: Math.ceil(rule.windowSeconds - elapsed),
    };
  } catch {
    // Fail open. A rate limiter that takes the site down is worse than one that lets a burst
    // through; Redis being unreachable already shows as `degraded` on /health.
    return { allowed: true, remaining: rule.max, retryAfter: 0 };
  }
}

/**
 * Every other API request (2026-09-28). PRD §12.1 named auth and AI; everything else — saving,
 * listing, uploading, exporting, searching — had no limit, so one runaway client could slow the
 * site for everyone. Six hundred a minute is ten a second: far above a student typing with
 * autosave and suggestions, far below a script in a loop.
 */
export const GENERAL_RATE_LIMIT: RateLimitRule = { max: 600, windowSeconds: 60 };

/**
 * The expensive routes get a second, tighter limit on top of the general one: each of these makes
 * the server read a file, call an outside index, or build a document.
 */
export const HEAVY_RATE_LIMITS = {
  /** A PDF, a figure, a marked-up .docx or a reference file. */
  upload: { max: 30, windowSeconds: 60 },
  /** A literature search or a DOI lookup — both call outside indexes (OpenAlex, Crossref…). */
  search: { max: 20, windowSeconds: 60 },
  /** A .docx, PDF, LaTeX or log export — each one builds a whole document. */
  export: { max: 10, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type HeavyKind = keyof typeof HEAVY_RATE_LIMITS;

const ID = '[^/]+';
const HEAVY_ROUTES: ReadonlyArray<{ method: string; pattern: RegExp; kind: HeavyKind }> = [
  {
    method: 'POST',
    pattern: new RegExp(`^/api/v1/documents/${ID}/sources/upload$`),
    kind: 'upload',
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/api/v1/documents/${ID}/sources/import$`),
    kind: 'upload',
  },
  { method: 'POST', pattern: new RegExp(`^/api/v1/documents/${ID}/seed-papers$`), kind: 'upload' },
  { method: 'POST', pattern: new RegExp(`^/api/v1/chapters/${ID}/figures$`), kind: 'upload' },
  {
    method: 'POST',
    pattern: new RegExp(`^/api/v1/documents/${ID}/feedback/comments/import-docx$`),
    kind: 'upload',
  },
  { method: 'POST', pattern: new RegExp(`^/api/v1/documents/${ID}/search$`), kind: 'search' },
  {
    method: 'POST',
    pattern: new RegExp(`^/api/v1/documents/${ID}/sources/resolve$`),
    kind: 'search',
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/api/v1/documents/${ID}/export(/[a-z-]+)?$`),
    kind: 'export',
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/api/v1/documents/${ID}/feedback/export$`),
    kind: 'export',
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/api/v1/documents/${ID}/sources/export$`),
    kind: 'export',
  },
];

/** Routes no limiter counts: the health check and the metrics scrape are the operator's. */
const UNLIMITED = ['/api/v1/health', '/api/v1/metrics'];

/**
 * How a request is limited: `general` for any API call, plus the heavy kind when it is one.
 * `null` for anything outside the API, the health check, and sign-in (which has its own rule).
 */
export function classifyRequest(
  method: string,
  url: string,
): { general: boolean; heavy: HeavyKind | null } | null {
  const path = url.split('?')[0] ?? url;
  if (!path.startsWith('/api/v1/')) return null;
  if (UNLIMITED.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  if (path.startsWith('/api/v1/auth/')) return null;
  const heavy = HEAVY_ROUTES.find((r) => r.method === method && r.pattern.test(path));
  return { general: true, heavy: heavy?.kind ?? null };
}

/**
 * Who a request counts against. The session guard has not run at `onRequest`, so the signed-in
 * student is recognised by their session cookie — hashed, so no token is ever written to Redis.
 * Per user rather than per IP matters here: a whole university can sit behind one address.
 * Anyone without a session counts against their IP.
 */
export function rateIdentity(cookieHeader: string | undefined, ip: string): string {
  const match = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/.exec(
    cookieHeader ?? '',
  );
  const token = match?.[1] ? decodeURIComponent(match[1]).split('.')[0] : '';
  if (!token) return `ip:${ip}`;
  return `s:${createHash('sha256').update(token).digest('hex').slice(0, 24)}`;
}
