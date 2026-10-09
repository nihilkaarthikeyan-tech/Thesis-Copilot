/**
 * Cap enforcement under concurrency — PRD §15 and PHASES.md task 0.6.
 *
 *   PRD §15: "cap enforcement under concurrency (20 parallel calls at cap−1 → exactly 1 succeeds)"
 *
 * This is the test the ₹100/user/month constraint rests on (PRD §11). If two concurrent requests
 * can both take the last unit, every cap in §11.3 is an approximation and the budget is fiction.
 *
 * It runs against a real PostgreSQL in Testcontainers, because the guarantee comes from Postgres's
 * row locking in `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE`, not from application code. A
 * mocked database would prove nothing.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CALLS_PER_KEPT, callCeiling, PLAN_LIMITS } from '@tc/config';
import { PrismaClient } from '@tc/db';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  periodFor,
  refusal,
  resetsAtFor,
  UsageService,
} from '../src/modules/usage/usage.service.js';

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let usage: UsageService;
let userId: string;

/**
 * Every migration, in order — the same set `prisma migrate deploy` applies in production. Applying
 * only the first one silently diverges from the real schema the moment a second migration lands
 * (it did: 0002 added Better Auth columns to `User`, and the generated client started sending them).
 */
const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../packages/db/prisma/migrations/', import.meta.url),
);
const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
  .map((dir) => ({ name: dir, source: join(MIGRATIONS_DIR, dir, 'migration.sql') }));

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('tc_test')
    .withUsername('tc')
    .withPassword('tc')
    // Apply the real migration files, so the test runs against the DDL production runs — including
    // uuid_generate_v7() and the UsageLedger unique index the ON CONFLICT depends on. Copied in and
    // run with psql rather than split in JavaScript: 0001 contains a plpgsql body delimited by $$,
    // which naive statement splitting would break.
    .withCopyFilesToContainer(
      MIGRATION_FILES.map((m) => ({
        source: m.source,
        target: `/tmp/migrations/${m.name}.sql`,
      })),
    )
    .start();

  for (const migration of MIGRATION_FILES) {
    const applied = await container.exec([
      'psql',
      '-U',
      'tc',
      '-d',
      'tc_test',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      `/tmp/migrations/${migration.name}.sql`,
    ]);
    if (applied.exitCode !== 0) {
      throw new Error(
        `Migration ${migration.name} failed inside the container:\n${applied.output}`,
      );
    }
  }

  prisma = new PrismaClient({ datasources: { db: { url: container.getConnectionUri() } } });
  await prisma.$connect();

  // No site-wide ceiling here: this file proves the per-user counter, and nothing else.
  const noBudget = {
    status: async () => ({ reached: false, ceilingInr: null, spentInr: 0 }),
  } as never;
  usage = new UsageService(prisma as never, noBudget);
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

beforeEach(async () => {
  await prisma.usageLedger.deleteMany();
  await prisma.user.deleteMany();
  const user = await prisma.user.create({
    data: { email: 'cap-test@example.com', role: 'STUDENT', plan: 'STUDENT_MONTHLY' },
  });
  userId = user.id;
});

describe('UsageService.consume under concurrency', () => {
  it('20 parallel calls at the call ceiling − 1 let exactly 1 through (PRD §15)', async () => {
    // ADR-0144: Assist's calls are bounded at three per suggestion the student may keep.
    const cap = callCeiling('ASSIST', PLAN_LIMITS.STUDENT_MONTHLY.caps.ASSIST); // 540

    // Put the ledger at the ceiling − 1 so exactly one call remains.
    await prisma.usageLedger.create({
      data: { userId, period: periodFor(), action: 'ASSIST', count: cap - 1 },
    });

    const results = await Promise.all(
      Array.from({ length: 20 }, () => usage.consume(userId, 'STUDENT_MONTHLY', 'ASSIST')),
    );

    const allowed = results.filter((r) => r.ok);
    const refused = results.filter((r) => !r.ok);

    expect(allowed).toHaveLength(1);
    expect(refused).toHaveLength(19);

    // And the ledger landed exactly on the cap, never above it.
    const ledger = await prisma.usageLedger.findFirst({ where: { userId, action: 'ASSIST' } });
    expect(ledger?.count).toBe(cap);
  });

  it('20 parallel calls from empty never exceed the cap', async () => {
    // FREE_TRIAL DRAFT cap is 2, so 20 racing requests must yield exactly 2 successes.
    const cap = PLAN_LIMITS.FREE_TRIAL.caps.DRAFT;

    const results = await Promise.all(
      Array.from({ length: 20 }, () => usage.consume(userId, 'FREE_TRIAL', 'DRAFT')),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(cap);
    const ledger = await prisma.usageLedger.findFirst({ where: { userId, action: 'DRAFT' } });
    expect(ledger?.count).toBe(cap);
  });

  it('a refusal reports the cap and when it resets', async () => {
    await prisma.usageLedger.create({
      data: { userId, period: periodFor(), action: 'CHAT', count: 15 },
    });

    const result = await usage.consume(userId, 'STUDENT_MONTHLY', 'CHAT');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.cap).toBe(15);
      expect(result.resetsAt).toEqual(resetsAtFor());
      // PRD §0.2: caps reset at 00:00 UTC on the 1st.
      expect(result.resetsAt.getUTCDate()).toBe(1);
      expect(result.resetsAt.getUTCHours()).toBe(0);
    }
  });
});

describe('UsageService.consume', () => {
  it('counts up from zero and reports what is left', async () => {
    const first = await usage.consume(userId, 'STUDENT_MONTHLY', 'DRAFT');
    expect(first).toMatchObject({ ok: true, count: 1, cap: 10, remaining: 9 });

    const second = await usage.consume(userId, 'STUDENT_MONTHLY', 'DRAFT');
    expect(second).toMatchObject({ ok: true, count: 2, remaining: 8 });
  });

  it('refuses a zero cap without creating a ledger row', async () => {
    // FREE_TRIAL COHERENCE is 0 (PRD §11.3). A naive upsert would create the row at 1 and let one
    // call through, which is exactly what Appendix E.2 says must not happen.
    const result = await usage.consume(userId, 'FREE_TRIAL', 'COHERENCE');

    expect(result.ok).toBe(false);
    const rows = await prisma.usageLedger.findMany({ where: { userId, action: 'COHERENCE' } });
    expect(rows).toHaveLength(0);
  });

  it('keeps separate counters per action', async () => {
    await usage.consume(userId, 'STUDENT_MONTHLY', 'ASSIST');
    await usage.consume(userId, 'STUDENT_MONTHLY', 'DRAFT');

    const rows = await prisma.usageLedger.findMany({ where: { userId } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.count === 1)).toBe(true);
  });

  it('keeps separate counters per month', async () => {
    const september = new Date(Date.UTC(2026, 8, 15));
    const october = new Date(Date.UTC(2026, 9, 1));

    await usage.consume(userId, 'STUDENT_MONTHLY', 'ASSIST', september);
    await usage.consume(userId, 'STUDENT_MONTHLY', 'ASSIST', october);

    const rows = await prisma.usageLedger.findMany({
      where: { userId, action: 'ASSIST' },
      orderBy: { period: 'asc' },
    });
    expect(rows.map((r) => r.period)).toEqual(['2026-09', '2026-10']);
  });

  it('refunds a unit when the provider failed', async () => {
    await usage.consume(userId, 'STUDENT_MONTHLY', 'ASSIST');
    await usage.refund(userId, 'ASSIST');

    const row = await prisma.usageLedger.findFirst({ where: { userId, action: 'ASSIST' } });
    expect(row?.count).toBe(0);
  });

  it('never refunds below zero', async () => {
    await usage.consume(userId, 'STUDENT_MONTHLY', 'ASSIST');
    await usage.refund(userId, 'ASSIST');
    await usage.refund(userId, 'ASSIST');

    const row = await prisma.usageLedger.findFirst({ where: { userId, action: 'ASSIST' } });
    expect(row?.count).toBe(0);
  });
});

describe('period helpers', () => {
  it('formats the period as YYYY-MM in UTC', () => {
    expect(periodFor(new Date(Date.UTC(2026, 0, 31, 23, 59)))).toBe('2026-01');
    expect(periodFor(new Date(Date.UTC(2026, 11, 1)))).toBe('2026-12');
  });

  it('rolls the reset over the year boundary', () => {
    expect(resetsAtFor(new Date(Date.UTC(2026, 11, 20)))).toEqual(new Date(Date.UTC(2027, 0, 1)));
  });
});

/**
 * ADR-0144 (D1): Assist's allowance counts only the suggestions a student keeps. The same atomic
 * statement refuses at the allowance kept or at the call ceiling, whichever comes first, before
 * any provider call; `keep` counts a suggestion once.
 */
describe('an allowance that counts only kept suggestions (ADR-0144)', () => {
  const allowance = PLAN_LIMITS.STUDENT_MONTHLY.caps.ASSIST; // 180
  const ceiling = allowance * (CALLS_PER_KEPT.ASSIST ?? 1); // 540

  const suggestion = async (action: 'ASSIST' | 'DRAFT' = 'ASSIST', owner = userId) =>
    (
      await prisma.suggestionEvent.create({
        data: {
          userId: owner,
          documentId: '01a00000-0000-7000-8000-000000000000',
          action,
          shownChars: 80,
          outcome: 'ACCEPTED',
          keptChars: 80,
          latencyMs: 1,
        },
      })
    ).id;

  beforeEach(async () => {
    await prisma.suggestionEvent.deleteMany();
  });

  it('a call shown and not kept leaves the allowance untouched', async () => {
    const first = await usage.consume(userId, 'STUDENT_MONTHLY', 'ASSIST');
    expect(first).toMatchObject({ ok: true, count: 1, cap: allowance, remaining: allowance });
    const row = await prisma.usageLedger.findFirst({ where: { userId, action: 'ASSIST' } });
    expect(row).toMatchObject({ count: 1, kept: 0 });
  });

  it('a kept suggestion counts once, however often it is reported', async () => {
    await usage.consume(userId, 'STUDENT_MONTHLY', 'ASSIST');
    const id = await suggestion();
    expect(await usage.keep(userId, id)).toBe(true);
    expect(await usage.keep(userId, id)).toBe(false);
    await Promise.all([usage.keep(userId, id), usage.keep(userId, id)]);
    const row = await prisma.usageLedger.findFirst({ where: { userId, action: 'ASSIST' } });
    expect(row).toMatchObject({ count: 1, kept: 1 });
    const event = await prisma.suggestionEvent.findUniqueOrThrow({ where: { id } });
    expect(event.countedAt).toBeInstanceOf(Date);

    const next = await usage.consume(userId, 'STUDENT_MONTHLY', 'ASSIST');
    expect(next).toMatchObject({ ok: true, count: 2, remaining: allowance - 1 });
  });

  it('keeps nothing for another student, or for an action that counts calls', async () => {
    await usage.consume(userId, 'STUDENT_MONTHLY', 'ASSIST');
    await usage.consume(userId, 'STUDENT_MONTHLY', 'DRAFT');
    const other = await prisma.user.create({
      data: { email: 'someone-else@example.com', role: 'STUDENT', plan: 'STUDENT_MONTHLY' },
    });
    expect(await usage.keep(userId, await suggestion('ASSIST', other.id))).toBe(false);
    expect(await usage.keep(userId, await suggestion('DRAFT'))).toBe(false);
    const rows = await prisma.usageLedger.findMany({ where: { userId } });
    expect(rows.every((r) => r.kept === 0)).toBe(true);
  });

  it('refuses at the allowance kept, with calls to spare, before any call', async () => {
    await prisma.usageLedger.create({
      data: { userId, period: periodFor(), action: 'ASSIST', count: 200, kept: allowance },
    });
    const refused = await usage.consume(userId, 'STUDENT_MONTHLY', 'ASSIST');
    expect(refused).toMatchObject({ ok: false, reason: 'cap', cap: allowance, used: allowance });
    if (refused.ok) throw new Error('expected a refusal');
    expect(refused.callCeiling).toBeUndefined();
    const row = await prisma.usageLedger.findFirst({ where: { userId, action: 'ASSIST' } });
    expect(row?.count).toBe(200);
    expect(refusal('ASSIST', refused).getResponse()).toMatchObject({
      type: 'CAP_EXCEEDED',
      detail: `You have used all ${allowance} of this month's assist suggestions.`,
    });
  });

  it('refuses at the call ceiling with the allowance not yet kept, and says which', async () => {
    await prisma.usageLedger.create({
      data: { userId, period: periodFor(), action: 'ASSIST', count: ceiling, kept: 40 },
    });
    const refused = await usage.consume(userId, 'STUDENT_MONTHLY', 'ASSIST');
    expect(refused).toMatchObject({
      ok: false,
      reason: 'cap',
      cap: allowance,
      used: 40,
      callCeiling: ceiling,
    });
    if (refused.ok) throw new Error('expected a refusal');
    expect(refusal('ASSIST', refused).getResponse()).toMatchObject({
      type: 'CAP_EXCEEDED',
      used: 40,
      cap: allowance,
      callCeiling: ceiling,
      detail: `You have asked for ${ceiling} assist suggestions this month, the most one month allows. You kept 40 of your ${allowance}.`,
    });
    const row = await prisma.usageLedger.findFirst({ where: { userId, action: 'ASSIST' } });
    expect(row?.count).toBe(ceiling);
  });

  it('20 parallel calls at the allowance kept − 1 all pass; only keeping moves the allowance', async () => {
    // Keeping is the student's act after a call; the calls race only against the ceiling.
    await prisma.usageLedger.create({
      data: { userId, period: periodFor(), action: 'ASSIST', count: 300, kept: allowance - 1 },
    });
    const results = await Promise.all(
      Array.from({ length: 20 }, () => usage.consume(userId, 'STUDENT_MONTHLY', 'ASSIST')),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(20);
    const row = await prisma.usageLedger.findFirst({ where: { userId, action: 'ASSIST' } });
    expect(row).toMatchObject({ count: 320, kept: allowance - 1 });
  });

  it('an admin’s extra allowance raises both the kept allowance and the call ceiling', async () => {
    await prisma.usageLedger.create({
      data: {
        userId,
        period: periodFor(),
        action: 'ASSIST',
        count: ceiling,
        kept: allowance,
        bonus: 10,
      },
    });
    const allowed = await usage.consume(userId, 'STUDENT_MONTHLY', 'ASSIST');
    expect(allowed).toMatchObject({ ok: true, cap: allowance + 10, remaining: 10 });
  });

  it('a refund gives back a call, never a kept suggestion', async () => {
    await usage.consume(userId, 'STUDENT_MONTHLY', 'ASSIST');
    await usage.keep(userId, await suggestion());
    await usage.refund(userId, 'ASSIST');
    const row = await prisma.usageLedger.findFirst({ where: { userId, action: 'ASSIST' } });
    expect(row).toMatchObject({ count: 0, kept: 1 });
  });
});
