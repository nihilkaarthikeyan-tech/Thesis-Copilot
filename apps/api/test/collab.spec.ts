/**
 * Live co-authoring rooms — ADR-0028, through a real WebSocket.
 *
 * Two clients on one chapter: what one types the other sees, and the chapter in the database
 * follows within a second or two, through the same save every autosave takes. Around that, who
 * may join — the owner, a share with `canEdit`, nobody else — and what happens when the chapter
 * moves underneath the room: it closes and says so, rather than merging two histories.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { CLOSE } from '../src/modules/collab/collab.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let chapterId: string;
let cookieB: string;
let cookieC: string;
const EMAIL_B = 'coauthor-b@example.com';
const EMAIL_C = 'stranger-c@example.com';

/** Signs another address in through the real OTP flow. */
async function signIn(email: string): Promise<string> {
  const spy = vi.spyOn(console, 'log');
  const sent = await h.api('/auth/email-otp/send-verification-otp', {
    method: 'POST',
    headers: { cookie: '' },
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
  expect(sent.status).toBe(200);
  const line = spy.mock.calls
    .map((call) => call.join(' '))
    .find((text) => text.includes(`one-time code for ${email}`));
  spy.mockRestore();
  const otp = /:\s*(\d{6})/.exec(line ?? '')?.[1];
  const signedIn = await h.api('/auth/sign-in/email-otp', {
    method: 'POST',
    headers: { cookie: '' },
    body: JSON.stringify({ email, otp }),
  });
  expect(signedIn.status).toBe(200);
  return (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

const wsUrl = () => h.baseUrl.replace(/^http/, 'ws');

/** y-websocket builds `new WebSocket(url, protocols)`; the cookie has to ride on a subclass. */
function socketWith(cookie: string) {
  return class extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols, { headers: { cookie } });
    }
  } as unknown as typeof globalThis.WebSocket;
}

function join(cookie: string, chapter = chapterId) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`${wsUrl()}/collab`, chapter, doc, {
    WebSocketPolyfill: socketWith(cookie),
    disableBc: true,
  });
  const closes: number[] = [];
  provider.on('connection-close', (event: { code: number } | null) => {
    if (event) closes.push(event.code);
  });
  return { doc, provider, closes };
}

const textOf = (doc: Y.Doc) => doc.getXmlFragment('default').toString();

async function until(check: () => boolean, ms = 8_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** A closed handshake's code, for the refusals. */
function closeCodeOf(cookie: string | null, chapter = chapterId): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsUrl()}/collab/${chapter}`, {
      headers: cookie ? { cookie } : {},
    });
    ws.on('close', (code) => resolve(code));
    ws.on('error', reject);
  });
}

beforeAll(async () => {
  h = await startHarness('owner-collab@example.com');
  await h.prisma.featureFlag.upsert({
    where: { key: 'collaboration' },
    create: { key: 'collaboration', enabled: true },
    update: { enabled: true },
  });
  const created = await h.api('/documents', {
    method: 'POST',
    body: JSON.stringify({ title: 'Live', entryPath: 'A_TOPIC' }),
  });
  const document = (await created.json()) as { id: string; firstChapterId: string };
  documentId = document.id;
  chapterId = document.firstChapterId;
  cookieB = await signIn(EMAIL_B);
  cookieC = await signIn(EMAIL_C);
  await h.prisma.guideShare.create({
    data: { documentId, guideEmail: EMAIL_B, token: 'tok-b', canEdit: true },
  });
  // A comment-only guide, as every share was before ADR-0028.
  await h.prisma.guideShare.create({
    data: { documentId, guideEmail: EMAIL_C, token: 'tok-c', canEdit: false },
  });
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('two people in one chapter', () => {
  it('see each other’s words, and the chapter in the database follows', async () => {
    const a = join(h.cookie);
    const b = join(cookieB);
    await until(() => a.provider.synced && b.provider.synced);
    // The room loaded the chapter's own text first.
    const before = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });

    a.doc.transact(() => {
      const paragraph = new Y.XmlElement('paragraph');
      paragraph.insert(0, [new Y.XmlText('Typed by the owner. ')]);
      a.doc.getXmlFragment('default').insert(0, [paragraph]);
    });
    await until(() => textOf(b.doc).includes('Typed by the owner.'));

    b.doc.transact(() => {
      const paragraph = new Y.XmlElement('paragraph');
      paragraph.insert(0, [new Y.XmlText('And by the co-author.')]);
      b.doc.getXmlFragment('default').insert(1, [paragraph]);
    });
    await until(() => textOf(a.doc).includes('And by the co-author.'));

    // Stored through the ordinary save: content, version, word count.
    await until(() => false, 1_800).catch(() => undefined);
    const after = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    const json = JSON.stringify(after.content);
    expect(json).toContain('Typed by the owner.');
    expect(json).toContain('And by the co-author.');
    expect(after.version).toBeGreaterThan(before.version);
    expect(after.wordCount).toBeGreaterThanOrEqual(8);

    a.provider.destroy();
    b.provider.destroy();
    expect(a.closes).toEqual([]);
    expect(b.closes).toEqual([]);
  }, 30_000);

  it('closes the room when the chapter changes elsewhere, and says so', async () => {
    const a = join(h.cookie);
    await until(() => a.provider.synced);
    // A restore, a revision accept — anything that writes the chapter behind the room's back.
    const row = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    const moved = await h.api(`/chapters/${chapterId}`, {
      method: 'PUT',
      body: JSON.stringify({
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        baseVersion: row.version,
      }),
    });
    expect(moved.status).toBe(200);

    a.doc.transact(() => {
      const paragraph = new Y.XmlElement('paragraph');
      paragraph.insert(0, [new Y.XmlText('Lost?')]);
      a.doc.getXmlFragment('default').insert(0, [paragraph]);
    });
    await until(() => a.closes.includes(CLOSE.changedElsewhere), 10_000);
    a.provider.destroy();
    // The other writer's text stands; the room did not overwrite it.
    const final = await h.prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(JSON.stringify(final.content)).not.toContain('Lost?');
  }, 30_000);
});

describe('who may join', () => {
  it('refuses a socket with no session', async () => {
    expect(await closeCodeOf(null)).toBe(CLOSE.unauthenticated);
  });

  it('refuses a comment-only guide, and anyone with no share at all', async () => {
    expect(await closeCodeOf(cookieC)).toBe(CLOSE.forbidden);
    const other = await h.api('/documents', {
      method: 'POST',
      headers: { cookie: cookieC },
      body: JSON.stringify({ title: 'Theirs', entryPath: 'A_TOPIC' }),
    });
    const theirs = (await other.json()) as { firstChapterId: string };
    expect(await closeCodeOf(cookieB, theirs.firstChapterId)).toBe(CLOSE.forbidden);
  });

  it('answers a chapter that does not exist as forbidden, not as missing', async () => {
    expect(await closeCodeOf(h.cookie, '00000000-0000-7000-8000-000000000000')).toBe(
      CLOSE.forbidden,
    );
  });

  it('refuses a path that is not a chapter room before the handshake', async () => {
    const response = await fetch(`${h.baseUrl}/collab/not-a-chapter`, {
      headers: { connection: 'upgrade', upgrade: 'websocket' },
    }).catch(() => null);
    // Either the socket is refused outright or the server answers 404; never a room.
    expect(response === null || response.status === 404).toBe(true);
  });

  it('refuses everyone while the feature flag is off', async () => {
    await h.prisma.featureFlag.update({
      where: { key: 'collaboration' },
      data: { enabled: false },
    });
    // The flag cache is sixty seconds; the service is asked to forget it.
    const { FlagsService } = await import('../src/modules/flags/flags.service.js');
    h.app.get(FlagsService).invalidate();
    expect(await closeCodeOf(h.cookie)).toBe(CLOSE.notFound);
  });
});
