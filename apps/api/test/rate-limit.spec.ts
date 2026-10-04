/**
 * Rate limiting — PRD §12.1 ("per IP and per user (Redis) on auth and AI endpoints").
 *
 * Runs against a real Redis, because the guarantee is the atomicity of `INCR` under concurrency,
 * not the arithmetic around it.
 */

import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_RATE_LIMIT,
  checkRateLimit,
  classifyRequest,
  GENERAL_RATE_LIMIT,
  HEAVY_RATE_LIMITS,
  type RateLimitRule,
  rateIdentity,
} from '../src/common/rate-limit.js';

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
  // The window is fixed (`floor(now / window)`), so calls that straddle a boundary start a new
  // count, and a test of "exactly `max`" failed in CI when its eight calls crossed a minute
  // (2026-09-30). The clock is pinned one second into a window; only Date is faked, so Redis
  // and its timers run as normal.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Math.ceil(Date.now() / 60_000) * 60_000 + 1_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

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

// 2026-09-28: every API request is limited, and uploads, searches and exports twice.
describe('classifyRequest', () => {
  const doc = '01a0e1cc-36a3-7f94-aa95-291b768b9092';

  it('limits every API call with the general rule', () => {
    expect(classifyRequest('GET', `/api/v1/documents/${doc}`)).toEqual({
      general: true,
      heavy: null,
    });
    expect(classifyRequest('PUT', '/api/v1/chapters/x?draft=1')).toEqual({
      general: true,
      heavy: null,
    });
  });

  it('leaves out the health check, metrics, sign-in and anything outside the API', () => {
    expect(classifyRequest('GET', '/api/v1/health')).toBeNull();
    expect(classifyRequest('GET', '/api/v1/metrics')).toBeNull();
    expect(classifyRequest('POST', '/api/v1/auth/sign-in/email')).toBeNull();
    expect(classifyRequest('GET', '/collab/room')).toBeNull();
  });

  it('adds the tighter rule to uploads, searches and exports', () => {
    expect(classifyRequest('POST', `/api/v1/documents/${doc}/sources/upload`)?.heavy).toBe(
      'upload',
    );
    expect(classifyRequest('POST', '/api/v1/chapters/c1/figures')?.heavy).toBe('upload');
    expect(
      classifyRequest('POST', `/api/v1/documents/${doc}/feedback/comments/import-docx`)?.heavy,
    ).toBe('upload');
    // ADR-0062: both Zotero routes call Zotero with the student's key.
    for (const route of ['collections', 'import']) {
      expect(
        classifyRequest('POST', `/api/v1/documents/${doc}/sources/zotero/${route}`)?.heavy,
      ).toBe('upload');
    }
    expect(classifyRequest('POST', `/api/v1/documents/${doc}/search`)?.heavy).toBe('search');
    expect(classifyRequest('POST', `/api/v1/documents/${doc}/sources/resolve`)?.heavy).toBe(
      'search',
    );
    expect(classifyRequest('POST', `/api/v1/documents/${doc}/export`)?.heavy).toBe('export');
    expect(classifyRequest('POST', `/api/v1/documents/${doc}/export/thesis`)?.heavy).toBe('export');
    expect(classifyRequest('GET', `/api/v1/documents/${doc}/sources/export`)?.heavy).toBe('export');
  });

  it('does not count reading a search, or picking from it, as a new search', () => {
    expect(classifyRequest('GET', `/api/v1/documents/${doc}/search`)?.heavy).toBeNull();
    expect(classifyRequest('GET', `/api/v1/documents/${doc}/search/run-1`)?.heavy).toBeNull();
    expect(
      classifyRequest('POST', `/api/v1/documents/${doc}/search/run-1/select`)?.heavy,
    ).toBeNull();
  });

  it('keeps the heavy rules tighter than the general one', () => {
    for (const rule of Object.values(HEAVY_RATE_LIMITS)) {
      expect(rule.max).toBeLessThan(GENERAL_RATE_LIMIT.max);
    }
  });
});

describe('rateIdentity', () => {
  it('counts a signed-in student by their session, whatever address they share', () => {
    const a = rateIdentity('better-auth.session_token=tokA.sigA', '10.0.0.1');
    const b = rateIdentity('better-auth.session_token=tokB.sigB', '10.0.0.1');
    expect(a).not.toBe(b);
    expect(a.startsWith('s:')).toBe(true);
  });

  it('reads the production (__Secure-) cookie, and never stores the token itself', () => {
    const id = rateIdentity(
      'x=1; __Secure-better-auth.session_token=secret123.sig; y=2',
      '1.1.1.1',
    );
    expect(id).toBe(rateIdentity('better-auth.session_token=secret123.other', '9.9.9.9'));
    expect(id).not.toContain('secret123');
  });

  it('falls back to the address for a visitor with no session', () => {
    expect(rateIdentity(undefined, '1.2.3.4')).toBe('ip:1.2.3.4');
    expect(rateIdentity('theme=dark', '1.2.3.4')).toBe('ip:1.2.3.4');
  });
});
