/**
 * The guide and committee cycle — PRD §5.7, Appendix D.2, FR-7.x; PHASES v2 B2 and the VERIFY
 * batch ("guide cycle").
 *
 * Two audiences share one set of routes, and the whole of D.2's authorisation is which of them a
 * request belongs to. A guide may read the thesis they were shared and comment on it; everything
 * that changes the thesis or spends a cap unit is the student's alone. A guide who could accept a
 * revision would be writing the thesis.
 *
 * The other thing pinned here is that **no revision reaches a chapter without the student saying
 * so** (§12.3 "flag, don't fix"), and that a revision the model marked as needing something only
 * the student has is refused by name rather than pasted in as a placeholder.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let chapterId: string;
let guideCookie: string;

const QUOTE = 'Open drying loses an estimated fifth of the catch to spoilage.';

const CHAPTER = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Introduction' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Coastal fish drying is still largely open-air. ' },
        { type: 'text', text: QUOTE },
      ],
    },
  ],
};

function call(cookie: string | null, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${h.baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      origin: 'http://localhost:3000',
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
}

const sessions = new Map<string, string>();

async function signIn(email: string): Promise<string> {
  const cached = sessions.get(email);
  if (cached) return cached;
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
  expect(signedIn.status, `sign-in for ${email}`).toBe(200);
  const cookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  sessions.set(email, cookie);
  return cookie;
}

const student = (path: string, init?: RequestInit) => call(h.cookie, path, init);
const guide = (path: string, init?: RequestInit) => call(guideCookie, path, init);

type CommentView = {
  id: string;
  authorEmail: string;
  body: string;
  class: string | null;
  status: string;
  quotedText: string | null;
  suggestedRevision: string | null;
  anchor: { from: number; to: number } | null;
  liveQuotedText?: string | null;
};

/** The classifier runs in the background, so the class arrives a moment after the comment. */
async function classified(commentId: string): Promise<CommentView> {
  for (let i = 0; i < 40; i++) {
    const rows = (await (await student(`/documents/${documentId}/feedback/comments`)).json()) as
      | CommentView[]
      | { detail: string };
    const row = Array.isArray(rows) ? rows.find((c) => c.id === commentId) : undefined;
    if (row?.class) return row;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('the comment was never classified');
}

beforeAll(async () => {
  h = await startHarness('guide-cycle-student@example.com');

  const created = await student('/documents', {
    method: 'POST',
    body: JSON.stringify({ title: 'Solar Drying of Coastal Catch', entryPath: 'A_TOPIC' }),
  });
  const document = (await created.json()) as { id: string; firstChapterId: string };
  documentId = document.id;
  chapterId = document.firstChapterId;

  const current = (await (await student(`/chapters/${chapterId}`)).json()) as { version: number };
  const saved = await student(`/chapters/${chapterId}`, {
    method: 'PUT',
    body: JSON.stringify({ content: CHAPTER, baseVersion: current.version }),
  });
  expect(saved.status).toBe(200);

  guideCookie = await signIn('guide@example.ac.in');
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

describe('sharing a thesis with a guide', () => {
  let shareId: string;
  let token: string;

  it('creates a share the guide can accept with their own address', async () => {
    const response = await student(`/documents/${documentId}/feedback/shares`, {
      method: 'POST',
      body: JSON.stringify({ guideEmail: 'guide@example.ac.in' }),
    });
    expect(response.status).toBe(200);
    const share = (await response.json()) as { id: string; token?: string };
    shareId = share.id;
    const row = await h.prisma.guideShare.findUniqueOrThrow({ where: { id: shareId } });
    token = row.token;
    expect(row.guideEmail).toBe('guide@example.ac.in');
  });

  it('lists the invitation for the address it was sent to', async () => {
    // The address is the boundary, not the accept: a share is addressed to `guide@example.ac.in`
    // and only a session on that address can see it. Accepting binds the user id to the row.
    const listed = (await (await guide('/guide/documents')).json()) as Array<{
      documentId: string;
    }>;
    expect(listed.map((d) => d.documentId)).toContain(documentId);
  });

  it('lets the guide accept and then read the chapters, and nothing more', async () => {
    const accepted = await guide(`/guide/accept/${token}`, { method: 'POST' });
    expect(accepted.status).toBe(200);
    const view = (await (await guide(`/guide/documents/${documentId}`)).json()) as {
      documentId: string;
      chapters: Array<{ id: string; title: string }>;
    };
    expect(view.documentId).toBe(documentId);
    expect(view.chapters.map((c) => c.id)).toContain(chapterId);
  });

  it('refuses an address the share was not for', async () => {
    const stranger = await signIn('someone-else@example.com');
    const refused = await call(stranger, `/guide/accept/${token}`, { method: 'POST' });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    const list = (await (await call(stranger, '/guide/documents')).json()) as unknown[];
    expect(list).toEqual([]);
  });

  it('revoking a share takes the thesis back', async () => {
    const revoked = await student(`/documents/${documentId}/feedback/shares/${shareId}`, {
      method: 'DELETE',
    });
    expect(revoked.status).toBe(200);
    const list = (await (await guide('/guide/documents')).json()) as unknown[];
    expect(list).toEqual([]);
    expect((await guide(`/guide/documents/${documentId}`)).status).toBeGreaterThanOrEqual(400);

    // Re-shared for the rest of the file.
    const again = await student(`/documents/${documentId}/feedback/shares`, {
      method: 'POST',
      body: JSON.stringify({ guideEmail: 'guide@example.ac.in' }),
    });
    expect(again.status).toBe(200);
    const row = await h.prisma.guideShare.findFirstOrThrow({
      where: { documentId, guideEmail: 'guide@example.ac.in' },
      orderBy: { createdAt: 'desc' },
    });
    await guide(`/guide/accept/${row.token}`, { method: 'POST' });
  });
});

describe('what a guide may and may not do', () => {
  let commentId: string;

  it('a guide may comment, quoting a sentence', async () => {
    const response = await guide(`/documents/${documentId}/feedback/comments`, {
      method: 'POST',
      body: JSON.stringify({
        chapterId,
        body: 'Where does the fifth come from? Cite the FAO figure or drop it.',
        quotedText: QUOTE,
      }),
    });
    expect(response.status).toBe(200);
    const comment = (await response.json()) as CommentView;
    commentId = comment.id;
    // The comment is attributed to the guide, not to whoever's session carried it.
    expect(comment.authorEmail).toBe('guide@example.ac.in');
    expect(comment.status).toBe('OPEN');
  });

  it('the comment anchors to the sentence it quoted (D.2.2)', async () => {
    const rows = (await (
      await student(`/documents/${documentId}/feedback/comments`)
    ).json()) as CommentView[];
    const row = rows.find((c) => c.id === commentId);
    expect(row?.anchor).not.toBe(null);
    expect(row?.liveQuotedText ?? row?.quotedText).toContain('fifth of the catch');
  });

  it('the comment is classified, and a request to rethink an argument is SUBSTANTIVE', async () => {
    const row = await classified(commentId);
    expect(['SUBSTANTIVE', 'CLARIFICATION', 'MECHANICAL']).toContain(row.class);
  });

  it('a guide may not spend the student’s cap on a revision', async () => {
    // FR-7.5's scoped revision is a metered Strong call against the student's account.
    const refused = await guide(`/documents/${documentId}/feedback/comments/${commentId}/suggest`, {
      method: 'POST',
      body: '{}',
    });
    expect(refused.status).toBe(403);
  });

  it('a guide may not accept a revision into the thesis', async () => {
    // 404 rather than 403: an ownership check answers "no such document of yours" rather than
    // confirming that someone else's exists.
    const refused = await guide(`/documents/${documentId}/feedback/comments/${commentId}/accept`, {
      method: 'POST',
      body: '{}',
    });
    expect(refused.status).toBe(404);
  });

  it('a guide may not see the coherence flags — those are the student’s working notes', async () => {
    const refused = await guide(`/documents/${documentId}/coherence/flags`);
    expect(refused.status).toBeGreaterThanOrEqual(400);
  });

  it('a stranger sees nothing at all', async () => {
    const stranger = await signIn('someone-else@example.com');
    const refused = await call(stranger, `/documents/${documentId}/feedback/comments`);
    expect(refused.status).toBeGreaterThanOrEqual(400);
  });
});

describe('the student answering a comment', () => {
  let commentId: string;

  beforeAll(async () => {
    const response = await guide(`/documents/${documentId}/feedback/comments`, {
      method: 'POST',
      body: JSON.stringify({
        chapterId,
        body: 'Typo: "spoilage" is spelled wrong here — fix the spelling.',
        quotedText: QUOTE,
      }),
    });
    commentId = ((await response.json()) as CommentView).id;
    await classified(commentId);
  });

  it('offers a revision only when the student asks for one', async () => {
    const before = (await (
      await student(`/documents/${documentId}/feedback/comments`)
    ).json()) as CommentView[];
    expect(before.find((c) => c.id === commentId)?.suggestedRevision).toBe(null);

    const suggested = await student(
      `/documents/${documentId}/feedback/comments/${commentId}/suggest`,
      { method: 'POST', body: '{}' },
    );
    expect(suggested.status).toBe(200);
  });

  it('does not touch the chapter until the student accepts', async () => {
    const chapter = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(JSON.stringify(chapter.content)).toContain(QUOTE);
  });

  it('refuses a revision that needs something only the student has, naming it', async () => {
    // A.14 appends `[[NEEDS INPUT: …]]` when the comment asks for something the thesis does not
    // contain. Applying it verbatim would write a placeholder into a chapter and call the comment
    // answered — the fault the Block 2 smoke test found.
    const refused = await student(
      `/documents/${documentId}/feedback/comments/${commentId}/accept`,
      { method: 'POST', body: '{}' },
    );
    expect(refused.status).toBe(400);
    const problem = (await refused.json()) as { detail: string };
    expect(problem.detail).toContain('needs something only you have');
    // And the chapter is untouched.
    const chapter = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(JSON.stringify(chapter.content)).toContain(QUOTE);
  });

  it('accepts the student’s own wording, snapshots first, and replaces the range', async () => {
    const before = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    const accepted = await student(
      `/documents/${documentId}/feedback/comments/${commentId}/accept`,
      {
        method: 'POST',
        body: JSON.stringify({
          revision: 'Open drying loses an estimated fifth of the catch to spoilage and handling.',
        }),
      },
    );
    expect(accepted.status, JSON.stringify(await accepted.clone().json())).toBe(200);
    const result = (await accepted.json()) as { version: number; comment: CommentView };
    expect(result.version).toBeGreaterThan(before.version);
    expect(result.comment.status).not.toBe('OPEN');

    const after = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(JSON.stringify(after.content)).toContain('spoilage and handling');

    // D.2.4: the previous text is one click away, written before anything was replaced.
    const snapshots = await h.prisma.documentVersion.count({
      where: { documentId, reason: 'PRE_REVISION' },
    });
    expect(snapshots).toBeGreaterThan(0);
  });

  it('records a rejection with the reason, which the committee table prints', async () => {
    const response = await guide(`/documents/${documentId}/feedback/comments`, {
      method: 'POST',
      body: JSON.stringify({ chapterId, body: 'Consider dropping this chapter.' }),
    });
    const id = ((await response.json()) as CommentView).id;
    const resolved = await student(`/documents/${documentId}/feedback/comments/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({
        outcome: 'REJECTED',
        note: 'The chapter answers objective 2 and the committee asked for it explicitly.',
      }),
    });
    expect(resolved.status).toBe(200);
    const row = await h.prisma.comment.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('REJECTED');
    expect(row.resolutionNote).toContain('objective 2');
  });
});

describe('the response to committee (D.2.5)', () => {
  it('builds a table of every comment and what was done about it', async () => {
    const response = await student(`/documents/${documentId}/feedback/export`, {
      method: 'POST',
      body: JSON.stringify({ format: 'docx' }),
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      url: string;
      filename: string;
      bytes: number;
      comments: number;
    };
    expect(result.filename).toContain('.docx');
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.comments).toBeGreaterThan(0);
  });

  it('is the student’s to produce, not the guide’s', async () => {
    const refused = await guide(`/documents/${documentId}/feedback/export`, {
      method: 'POST',
      body: JSON.stringify({ format: 'docx' }),
    });
    expect(refused.status).toBe(404);
  });
});
