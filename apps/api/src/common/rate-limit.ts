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
