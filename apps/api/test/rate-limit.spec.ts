/**
 * Rate limiting — PRD §12.1 ("per IP and per user (Redis) on auth and AI endpoints").
 *
 * Runs against a real Redis, because the guarantee is the atomicity of `INCR` under concurrency,
 * not the arithmetic around it.
 */

import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AUTH_RATE_LIMIT, checkRateLimit, type RateLimitRule } from '../src/common/rate-limit.js';

let container: StartedRedisContainer;
let redis: Redis;

const rule: RateLimitRule = { max: 5, windowSeconds: 60 };

beforeAll(async () => {
  container = await new RedisContainer('redis:7-alpine').start();
  redis = new Redis(container.getConnectionUrl());
}, 180_000);

afterAll(async () => {
  redis?.disconnect();
  await container?.stop();
});

beforeEach(async () => {
  await redis.flushall();
});

describe('checkRateLimit', () => {
  it('allows exactly `max` requests, then refuses', async () => {
    const verdicts = [];
    for (let i = 0; i < 8; i++) {
      verdicts.push(await checkRateLimit(redis, 'auth', '1.2.3.4', rule));
    }

    expect(verdicts.filter((v) => v.allowed)).toHaveLength(5);
    expect(verdicts.slice(5).every((v) => !v.allowed)).toBe(true);
  });

  it('counts down the remaining allowance', async () => {
    const first = await checkRateLimit(redis, 'auth', '1.2.3.4', rule);
    const second = await checkRateLimit(redis, 'auth', '1.2.3.4', rule);

    expect(first.remaining).toBe(4);
    expect(second.remaining).toBe(3);
  });

  it('keeps identities separate, so one user cannot lock out another', async () => {
    for (let i = 0; i < 6; i++) {
      await checkRateLimit(redis, 'auth', 'noisy', rule);
    }

    const other = await checkRateLimit(redis, 'auth', 'quiet', rule);
    expect(other.allowed).toBe(true);
  });

  it('keeps scopes separate', async () => {
    for (let i = 0; i < 6; i++) {
      await checkRateLimit(redis, 'auth', 'same-ip', rule);
    }

    const assist = await checkRateLimit(redis, 'assist', 'same-ip', rule);
    expect(assist.allowed).toBe(true);
  });

  it('holds under concurrency: 50 parallel requests let exactly `max` through', async () => {
    const verdicts = await Promise.all(
      Array.from({ length: 50 }, () => checkRateLimit(redis, 'auth', 'racer', rule)),
    );

    expect(verdicts.filter((v) => v.allowed)).toHaveLength(rule.max);
  });

  it('sets a TTL so the window expires', async () => {
    await checkRateLimit(redis, 'auth', 'ttl-check', rule);
    const [key] = await redis.keys('rl:auth:ttl-check:*');

    expect(key).toBeDefined();
    const ttl = await redis.ttl(key as string);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(rule.windowSeconds);
  });

  it('reports how long to wait', async () => {
    const verdict = await checkRateLimit(redis, 'auth', 'retry', rule);
    expect(verdict.retryAfter).toBeGreaterThan(0);
    expect(verdict.retryAfter).toBeLessThanOrEqual(rule.windowSeconds);
  });

  it('fails open when Redis is unreachable', async () => {
    // A broken limiter must not take the product down. Redis being down already shows on /health.
    const broken = new Redis({
      host: '127.0.0.1',
      port: 1,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    broken.on('error', () => undefined);

    const verdict = await checkRateLimit(broken, 'auth', 'anyone', rule);
    expect(verdict.allowed).toBe(true);

    broken.disconnect();
  });

  it('uses the 20-per-minute rule the PRD asks for on auth', () => {
    expect(AUTH_RATE_LIMIT).toEqual({ max: 20, windowSeconds: 60 });
  });
});
