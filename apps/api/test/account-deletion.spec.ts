/**
 * Account deletion — PRD §12.2: "hard-delete documents, sources, chunks, files within 30 days;
 * keep billing records as required by law."
 *
 * Run against the real application on real Postgres and MinIO, because the thing worth proving is
 * not that the service calls `deleteMany` — it is that after the sweep there is nothing left of
 * the student's work in any table, and that the two things §12.2 says to keep are still there. A
 * mocked Prisma would let a forgotten table pass silently, and a forgotten table is the whole risk
 * in a feature like this.
 *
 * The last test is the one that matters most: it walks the schema rather than a list, so a table
 * added next year fails this instead of quietly retaining a deleted student's text.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DeletionScheduler } from '../src/modules/account/deletion.scheduler.js';
import {
  DELETION_GRACE_DAYS,
  DeletionService,
  erasesAt,
  tombstoneEmail,
} from '../src/modules/account/deletion.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let deletion: DeletionService;
let scheduler: DeletionScheduler;

const EMAIL = 'deletion@example.edu';
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60_000);

/** A document with something in every table the erasure has to reach. */
async function seedWork(): Promise<string> {
  const document = await h.prisma.document.create({
    data: { ownerId: h.userId, title: 'Barriers to adoption', entryPath: 'A_TOPIC' },
  });
  const chapter = await h.prisma.chapter.create({
    data: {
      documentId: document.id,
      outlineNodeId: 'n1',
      title: 'Introduction',
      order: 1,
      content: {},
    },
  });
  const source = await h.prisma.source.create({
    data: {
      documentId: document.id,
      title: 'Kumar 2021',
      fileKey: `sources/${document.id}/p1.pdf`,
    },
  });

  await h.prisma.documentMemory.create({
    data: { documentId: document.id, scope: {}, outline: [], glossary: {} },
  });
  await h.prisma.seedPaper.create({
    data: {
      documentId: document.id,
      filename: 'kumar.pdf',
      fileKey: `seeds/${document.id}/kumar.pdf`,
    },
  });
  await h.prisma.chapterSourcePin.create({
    data: { chapterId: chapter.id, sourceId: source.id },
  });
  await h.prisma.citation.create({
    data: { chapterId: chapter.id, sourceId: source.id, nodeKey: 'S1#c1' },
  });
  await h.prisma.coherenceFlag.create({
    data: {
      documentId: document.id,
      chapterId: chapter.id,
      from: 0,
      to: 10,
      runId: randomUUID(),
      type: 'TERM_DRIFT',
      severity: 'WARN',
      description: 'drifted',
      fingerprint: 'f1',
    },
  });
  await h.prisma.comment.create({
    data: {
      documentId: document.id,
      chapterId: chapter.id,
      authorEmail: 'guide@example.edu',
      body: 'tighten this',
    },
  });
  await h.prisma.guideShare.create({
    data: {
      documentId: document.id,
      token: `t-${document.id}`,
      guideEmail: 'guide@example.edu',
    },
  });
  await h.prisma.documentVersion.create({
    data: {
      documentId: document.id,
      chapterId: chapter.id,
      snapshotKey: `versions/${document.id}/v1.json.gz`,
      reason: 'AUTOSAVE',
    },
  });
  await h.prisma.suggestionEvent.create({
    data: {
      userId: h.userId,
      documentId: document.id,
      chapterId: chapter.id,
      action: 'ASSIST',
      shownChars: 40,
      outcome: 'SHOWN',
      latencyMs: 100,
    },
  });
  await h.prisma.aiCallLog.create({
    data: {
      userId: h.userId,
      documentId: document.id,
      action: 'ASSIST',
      model: 'gpt-5-nano',
      inputTokens: 10,
      outputTokens: 10,
      costMicroInr: BigInt(1),
      latencyMs: 5,
    },
  });
  await h.prisma.usageLedger.create({
    data: { userId: h.userId, action: 'ASSIST', period: '2026-09', count: 1 },
  });
  await h.prisma.savedPrompt.create({
    data: {
      userId: h.userId,
      title: 'Limitations',
      body: 'What limitations do the authors admit?',
    },
  });

  return document.id;
}

/**
 * The harness's own session row, kept so it can be put back.
 *
 * `request` signs every device out, which is the correct behaviour and also destroys the cookie
 * the harness authenticates with — so without this the first service-level test would 401 every
 * HTTP test after it. Restoring the row is closer to the truth than working around the sign-out.
 */
let session: { id: string; token: string; userId: string; expiresAt: Date } | null = null;

beforeAll(async () => {
  h = await startHarness(EMAIL);
  deletion = h.app.get(DeletionService);
  scheduler = h.app.get(DeletionScheduler);
  session = await h.prisma.session.findFirst({
    where: { userId: h.userId },
    select: { id: true, token: true, userId: true, expiresAt: true },
  });
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(async () => {
  await h.prisma.user.update({
    where: { id: h.userId },
    data: { deletionRequestedAt: null, deletedAt: null, email: EMAIL },
  });
  if (session) {
    await h.prisma.session.createMany({ data: [session], skipDuplicates: true });
  }
});

describe('asking', () => {
  it('records the request and dates the erasure', async () => {
    const status = await deletion.request(h.userId);

    expect(status.requestedAt).toBeInstanceOf(Date);
    expect(status.graceDays).toBe(DELETION_GRACE_DAYS);
    expect(status.erasesAt?.getTime()).toBe(erasesAt(status.requestedAt as Date).getTime());
  });

  it('signs every device out', async () => {
    // If the request was not the student's, the session that made it is the one that must not
    // survive it — an OTP account is only as safe as the mailbox, and the mailbox may be borrowed.
    await h.prisma.session.create({
      data: {
        userId: h.userId,
        token: 'sess-1',
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await deletion.request(h.userId);

    expect(await h.prisma.session.count({ where: { userId: h.userId } })).toBe(0);
  });

  it('is idempotent, and does not let the date be pushed back', async () => {
    const first = await deletion.request(h.userId, daysAgo(3));
    const second = await deletion.request(h.userId, new Date());

    expect(second.requestedAt?.getTime()).toBe(first.requestedAt?.getTime());
  });

  it('can be taken back before the sweep', async () => {
    await deletion.request(h.userId);
    const status = await deletion.cancel(h.userId);

    expect(status.requestedAt).toBeNull();
    expect(await deletion.due(new Date())).not.toContain(h.userId);
  });
});

describe('the grace period', () => {
  it('holds the account back until it is up', async () => {
    await deletion.request(h.userId, daysAgo(DELETION_GRACE_DAYS - 1));

    expect(await deletion.due(new Date())).not.toContain(h.userId);
  });

  it('releases it once it is', async () => {
    await deletion.request(h.userId, daysAgo(DELETION_GRACE_DAYS + 1));

    expect(await deletion.due(new Date())).toContain(h.userId);
  });

  it('ends well inside §12.2’s thirty days, with room for the backups to age out', async () => {
    // The privacy page promises backups are kept 30 days. Erasing on day 7 puts the last copy out
    // of the backups around day 37; erasing on day 30 would put it at day 60.
    expect(DELETION_GRACE_DAYS).toBeLessThanOrEqual(14);
  });
});

describe('erasing', () => {
  it('destroys the work and keeps what the law needs', async () => {
    const documentId = await seedWork();
    await h.prisma.subscription.create({
      data: {
        userId: h.userId,
        plan: 'STUDENT_MONTHLY',
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60_000),
      },
    });

    await deletion.request(h.userId, daysAgo(DELETION_GRACE_DAYS + 1));
    await scheduler.sweep();

    // Gone.
    expect(await h.prisma.document.count({ where: { id: documentId } })).toBe(0);
    expect(await h.prisma.chapter.count({ where: { documentId } })).toBe(0);
    expect(await h.prisma.source.count({ where: { documentId } })).toBe(0);
    expect(await h.prisma.seedPaper.count({ where: { documentId } })).toBe(0);
    expect(await h.prisma.documentMemory.count({ where: { documentId } })).toBe(0);
    expect(await h.prisma.coherenceFlag.count({ where: { documentId } })).toBe(0);
    expect(await h.prisma.comment.count({ where: { documentId } })).toBe(0);
    expect(await h.prisma.guideShare.count({ where: { documentId } })).toBe(0);
    expect(await h.prisma.documentVersion.count({ where: { documentId } })).toBe(0);
    expect(await h.prisma.aiCallLog.count({ where: { userId: h.userId } })).toBe(0);
    expect(await h.prisma.usageLedger.count({ where: { userId: h.userId } })).toBe(0);
    expect(await h.prisma.savedPrompt.count({ where: { userId: h.userId } })).toBe(0);

    // Kept — §12.2's "billing records as required by law", and the proof it was asked for.
    expect(await h.prisma.subscription.count({ where: { userId: h.userId } })).toBe(1);
    const kinds = (
      await h.prisma.auditEvent.findMany({
        where: { userId: h.userId },
        select: { kind: true },
      })
    ).map((e) => e.kind);
    expect(kinds).toContain('DELETION_REQUESTED');
    expect(kinds).toContain('DELETION_COMPLETED');
  });

  it('leaves a row the billing records can still point at, with nobody in it', async () => {
    await deletion.request(h.userId, daysAgo(DELETION_GRACE_DAYS + 1));
    await scheduler.sweep();

    const user = await h.prisma.user.findUnique({ where: { id: h.userId } });
    expect(user).not.toBeNull();
    expect(user?.email).toBe(tombstoneEmail(h.userId));
    expect(user?.name).toBeNull();
    expect(user?.deletedAt).toBeInstanceOf(Date);
    expect(user?.deletionRequestedAt).toBeNull();
  });

  it('frees the address, so the same person can start again', async () => {
    await deletion.request(h.userId, daysAgo(DELETION_GRACE_DAYS + 1));
    await scheduler.sweep();

    const reused = await h.prisma.user.create({ data: { email: EMAIL } });
    expect(reused.id).not.toBe(h.userId);
    await h.prisma.user.delete({ where: { id: reused.id } });
  });

  it('does nothing the second time', async () => {
    const documentId = await seedWork();
    await deletion.request(h.userId, daysAgo(DELETION_GRACE_DAYS + 1));

    await scheduler.sweep();
    const again = await deletion.erase(h.userId);

    expect(again.files).toBe(0);
    expect(await h.prisma.document.count({ where: { id: documentId } })).toBe(0);
  });

  it('does not touch anybody else', async () => {
    const other = await h.prisma.user.create({ data: { email: 'other@example.edu' } });
    const theirs = await h.prisma.document.create({
      data: { ownerId: other.id, title: 'Someone else’s thesis', entryPath: 'A_TOPIC' },
    });
    await seedWork();

    await deletion.request(h.userId, daysAgo(DELETION_GRACE_DAYS + 1));
    await scheduler.sweep();

    expect(await h.prisma.document.count({ where: { id: theirs.id } })).toBe(1);
    await h.prisma.document.delete({ where: { id: theirs.id } });
    await h.prisma.user.delete({ where: { id: other.id } });
  });
});

describe('the HTTP surface', () => {
  it('refuses without the address typed back', async () => {
    const res = await h.api('/account', {
      method: 'DELETE',
      body: JSON.stringify({ confirmEmail: 'someone.else@example.edu' }),
    });

    expect(res.status).toBe(400);
    expect(
      await h.prisma.user.count({ where: { id: h.userId, deletionRequestedAt: { not: null } } }),
    ).toBe(0);
  });

  it('accepts it with the address, and reports the pending request afterwards', async () => {
    const res = await h.api('/account', {
      method: 'DELETE',
      body: JSON.stringify({ confirmEmail: EMAIL.toUpperCase() }),
    });
    expect(res.status).toBe(200);

    // The request signed us out, so the status read needs a fresh session; check the row instead.
    const user = await h.prisma.user.findUnique({ where: { id: h.userId } });
    expect(user?.deletionRequestedAt).toBeInstanceOf(Date);
  });

  it('needs a session', async () => {
    const res = await h.api('/account', {
      method: 'DELETE',
      headers: { cookie: '', 'content-type': 'application/json' },
      body: JSON.stringify({ confirmEmail: EMAIL }),
    });

    expect(res.status).toBe(401);
  });
});

describe('nothing of the student is left behind', () => {
  it('holds no row keyed to the erased user in any table that stores their work', async () => {
    // Walked rather than listed. A table added later that hangs off `userId` or `documentId` and
    // is not handled in `erase` fails here, which is the only way this feature stays correct
    // without somebody remembering to come back to it.
    const documentId = await seedWork();
    await deletion.request(h.userId, daysAgo(DELETION_GRACE_DAYS + 1));
    await scheduler.sweep();

    const rows = await h.prisma.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name IN ('userId', 'ownerId', 'documentId')`,
    );

    // §12.2 keeps these two, and `User` is the tombstone itself.
    const kept = new Set(['Subscription', 'AuditEvent', 'User']);

    for (const { table_name, column_name } of rows) {
      if (kept.has(table_name)) continue;
      const value = column_name === 'documentId' ? documentId : h.userId;
      const rowsLeft = await h.prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT COUNT(*)::bigint AS count FROM "${table_name}" WHERE "${column_name}" = $1::uuid`,
        value,
      );
      expect(Number(rowsLeft[0]?.count ?? 0), `${table_name}.${column_name} still has rows`).toBe(
        0,
      );
    }
  });
});
