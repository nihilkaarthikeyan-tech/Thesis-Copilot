/**
 * Jenni build plan R22 (ADR-0109) — replies on comments.
 *
 * The student and a guide answer each other under a comment; each may change or take back only
 * their own reply; either can give a thumbs-up and take it back; the student resolves the thread.
 * Pinned on the real application with two signed-in people.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let commentId: string;
let guideCookie = '';

type View = {
  id: string;
  status: string;
  thumbs: number;
  thumbedByMe: boolean;
  replies: Array<{
    id: string;
    authorEmail: string;
    body: string;
    editedAt: string | null;
    thumbs: number;
    mine: boolean;
  }>;
};

function call(cookie: string | null, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${h.baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      origin: 'http://localhost:3000',
      ...(cookie ? { cookie } : {}),
    },
  });
}

async function signIn(email: string): Promise<string> {
  await call(null, '/auth/email-otp/send-verification-otp', {
    method: 'POST',
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
  const { otp } = (await (
    await call(null, `/auth/dev/last-otp?email=${encodeURIComponent(email)}`)
  ).json()) as { otp: string };
  const signedIn = await call(null, '/auth/sign-in/email-otp', {
    method: 'POST',
    body: JSON.stringify({ email, otp }),
  });
  return (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

const student = (path: string, init?: RequestInit) => call(h.cookie, path, init);
const guide = (path: string, init?: RequestInit) => call(guideCookie, path, init);
const base = () => `/documents/${documentId}/feedback/comments`;

beforeAll(async () => {
  h = await startHarness('replies-student@example.com');
  const document = await h.prisma.document.create({
    data: { ownerId: h.userId, title: 'Rooftop solar in Karnataka', entryPath: 'A_TOPIC' },
  });
  documentId = document.id;
  // A guide with a commenting share.
  const share = (await (
    await student(`/documents/${documentId}/feedback/shares`, {
      method: 'POST',
      body: JSON.stringify({ guideEmail: 'replies-guide@example.ac.in' }),
    })
  ).json()) as { id: string };
  // The token is in the email, not the response (guide-cycle.spec.ts reads it the same way).
  const { token } = await h.prisma.guideShare.findUniqueOrThrow({ where: { id: share.id } });
  guideCookie = await signIn('replies-guide@example.ac.in');
  expect((await guide(`/guide/accept/${token}`, { method: 'POST' })).status).toBe(200);
  const comment = (await (
    await guide(base(), {
      method: 'POST',
      body: JSON.stringify({ body: 'Where is the sample size stated?' }),
    })
  ).json()) as { id: string };
  commentId = comment.id;
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('a thread under a comment', () => {
  it('the student and the guide answer each other', async () => {
    const a = await student(`${base()}/${commentId}/replies`, {
      method: 'POST',
      body: JSON.stringify({ body: 'In section 3.2; I will move it up.' }),
    });
    expect(a.status).toBe(200);
    const b = await guide(`${base()}/${commentId}/replies`, {
      method: 'POST',
      body: JSON.stringify({ body: 'Good — and give the response rate too.' }),
    });
    const view = (await b.json()) as View;
    expect(view.replies.map((r) => [r.authorEmail, r.body, r.mine])).toEqual([
      ['replies-student@example.com', 'In section 3.2; I will move it up.', false],
      ['replies-guide@example.ac.in', 'Good — and give the response rate too.', true],
    ]);
  });

  it('each may change or take back only their own reply', async () => {
    const list = (await (await student(`${base()}?status=ALL`)).json()) as View[];
    const thread = list.find((c) => c.id === commentId) as View;
    const mine = thread.replies[0]?.id as string;
    const theirs = thread.replies[1]?.id as string;

    const edited = await student(`${base()}/${commentId}/replies/${mine}`, {
      method: 'PATCH',
      body: JSON.stringify({ body: 'In section 3.2; moved to 3.1 now.' }),
    });
    const after = (await edited.json()) as View;
    expect(after.replies[0]).toMatchObject({ body: 'In section 3.2; moved to 3.1 now.' });
    expect(after.replies[0]?.editedAt).not.toBeNull();

    expect(
      (
        await student(`${base()}/${commentId}/replies/${theirs}`, {
          method: 'PATCH',
          body: JSON.stringify({ body: 'changed' }),
        })
      ).status,
    ).toBe(403);
    expect(
      (await student(`${base()}/${commentId}/replies/${theirs}`, { method: 'DELETE' })).status,
    ).toBe(403);

    const removed = (await (
      await guide(`${base()}/${commentId}/replies/${theirs}`, { method: 'DELETE' })
    ).json()) as View;
    expect(removed.replies).toHaveLength(1);
  });

  it('a thumbs-up is given and taken back, and the student resolves the thread', async () => {
    const up = (await (
      await student(`${base()}/${commentId}/thumb`, { method: 'POST' })
    ).json()) as View;
    expect(up).toMatchObject({ thumbs: 1, thumbedByMe: true });
    const down = (await (
      await student(`${base()}/${commentId}/thumb`, { method: 'POST' })
    ).json()) as View;
    expect(down).toMatchObject({ thumbs: 0, thumbedByMe: false });

    // On a reply: the guide's thumb on the student's answer.
    const replyId = down.replies[0]?.id as string;
    const onReply = (await (
      await guide(`${base()}/${commentId}/replies/${replyId}/thumb`, { method: 'POST' })
    ).json()) as View;
    expect(onReply.replies[0]?.thumbs).toBe(1);

    const resolved = await student(`${base()}/${commentId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ outcome: 'ACCEPTED' }),
    });
    expect(resolved.status).toBe(200);
    expect(((await resolved.json()) as View).status).toBe('ACCEPTED');
  });
});
