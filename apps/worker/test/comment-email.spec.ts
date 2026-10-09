/**
 * ADR-0142 — comments and replies send an email.
 *
 * Real Postgres in Testcontainers with every migration applied: the throttle's guarantee is one
 * conditional UPDATE on `CommentEmailState`, and a fake database would prove nothing about it.
 * The mailer records, the queue is a list, and the clock is a variable.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@tc/db';
import { ConsoleMailer, type Mail, verifyUnsubscribeToken } from '@tc/mail';
import { type CommentEmailJob, commentSendJobId } from '@tc/types';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  COMMENT_EMAIL,
  type CommentEmailDeps,
  commentEmail,
  commentLink,
  commentRecipients,
  excerpt,
  fanOutCommentEvent,
  sendCommentEmail,
} from '../src/comment-email.js';

const MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../packages/db/prisma/migrations/', import.meta.url),
);
const MIGRATIONS = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const APP = 'https://app.example.edu';
const SECRET = 'test-only-secret-0123456789abcdef0123456789';
const HOUR = COMMENT_EMAIL.throttleMs;

type Send = Extract<CommentEmailJob, { kind: 'send' }>;
type Queued = { payload: Send; jobId: string; delayMs: number };

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let mailer: ConsoleMailer;
let queued: Queued[];
let clock: number;
let deps: CommentEmailDeps;

let documentId: string;
let chapterId: string;
const ids = {} as Record<
  'owner' | 'guide' | 'coauthor' | 'reader' | 'suspended' | 'leaving',
  string
>;
const tokens = {} as Record<'guide' | 'coauthor', string>;

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('tc_test')
    .withUsername('tc')
    .withPassword('tc')
    .withCopyFilesToContainer(
      MIGRATIONS.map((name) => ({
        source: join(MIGRATIONS_DIR, name, 'migration.sql'),
        target: `/tmp/migrations/${name}.sql`,
      })),
    )
    .start();
  for (const name of MIGRATIONS) {
    const applied = await container.exec([
      'psql',
      '-U',
      'tc',
      '-d',
      'tc_test',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      `/tmp/migrations/${name}.sql`,
    ]);
    if (applied.exitCode !== 0) throw new Error(`migration ${name} failed:\n${applied.output}`);
  }
  prisma = new PrismaClient({ datasources: { db: { url: container.getConnectionUri() } } });
  await prisma.$connect();
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

beforeEach(async () => {
  await prisma.commentEmailState.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.guideShare.deleteMany();
  await prisma.chapter.deleteMany();
  await prisma.document.deleteMany();
  await prisma.user.deleteMany();

  const user = (email: string, data: Record<string, unknown> = {}) =>
    prisma.user.create({ data: { email, ...data } }).then((u) => u.id);
  ids.owner = await user('student@example.edu', { name: 'Asha Rao' });
  ids.guide = await user('guide@example.ac.in', { name: 'Dr. Menon' });
  ids.coauthor = await user('coauthor@example.edu', {
    settings: { interfaceLanguage: 'hi' },
  });
  ids.reader = await user('reader@example.edu');
  ids.suspended = await user('suspended@example.ac.in', { suspendedAt: new Date() });
  ids.leaving = await user('leaving@example.ac.in', { deletionRequestedAt: new Date() });

  const document = await prisma.document.create({
    data: { ownerId: ids.owner, title: 'Rooftop solar in Karnataka', entryPath: 'A_TOPIC' },
  });
  documentId = document.id;
  chapterId = (
    await prisma.chapter.create({
      data: {
        documentId,
        outlineNodeId: 'n1',
        title: 'Introduction',
        order: 1,
        content: { type: 'doc' },
      },
    })
  ).id;

  const share = (email: string, token: string, flags: Record<string, unknown>, userId?: string) =>
    prisma.guideShare.create({
      data: {
        documentId,
        guideEmail: email,
        token,
        ...(userId ? { guideUserId: userId } : {}),
        ...flags,
      },
    });
  tokens.guide = 'guide-token-1';
  tokens.coauthor = 'coauthor-token-1';
  // The guide's share is bound by address only (never accepted through the link): still theirs.
  await share('guide@example.ac.in', tokens.guide, {});
  await share('coauthor@example.edu', tokens.coauthor, { canEdit: true }, ids.coauthor);
  await share('reader@example.edu', 'reader-token', { canComment: false }, ids.reader);
  await share('suspended@example.ac.in', 'suspended-token', {}, ids.suspended);
  await share('leaving@example.ac.in', 'leaving-token', {}, ids.leaving);
  // Invited, never signed up: no account, so no switch and no email.
  await share('nobody@example.ac.in', 'nobody-token', {});

  mailer = new ConsoleMailer(() => undefined);
  queued = [];
  clock = Date.parse('2026-10-09T10:00:00Z');
  deps = {
    prisma,
    mailer,
    appUrl: APP,
    secret: SECRET,
    now: () => clock,
    enqueue: async (payload, options) => {
      // BullMQ's rule: an id it already holds (waiting or delayed) is not added again.
      if (queued.some((q) => q.jobId === options.jobId)) return;
      queued.push({ payload, ...options });
    },
  };
});

const comment = (authorEmail: string, body: string) =>
  prisma.comment.create({ data: { documentId, chapterId, authorEmail, body } });
const reply = (commentId: string, authorEmail: string, body: string) =>
  prisma.commentReply.create({ data: { commentId, authorEmail, body } });
const event = (commentId: string, eventId: string) =>
  fanOutCommentEvent(deps, { kind: 'event', documentId, commentId, eventId });
/** Runs the queued sends (oldest first) and empties the queue, as the worker would. */
async function drain(): Promise<string[]> {
  const outcomes: string[] = [];
  const jobs = queued.splice(0);
  for (const job of jobs) outcomes.push((await sendCommentEmail(deps, job.payload)).outcome);
  return outcomes;
}
const mailTo = (email: string): Mail[] => mailer.sent.filter((m) => m.to.includes(email));

describe('who is emailed', () => {
  it('the owner, guides and co-authors with an active account — not readers, not the suspended or leaving, not the uninvited', async () => {
    const people = await commentRecipients(prisma, documentId);
    expect(people.map((p) => p.userId).sort()).toEqual([ids.owner, ids.guide, ids.coauthor].sort());
    expect(people.find((p) => p.userId === ids.owner)?.shareToken).toBeNull();
    expect(people.find((p) => p.userId === ids.guide)?.shareToken).toBe(tokens.guide);
  });

  it('never the author of the comment', async () => {
    const c = await comment('guide@example.ac.in', 'Where is the sample size stated?');
    expect(await event(c.id, c.id)).toEqual({ queued: 2 });
    expect(queued.map((q) => q.payload.userId).sort()).toEqual([ids.owner, ids.coauthor].sort());
    for (const q of queued) {
      expect(q.jobId).toBe(commentSendJobId(c.id, q.payload.userId, 0));
      expect(q.jobId).not.toContain(':');
      expect(q.delayMs).toBe(COMMENT_EMAIL.graceMs);
    }
  });
});

describe('the email', () => {
  it('names the thesis and the commenter, quotes the start of the comment, links to it, and can be undone in one click', async () => {
    const long = `${'The sample size is not stated anywhere in this chapter. '.repeat(10)}END`;
    const c = await prisma.comment.create({
      data: {
        documentId,
        chapterId,
        authorEmail: 'guide@example.ac.in',
        body: long,
        quotedText: 'A PASSAGE OF THE THESIS THAT MUST NOT BE MAILED',
      },
    });
    await event(c.id, c.id);
    expect(await drain()).toEqual(['sent', 'sent']);

    const [toOwner] = mailTo('student@example.edu');
    expect(toOwner?.subject).toBe('Dr. Menon commented on "Rooftop solar in Karnataka"');
    expect(toOwner?.text).toContain(`${APP}/app/d/${documentId}/review?comment=${c.id}`);
    expect(toOwner?.text).not.toContain('END');
    expect(toOwner?.text).not.toContain('MUST NOT BE MAILED');
    const quoted = /"(The sample size[^"]*)"/.exec(toOwner?.text ?? '')?.[1] ?? '';
    expect(quoted.length).toBeLessThanOrEqual(COMMENT_EMAIL.excerptChars + 1);
    const token = decodeURIComponent(
      /unsubscribe\?token=(\S+)/.exec(toOwner?.text ?? '')?.[1] ?? '',
    );
    expect(verifyUnsubscribeToken(SECRET, token)).toBe(ids.owner);

    // The co-author's interface is Hindi, and their link is their share's page at the comment.
    const [toCoauthor] = mailTo('coauthor@example.edu');
    expect(toCoauthor?.subject).toContain('ने "Rooftop solar in Karnataka" पर टिप्पणी की');
    expect(toCoauthor?.text).toContain(
      `${APP}/guide/${tokens.coauthor}?comment=${c.id}&chapter=${chapterId}`,
    );
  });
});

describe('at most one email per thread per person an hour', () => {
  it('folds the hour’s later replies into the next email', async () => {
    const c = await comment('guide@example.ac.in', 'Where is the sample size stated?');
    await event(c.id, c.id);
    await drain();
    expect(mailTo('student@example.edu')).toHaveLength(1);

    clock += 5 * 60_000;
    const r1 = await reply(c.id, 'guide@example.ac.in', 'And the response rate, please.');
    await event(c.id, r1.id);
    clock += 5 * 60_000;
    const r2 = await reply(c.id, 'guide@example.ac.in', 'Also cite the census table.');
    await event(c.id, r2.id);

    // Both replies landed on one delayed job per person, waiting for the hour to open.
    const forOwner = queued.filter((q) => q.payload.userId === ids.owner);
    expect(forOwner).toHaveLength(1);
    expect(forOwner[0]?.delayMs).toBe(HOUR - 5 * 60_000);

    clock += HOUR;
    await drain();
    const mails = mailTo('student@example.edu');
    expect(mails).toHaveLength(2);
    expect(mails[1]?.subject).toBe(
      'Dr. Menon replied to a comment on "Rooftop solar in Karnataka"',
    );
    expect(mails[1]?.text).toContain('And the response rate, please.');
    expect(mails[1]?.text).toContain('And 1 more reply since.');
    expect(mails[1]?.text).not.toContain('Where is the sample size stated?');
  });

  it('a send that runs before the hour is up sends nothing and queues itself for the slot', async () => {
    const c = await comment('guide@example.ac.in', 'First.');
    await event(c.id, c.id);
    await drain();
    clock += 60_000;
    await reply(c.id, 'guide@example.ac.in', 'Second.');
    const early = await sendCommentEmail(deps, {
      kind: 'send',
      commentId: c.id,
      userId: ids.owner,
      slot: 0,
    });
    expect(early.outcome).toBe('throttled');
    const next = queued.find((q) => q.payload.userId === ids.owner);
    expect(next?.payload.slot).toBe(Date.parse('2026-10-09T10:00:00Z') + HOUR);
    expect(mailTo('student@example.edu')).toHaveLength(1);
  });

  it('two sends racing for the same events send one email', async () => {
    const c = await comment('guide@example.ac.in', 'Once only.');
    const job = { kind: 'send' as const, commentId: c.id, userId: ids.owner, slot: 0 };
    await event(c.id, c.id);
    const outcomes = await Promise.all([sendCommentEmail(deps, job), sendCommentEmail(deps, job)]);
    expect(outcomes.filter((o) => o.outcome === 'sent')).toHaveLength(1);
    expect(mailTo('student@example.edu')).toHaveLength(1);
  });

  it('a mail fault puts the claim back, so the retry sends the same email', async () => {
    const c = await comment('guide@example.ac.in', 'Try again.');
    await event(c.id, c.id);
    const job = queued.find((q) => q.payload.userId === ids.owner)?.payload as Send;
    let fail = true;
    const flaky: CommentEmailDeps = {
      ...deps,
      mailer: {
        send: async (mail) => {
          if (fail) throw new Error('smtp down');
          await mailer.send(mail);
        },
      },
    };
    await expect(sendCommentEmail(flaky, job)).rejects.toThrow('smtp down');
    fail = false;
    expect((await sendCommentEmail(flaky, job)).outcome).toBe('sent');
    expect(mailTo('student@example.edu')[0]?.text).toContain('Try again.');
  });

  it('the person’s own reply is not mailed back to them', async () => {
    const c = await comment('guide@example.ac.in', 'Is this table yours?');
    await event(c.id, c.id);
    await drain();
    clock += 2 * HOUR;
    const mine = await reply(c.id, 'student@example.edu', 'Yes, from my survey.');
    await event(c.id, mine.id);
    expect(queued.map((q) => q.payload.userId).sort()).toEqual([ids.guide, ids.coauthor].sort());
    await drain();
    expect(mailTo('student@example.edu')).toHaveLength(1);
    const [toGuide] = mailTo('guide@example.ac.in');
    expect(toGuide?.subject).toBe('Asha Rao replied to a comment on "Rooftop solar in Karnataka"');
    expect(toGuide?.text).toContain(`/guide/${tokens.guide}?comment=${c.id}&chapter=${chapterId}`);
  });
});

describe('who is not emailed after all', () => {
  it('someone who turned it off: nothing now, and no backlog when they turn it back on', async () => {
    await prisma.user.update({
      where: { id: ids.owner },
      data: { settings: { emailOnComments: false } },
    });
    const c = await comment('guide@example.ac.in', 'Opted out of this one.');
    await event(c.id, c.id);
    expect(await drain()).toContain('opted-out');
    expect(mailTo('student@example.edu')).toHaveLength(0);

    await prisma.user.update({ where: { id: ids.owner }, data: { settings: {} } });
    clock += 60_000;
    const r = await reply(c.id, 'guide@example.ac.in', 'This one is mailed.');
    await event(c.id, r.id);
    await drain();
    const [mail] = mailTo('student@example.edu');
    expect(mail?.text).toContain('This one is mailed.');
    expect(mail?.text).not.toContain('Opted out of this one.');
  });

  it('an account suspended or set for deletion after the job was queued', async () => {
    const c = await comment('guide@example.ac.in', 'Queued, then suspended.');
    await event(c.id, c.id);
    await prisma.user.update({ where: { id: ids.owner }, data: { suspendedAt: new Date() } });
    await prisma.user.update({
      where: { id: ids.coauthor },
      data: { deletionRequestedAt: new Date() },
    });
    expect(await drain()).toEqual(['no-recipient', 'no-recipient']);
    expect(mailer.sent).toHaveLength(0);
  });

  it('a share turned into a Reader after the job was queued', async () => {
    const c = await comment('student@example.edu', 'A note for my guide.');
    await event(c.id, c.id);
    await prisma.guideShare.updateMany({
      where: { token: tokens.guide },
      data: { canComment: false },
    });
    const outcomes = await drain();
    expect(outcomes).toContain('no-access');
    expect(mailTo('guide@example.ac.in')).toHaveLength(0);
    expect(mailTo('coauthor@example.edu')).toHaveLength(1);
  });

  it('a reply taken back before the event ran queues nothing', async () => {
    const c = await comment('guide@example.ac.in', 'Root.');
    const r = await reply(c.id, 'guide@example.ac.in', 'Oops.');
    await prisma.commentReply.delete({ where: { id: r.id } });
    expect(await event(c.id, r.id)).toEqual({ queued: 0 });
  });
});

describe('pieces', () => {
  it('excerpt collapses whitespace and cuts at a word', () => {
    expect(excerpt('  a \n b  ')).toBe('a b');
    const cut = excerpt('word '.repeat(100));
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(COMMENT_EMAIL.excerptChars + 1);
  });

  it('links a comment with no chapter to the share page without one', () => {
    expect(
      commentLink(`${APP}/`, { documentId: 'd', commentId: 'c', chapterId: null, shareToken: 't' }),
    ).toBe(`${APP}/guide/t?comment=c`);
  });

  it('counts several folded replies in the plural', () => {
    const mail = commentEmail({
      language: 'en',
      thesisTitle: 'T',
      authorName: 'N',
      kind: 'reply',
      body: 'b',
      more: 2,
      link: 'L',
      appUrl: APP,
      unsubscribeToken: 'x.y',
    });
    expect(mail.text).toContain('And 2 more replies since.');
  });
});
