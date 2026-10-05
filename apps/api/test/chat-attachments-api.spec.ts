/**
 * Attachments to a chat question, through the API — ADR-0083.
 *
 * The real application on Postgres, Redis and MinIO with the mock model. Pinned: a text file
 * becomes one more passage the answer may cite, labelled by its name and never a source; a picture
 * goes to the model as an image part of the question; a question about an attachment is not
 * refused for a library that has nothing on it; an unknown or expired id is refused before any
 * unit is taken; nothing joins the library.
 */

import type { LlmRequest, Providers } from '@tc/ai';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVIDERS } from '../src/modules/ai/ai.module.js';
import { periodFor } from '../src/modules/usage/usage.service.js';
import { type Harness, startHarness } from './_harness.js';

let h: Harness;
let documentId: string;
let providers: Providers;

const NOTE =
  'Field notes, Virudhunagar, March 2026. Of the 40 women interviewed, 31 owned a phone but only 9 had used it for a bank transaction. The commonest reason given was fear of sending money to the wrong account.';

/** The smallest PNG the sniffer accepts: the eight-byte signature and the start of IHDR. */
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00,
]);

async function upload(name: string, bytes: Uint8Array, type: string) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  const res = await fetch(
    `${h.baseUrl}/api/v1/chat/attachments?documentId=${encodeURIComponent(documentId)}`,
    { method: 'POST', headers: { cookie: h.cookie }, body: form },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

type Sse = { events: Array<{ event: string; data: Record<string, unknown> }>; status: number };

async function ask(body: Record<string, unknown>): Promise<Sse> {
  const res = await h.api('/chat', {
    method: 'POST',
    body: JSON.stringify({
      documentId,
      message: 'What does the attached note say stops the women from using mobile banking?',
      ...body,
    }),
  });
  if (!res.headers.get('content-type')?.includes('text/event-stream')) {
    return { status: res.status, events: [] };
  }
  const events = (await res.text())
    .split('\n\n')
    .filter(Boolean)
    .map((block) => ({
      event: /^event: (.*)$/m.exec(block)?.[1] ?? '',
      data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? '{}') as Record<string, unknown>,
    }));
  return { status: res.status, events };
}

const done = (sse: Sse) => sse.events.find((e) => e.event === 'done')?.data ?? {};

async function chatUnits(): Promise<number> {
  const row = await h.prisma.usageLedger.findFirst({
    where: { userId: h.userId, action: 'CHAT', period: periodFor() },
  });
  return row?.count ?? 0;
}

beforeAll(async () => {
  h = await startHarness('chat-attachments@example.com');
  providers = h.app.get<Providers>(PROVIDERS);
  const document = await h.prisma.document.create({
    data: {
      ownerId: h.userId,
      title: 'Mobile banking and rural women in Tamil Nadu',
      entryPath: 'A_TOPIC',
    },
  });
  documentId = document.id;
  await h.prisma.chapter.create({
    data: {
      documentId,
      outlineNodeId: 'n1',
      title: 'Literature Review',
      scopeNote: 'How rural women take up mobile banking.',
      order: 1,
      content: { type: 'doc', content: [] },
    },
  });
}, 300_000);

beforeEach(async () => {
  vi.restoreAllMocks();
  await h.prisma.usageLedger.deleteMany({ where: { userId: h.userId, action: 'CHAT' } });
});

afterAll(async () => {
  await h?.stop();
});

describe('a document attached to a question', () => {
  it('is read as one more passage, cited by name, and nothing joins the library', async () => {
    const uploaded = await upload('field-notes.txt', new TextEncoder().encode(NOTE), 'text/plain');
    expect(uploaded.status).toBe(200);
    expect(uploaded.body.kind).toBe('document');
    expect(uploaded.body.name).toBe('field-notes.txt');
    expect(uploaded.body.chars).toBeGreaterThan(100);

    const requests: LlmRequest[] = [];
    const real = providers.llm.stream.bind(providers.llm);
    vi.spyOn(providers.llm, 'stream').mockImplementation((req) => {
      requests.push(req);
      return real(req);
    });

    // An empty library: without the attachment this question would be refused.
    const sse = await ask({ attachmentIds: [uploaded.body.id] });
    expect(sse.status).toBe(200);
    const answer = done(sse);
    expect(answer.outcome).toBe('answered');
    const prompt = requests.at(-1)?.messages.at(-1)?.content ?? '';
    expect(prompt).toContain('<passage id="Satt1#c1" source="Attached: field-notes.txt">');
    expect(prompt).toContain('fear of sending money to the wrong account');

    const citations = answer.citations as Array<{
      key: string;
      sourceId: string;
      attachment?: { name: string };
    }>;
    expect(citations.length).toBeGreaterThan(0);
    expect(citations[0]?.key).toBe('Satt1#c1');
    expect(citations[0]?.sourceId).toBe('');
    expect(citations[0]?.attachment).toEqual({ name: 'field-notes.txt' });
    expect(await chatUnits()).toBe(1);
    expect(await h.prisma.source.count({ where: { documentId } })).toBe(0);
  });

  it('a picture goes to the model as an image part of the question', async () => {
    const uploaded = await upload('figure.png', PNG, 'image/png');
    expect(uploaded.status).toBe(200);
    expect(uploaded.body.kind).toBe('image');
    const note = await upload('notes.txt', new TextEncoder().encode(NOTE), 'text/plain');

    const requests: LlmRequest[] = [];
    const real = providers.llm.stream.bind(providers.llm);
    vi.spyOn(providers.llm, 'stream').mockImplementation((req) => {
      requests.push(req);
      return real(req);
    });
    const sse = await ask({ attachmentIds: [uploaded.body.id, note.body.id] });
    expect(sse.status).toBe(200);
    const last = requests.at(-1)?.messages.at(-1);
    expect(last?.images).toHaveLength(1);
    expect(last?.images?.[0]?.mediaType).toBe('image/png');
    expect(last?.images?.[0]?.data.length).toBe(PNG.length);
    expect(last?.content).toContain('Attached: notes.txt');
  });
});

describe('what is refused', () => {
  it('an unknown or expired attachment id, before any unit is taken', async () => {
    const sse = await ask({ attachmentIds: ['01a10000-0000-7000-8000-00000000aaaa'] });
    expect(sse.status).toBe(400);
    expect(await chatUnits()).toBe(0);
  });

  it('a file of no readable kind', async () => {
    const bad = await upload(
      'blob.bin',
      Uint8Array.from({ length: 64 }, (_, i) => i % 7),
      'application/octet-stream',
    );
    expect(bad.status).toBe(400);
    const empty = await upload('empty.txt', new Uint8Array(), 'text/plain');
    expect(empty.status).toBe(400);
  });

  it('another thesis’s attachment', async () => {
    const other = await h.prisma.document.create({
      data: { ownerId: h.userId, title: 'Another thesis', entryPath: 'A_TOPIC' },
    });
    const form = new FormData();
    form.append(
      'file',
      new Blob([new TextEncoder().encode(NOTE)], { type: 'text/plain' }),
      'n.txt',
    );
    const res = await fetch(
      `${h.baseUrl}/api/v1/chat/attachments?documentId=${encodeURIComponent(other.id)}`,
      { method: 'POST', headers: { cookie: h.cookie }, body: form },
    );
    const uploaded = (await res.json()) as { id: string };
    const sse = await ask({ attachmentIds: [uploaded.id] });
    expect(sse.status).toBe(400);
  });
});
