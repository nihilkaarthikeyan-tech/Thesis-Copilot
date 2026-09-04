/**
 * Env schema — PRD §13.3 and §0.2 ("the app must refuse to start with a missing required variable").
 */

import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from '../src/env.js';

/** A complete, valid development environment. Each test removes or changes one thing. */
const base: Record<string, string> = {
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:3001',
  DATABASE_URL: 'postgresql://tc:tc@localhost:5434/tc',
  REDIS_URL: 'redis://localhost:6381',
  S3_ENDPOINT: 'http://localhost:9002',
  S3_ACCESS_KEY: 'tc',
  S3_SECRET_KEY: 'tc-secret-key',
  S3_BUCKET: 'thesis-copilot',
  S3_REGION: 'us-east-1',
  AUTH_SECRET: 'x'.repeat(32),
  AI_PROVIDER: 'mock',
  AI_FAST_MODEL: 'fast-model-id',
  AI_STRONG_MODEL: 'strong-model-id',
  EMBED_PROVIDER: 'mock',
  AI_EMBED_MODEL: 'embed-model-id',
  EMBED_DIMS: '1024',
  OPENALEX_MAILTO: 'you@example.com',
  CROSSREF_MAILTO: 'you@example.com',
  UNPAYWALL_EMAIL: 'you@example.com',
  GOTENBERG_URL: 'http://localhost:3002',
  SEED_ADMIN_EMAIL: 'admin@example.com',
};

const withEnv = (patch: Record<string, string | undefined>) => ({ ...base, ...patch });

describe('loadEnv', () => {
  it('accepts a complete development environment', () => {
    const env = loadEnv(base);
    expect(env.NODE_ENV).toBe('development');
    expect(env.EMBED_DIMS).toBe(1024);
    expect(env.S3_REGION).toBe('us-east-1');
  });

  it('coerces EMBED_DIMS to a number', () => {
    expect(loadEnv(withEnv({ EMBED_DIMS: '1536' })).EMBED_DIMS).toBe(1536);
  });

  it('defaults EMBED_DIMS to 1024 when unset', () => {
    expect(loadEnv(withEnv({ EMBED_DIMS: undefined })).EMBED_DIMS).toBe(1024);
  });

  it('normalises an empty optional variable to undefined', () => {
    expect(loadEnv(withEnv({ SENTRY_DSN: '' })).SENTRY_DSN).toBeUndefined();
  });

  it('treats a blank numeric variable as absent, not zero', () => {
    // A .env file that declares SMTP_PORT= with no value hands over '', which z.coerce.number()
    // would otherwise turn into 0 and reject. Caught by `pnpm ai:verify` refusing to start.
    expect(loadEnv(withEnv({ SMTP_PORT: '' })).SMTP_PORT).toBeUndefined();
    expect(loadEnv(withEnv({ SMTP_PORT: '587' })).SMTP_PORT).toBe(587);
  });

  it('still rejects a nonsensical port', () => {
    expect(() => loadEnv(withEnv({ SMTP_PORT: '0' }))).toThrow(EnvValidationError);
    expect(() => loadEnv(withEnv({ SMTP_PORT: 'abc' }))).toThrow(EnvValidationError);
  });

  describe('refuses to start when a required variable is missing', () => {
    const required = [
      'APP_URL',
      'API_URL',
      'DATABASE_URL',
      'REDIS_URL',
      'S3_ENDPOINT',
      'S3_ACCESS_KEY',
      'S3_SECRET_KEY',
      'S3_BUCKET',
      'AUTH_SECRET',
      'AI_FAST_MODEL',
      'AI_STRONG_MODEL',
      'AI_EMBED_MODEL',
      'OPENALEX_MAILTO',
      'CROSSREF_MAILTO',
      'UNPAYWALL_EMAIL',
      'GOTENBERG_URL',
      'SEED_ADMIN_EMAIL',
    ];

    for (const key of required) {
      it(key, () => {
        expect(() => loadEnv(withEnv({ [key]: undefined }))).toThrow(EnvValidationError);
      });
    }
  });

  it('names every offending variable in the error', () => {
    try {
      loadEnv(withEnv({ DATABASE_URL: undefined, REDIS_URL: undefined }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const message = (error as EnvValidationError).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('REDIS_URL');
      expect(message).toContain('.env.example');
    }
  });

  it('rejects a short AUTH_SECRET', () => {
    expect(() => loadEnv(withEnv({ AUTH_SECRET: 'too-short' }))).toThrow(/at least 32/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => loadEnv(withEnv({ DATABASE_URL: 'mysql://x/y' }))).toThrow(/postgresql/);
  });

  it('rejects a malformed email', () => {
    expect(() => loadEnv(withEnv({ OPENALEX_MAILTO: 'not-an-email' }))).toThrow(EnvValidationError);
  });

  describe('conditional requirements', () => {
    it('requires ANTHROPIC_API_KEY when AI_PROVIDER=anthropic', () => {
      expect(() => loadEnv(withEnv({ AI_PROVIDER: 'anthropic' }))).toThrow(/ANTHROPIC_API_KEY/);
      expect(() =>
        loadEnv(withEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test' })),
      ).not.toThrow();
    });

    it('requires VOYAGE_API_KEY when EMBED_PROVIDER=voyage', () => {
      expect(() => loadEnv(withEnv({ EMBED_PROVIDER: 'voyage' }))).toThrow(/VOYAGE_API_KEY/);
    });

    it('requires the Google pair to be set together', () => {
      expect(() => loadEnv(withEnv({ GOOGLE_CLIENT_ID: 'id' }))).toThrow(/together/);
      expect(() =>
        loadEnv(withEnv({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' })),
      ).not.toThrow();
    });

    it('allows both Google variables to be unset', () => {
      expect(() => loadEnv(base)).not.toThrow();
    });

    it('requires all three Razorpay variables together', () => {
      expect(() => loadEnv(withEnv({ RAZORPAY_KEY_ID: 'id' }))).toThrow(/together/);
      expect(() =>
        loadEnv(
          withEnv({
            RAZORPAY_KEY_ID: 'id',
            RAZORPAY_KEY_SECRET: 'secret',
            RAZORPAY_WEBHOOK_SECRET: 'hook',
          }),
        ),
      ).not.toThrow();
    });
  });

  describe('production is stricter', () => {
    const prod = (patch: Record<string, string | undefined> = {}) =>
      withEnv({
        NODE_ENV: 'production',
        APP_URL: 'https://app.example.com',
        API_URL: 'https://app.example.com',
        RESEND_API_KEY: 're_test',
        ...patch,
      });

    it('accepts a complete production environment', () => {
      expect(() => loadEnv(prod())).not.toThrow();
    });

    it('rejects http APP_URL in production', () => {
      expect(() => loadEnv(prod({ APP_URL: 'http://app.example.com' }))).toThrow(/https/);
    });

    it('requires a mail transport in production', () => {
      expect(() => loadEnv(prod({ RESEND_API_KEY: undefined }))).toThrow(/RESEND_API_KEY/);
    });

    it('accepts SMTP instead of Resend in production', () => {
      expect(() =>
        loadEnv(
          prod({
            RESEND_API_KEY: undefined,
            SMTP_HOST: 'smtp.example.com',
            SMTP_PORT: '587',
            SMTP_FROM: 'Thesis Copilot <no-reply@example.com>',
          }),
        ),
      ).not.toThrow();
    });

    it('does not require a mail transport in development', () => {
      expect(() => loadEnv(base)).not.toThrow();
    });
  });
});
