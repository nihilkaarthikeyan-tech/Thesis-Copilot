/**
 * ADR-0142 â€” the API's half of comment emails, on the real application: a comment and a reply
 * each queue one `comment-email` event (the worker does the rest; apps/worker/test/
 * comment-email.spec.ts), the Account switch reads and saves `emailOnComments`, and the signed
 * unsubscribe link turns it off without a session and refuses a forged one.
 */

import { unsubscribeToken } from '@tc/mail';
import { commentEventJobId } from '@tc/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QueueService } from '../src/common/queue.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
const SECRET = 'test-only-secret-0123456789abcdef0123456789';

beforeAll(async () => {
  h = await startHarness('comment-emails@example.com');
  documentId = (
    await h.prisma.document.create({
      data: { ownerId: h.userId, title: 'Rooftop solar in Karnataka', entryPath: 'A_TOPIC' },
    })
  ).id;
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

const settings = async () =>
  (await (await h.api('/settings')).json()) as { emailOnComments: boolean };

const unsubscribe = (body: unknown) =>
  fetch(`${h.baseUrl}/api/v1/email/unsubscribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });

describe('a comment or reply queues an email event', () => {
  it('one event per comment and per reply, keyed on the row', async () => {
    const queue = h.app.get(QueueService, { strict: false });
    const created = await h.api(`/documents/${documentId}/feedback/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: 'A note on my own method section.' }),
    });
    expect(created.status).toBe(200);
    const comment = (await created.json()) as { id: string };
    expect(await queue.pending('comment-email', commentEventJobId(comment.id))).toBe(true);

    const replied = await h.api(
      `/documents/${documentId}/feedback/comments/${comment.id}/replies`,
      {
        method: 'POST',
        body: JSON.stringify({ body: 'And another thought.' }),
      },
    );
    expect(replied.status).toBe(200);
    const reply = await h.prisma.commentReply.findFirstOrThrow({
      where: { commentId: comment.id },
    });
    expect(await queue.pending('comment-email', commentEventJobId(reply.id))).toBe(true);
  });
});

describe('the Account switch', () => {
  it('is on by default and saves off and on', async () => {
    expect((await settings()).emailOnComments).toBe(true);
    await h.api('/settings', { method: 'PUT', body: JSON.stringify({ emailOnComments: false }) });
    expect((await settings()).emailOnComments).toBe(false);
    await h.api('/settings', { method: 'PUT', body: JSON.stringify({ emailOnComments: true }) });
    expect((await settings()).emailOnComments).toBe(true);
  });
});

describe('the one-click unsubscribe', () => {
  it('turns the same switch off with no session, and back on for Undo', async () => {
    const token = unsubscribeToken(SECRET, h.userId);
    const off = await unsubscribe({ token });
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ emailOnComments: false });
    expect((await settings()).emailOnComments).toBe(false);

    const on = await unsubscribe({ token, on: true });
    expect(await on.json()).toEqual({ emailOnComments: true });
    expect((await settings()).emailOnComments).toBe(true);
  });

  it('keeps the other settings', async () => {
    await h.api('/settings', { method: 'PUT', body: JSON.stringify({ autoCite: false }) });
    await unsubscribe({ token: unsubscribeToken(SECRET, h.userId) });
    const row = await h.prisma.user.findUniqueOrThrow({ where: { id: h.userId } });
    expect(row.settings).toMatchObject({ autoCite: false, emailOnComments: false });
  });

  it('refuses a forged, foreign or empty token', async () => {
    const other = await h.prisma.user.create({ data: { email: 'someone-else@example.com' } });
    const forged = unsubscribeToken(SECRET, h.userId).replace(h.userId, other.id);
    for (const token of [forged, unsubscribeToken('x'.repeat(40), other.id), '', 'nonsense']) {
      expect((await unsubscribe({ token })).status).toBe(400);
    }
    const untouched = await h.prisma.user.findUniqueOrThrow({ where: { id: other.id } });
    expect(untouched.settings).toBeNull();
  });
});
