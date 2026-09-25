/**
 * Environment schema — PRD §13.3, validated with Zod at boot.
 *
 * PRD §0.2: "All secrets via environment variables, validated at boot with Zod (`packages/config`).
 * The app must refuse to start with a missing required variable." `loadEnv` throws; nothing catches
 * it, so the process exits.
 *
 * Variables §13.3 marks with `?` are optional. Three groups are conditionally required instead of
 * unconditionally, because the feature they belong to does not exist yet in Phase 0 — see the
 * comment on each. That relaxation is logged in docs/BUILD_LOG.md and docs/CONSISTENCY_REVIEW.md
 * for human sign-off (PRD §0.3 rule 4).
 */

import { z } from 'zod';

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === '' ? undefined : v));

/**
 * A variable left blank in a .env file arrives as '' rather than undefined. Numeric fields must
 * treat that as absent, otherwise `z.coerce.number()` turns '' into 0.
 */
const optionalNumber = z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : v),
  z.coerce.number().int().positive().optional(),
);

const requiredString = (label: string) => z.string().trim().min(1, `${label} is required`);

const url = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .refine((v) => URL.canParse(v), `${label} must be a valid URL`);

export const envSchema = z
  .object({
    // ---- Core ----
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_URL: url('APP_URL'),
    API_URL: url('API_URL'),

    // ---- Data stores ----
    DATABASE_URL: requiredString('DATABASE_URL').refine(
      (v) => v.startsWith('postgresql://') || v.startsWith('postgres://'),
      'DATABASE_URL must be a postgresql:// connection string',
    ),
    REDIS_URL: requiredString('REDIS_URL').refine(
      (v) => v.startsWith('redis://') || v.startsWith('rediss://'),
      'REDIS_URL must be a redis:// connection string',
    ),

    // ---- Object storage ----
    S3_ENDPOINT: url('S3_ENDPOINT'),
    S3_ACCESS_KEY: requiredString('S3_ACCESS_KEY'),
    S3_SECRET_KEY: requiredString('S3_SECRET_KEY'),
    S3_BUCKET: requiredString('S3_BUCKET'),
    S3_REGION: z.string().trim().min(1).default('us-east-1'),

    // ---- Auth ----
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
    // §13.3 lists these unmarked. Google sign-in is one of two methods (§7.2: "Email OTP + Google")
    // and email OTP alone is enough to run, so they are optional-but-paired; production is checked
    // in the refinement below only when one of the pair is present.
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,

    // ---- LLM provider ----
    /**
     * `mock` forces the mock for both tiers; anything else means "use real providers", and which
     * vendor serves each tier comes from that tier's model id (ADR-0011). The `anthropic` value is
     * kept rather than renamed so existing `.env` files and every test harness keep working.
     */
    AI_PROVIDER: z.enum(['anthropic', 'mock']).default('anthropic'),
    ANTHROPIC_API_KEY: optionalString,
    /** ADR-0011. Required only when a configured model id is an OpenAI one. */
    OPENAI_API_KEY: optionalString,
    // Model ids are never guessed (PRD §0.3 rule 5). They are required, have no default, and are
    // confirmed against the provider by `pnpm ai:verify` (Appendix E.1).
    AI_FAST_MODEL: requiredString('AI_FAST_MODEL'),
    AI_STRONG_MODEL: requiredString('AI_STRONG_MODEL'),

    // Simulated time-to-first-token for the mock provider. PRD §16 week 1 runs the editor spike
    // at 250 ms; the k6 load test (§15) uses the same figure.
    AI_MOCK_LATENCY_MS: z.preprocess(
      (v) => (v === '' || v === undefined ? undefined : v),
      z.coerce.number().int().min(0).default(250),
    ),

    // ---- Embeddings ----
    EMBED_PROVIDER: z.enum(['voyage', 'mock']).default('voyage'),
    VOYAGE_API_KEY: optionalString,
    AI_EMBED_MODEL: requiredString('AI_EMBED_MODEL'),
    // Dimension is a config constant and must match `vector(N)` in schema.prisma (PRD §7.2).
    EMBED_DIMS: z.coerce.number().int().positive().default(1024),
    /**
     * The whole site's AI spend for a calendar month, in rupees, after which every metered call
     * is refused until the 1st (2026-09-25, the owner's guard). Unset means no site-wide stop;
     * the per-user ₹100 ceiling (§11) always applies.
     */
    PLATFORM_MONTHLY_CEILING_INR: optionalNumber,
    /** Extra addresses the §14 alert emails go to, comma-separated; the seed admin always does. */
    ALERT_EMAILS: optionalString,

    // ---- Scholarly APIs ----
    OPENALEX_MAILTO: z.email('OPENALEX_MAILTO must be an email address'),
    // OpenAlex meters its API (2026): without a key the whole site gets $0.10 of use a day, about
    // a hundred searches; the free key raises that to $1. Optional so the app still starts.
    OPENALEX_API_KEY: optionalString,
    CROSSREF_MAILTO: z.email('CROSSREF_MAILTO must be an email address'),
    UNPAYWALL_EMAIL: z.email('UNPAYWALL_EMAIL must be an email address'),
    SEMANTIC_SCHOLAR_API_KEY: optionalString,
    CORE_API_KEY: optionalString,
    // ADR-0020: PubMed works without one at 3 requests/second; a free NCBI key raises it to 10.
    NCBI_API_KEY: optionalString,

    // ---- Payments (Razorpay ships in Phase 2 week 11; unset until then) ----
    RAZORPAY_KEY_ID: optionalString,
    RAZORPAY_KEY_SECRET: optionalString,
    RAZORPAY_WEBHOOK_SECRET: optionalString,
    // Plan ids created once in the Razorpay dashboard (docs/PENDING.md); §11.6's prices.
    RAZORPAY_PLAN_MONTHLY: optionalString,
    RAZORPAY_PLAN_ANNUAL: optionalString,

    // ---- Email: Resend or SMTP (§13.3 "RESEND_API_KEY or SMTP_*") ----
    RESEND_API_KEY: optionalString,
    SMTP_HOST: optionalString,
    // An unset variable in a .env file arrives as '', which `z.coerce.number()` turns into 0 and
    // then rejects as not positive. Blank it back to undefined first.
    SMTP_PORT: optionalNumber,
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    SMTP_FROM: optionalString,
    // Sender for either transport, e.g. "Thesis Copilot <no-reply@example.edu>". Falls back to
    // SMTP_FROM, then to no-reply@<APP_URL host>.
    MAIL_FROM: optionalString,

    // ---- Document services ----
    GOTENBERG_URL: url('GOTENBERG_URL'),
    GROBID_URL: optionalString,

    // ---- Overrides / observability ----
    PRICING_OVERRIDE_JSON: optionalString,
    /**
     * ADR-0028: serve the live co-authoring WebSocket from this process. One instance only in
     * production (`collab` in compose) — rooms live in memory, so two would split a chapter.
     * Blank or unset is off; the `collaboration` feature flag still has to be on as well.
     */
    COLLAB_ENABLED: z
      .string()
      .optional()
      .transform((v) => v === 'true' || v === '1'),
    SENTRY_DSN: optionalString,

    // ---- Seed ----
    SEED_ADMIN_EMAIL: z.email('SEED_ADMIN_EMAIL must be an email address'),
  })
  .superRefine((env, ctx) => {
    const isProd = env.NODE_ENV === 'production';

    // ADR-0011: each tier's vendor comes from its model id, so the key each one needs is
    // required only when some tier actually asks for that vendor. Kept here rather than in
    // `packages/ai` because §0.2 says the app refuses to start on a missing required variable,
    // and "required" is conditional on the model ids sitting right beside these keys.
    if (env.AI_PROVIDER !== 'mock') {
      const vendors = new Set(
        [env.AI_FAST_MODEL, env.AI_STRONG_MODEL].map((id) =>
          /^(gpt-|o[134])/i.test(id.trim()) ? 'openai' : 'anthropic',
        ),
      );
      if (vendors.has('anthropic') && !env.ANTHROPIC_API_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['ANTHROPIC_API_KEY'],
          message:
            'ANTHROPIC_API_KEY is required: AI_FAST_MODEL or AI_STRONG_MODEL names a Claude model',
        });
      }
      if (vendors.has('openai') && !env.OPENAI_API_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['OPENAI_API_KEY'],
          message:
            'OPENAI_API_KEY is required: AI_FAST_MODEL or AI_STRONG_MODEL names an OpenAI model',
        });
      }
    }

    if (env.EMBED_PROVIDER === 'voyage' && !env.VOYAGE_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['VOYAGE_API_KEY'],
        message: 'VOYAGE_API_KEY is required when EMBED_PROVIDER=voyage',
      });
    }

    const googleSet = [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET].filter(Boolean).length;
    if (googleSet === 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_SECRET'],
        message: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together, or both unset',
      });
    }

    const razorpaySet = [
      env.RAZORPAY_KEY_ID,
      env.RAZORPAY_KEY_SECRET,
      env.RAZORPAY_WEBHOOK_SECRET,
    ].filter(Boolean).length;
    if (razorpaySet > 0 && razorpaySet < 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['RAZORPAY_KEY_ID'],
        message:
          'RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET must be set together',
      });
    }

    // Transactional email is required to sign anyone in (email OTP), but only in production —
    // development logs the OTP to the console instead.
    const hasSmtp = Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_FROM);
    if (isProd && !env.RESEND_API_KEY && !hasSmtp) {
      ctx.addIssue({
        code: 'custom',
        path: ['RESEND_API_KEY'],
        message:
          'Set RESEND_API_KEY, or SMTP_HOST + SMTP_PORT + SMTP_FROM, so email OTP can be delivered',
      });
    }

    if (isProd && env.APP_URL.startsWith('http://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_URL'],
        message: 'APP_URL must use https in production (PRD §12.1: all traffic TLS)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(
      'Invalid environment. The app will not start.\n' +
        issues.map((i) => `  - ${i}`).join('\n') +
        '\nSee .env.example and PRD §13.3.',
    );
    this.name = 'EnvValidationError';
  }
}

/**
 * Validates `source` (defaults to `process.env`) and returns the typed env.
 * Throws `EnvValidationError` on any missing or invalid required variable (PRD §0.2).
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join('.') || '(root)';
      return `${path}: ${issue.message}`;
    });
    throw new EnvValidationError(issues);
  }
  return result.data;
}
