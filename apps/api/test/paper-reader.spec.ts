/**
 * The paper reader's API (ADR-0068): the PDF streamed through the API for the reader's own pdf.js
 * view, the paper's record and reading state, its text without the chunker's overlaps, and the
 * label "Copy with citation" puts after a quotation.
 *
 * The PDF route is the one that matters for safety: it hands over a student's file, so it answers
 * the owner and nobody else, says nothing about whether a file exists to anyone else, and never
 * lets a shared cache keep a copy.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { classifyRequest } from '../src/common/rate-limit.js';
import { StorageService } from '../src/common/storage.service.js';
import { buildPdf, type Harness, startHarness } from './_harness.js';

let h: Harness;
let cookieB = '';
let documentId: string;
let withFileId: string;
let abstractOnlyId: string;
let pdf: Buffer;

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

const asB = (path: string) => h.api(path, { headers: { cookie: cookieB } });

beforeAll(async () => {
  h = await startHarness('reader-owner@example.com');
  cookieB = await signIn('reader-stranger@example.com');

  const document = await h.prisma.document.create({
    data: { ownerId: h.userId, title: 'Groundwater recharge', entryPath: 'A_TOPIC' },
  });
  documentId = document.id;

  pdf = buildPdf(['Recharge wells in hard rock', 'The water table rose by 1.2 m.']);
  const key = `sources/${documentId}/reader-test.pdf`;
  await h.app.get(StorageService).put(key, pdf, { 'Content-Type': 'application/pdf' });

  const withFile = await h.prisma.source.create({
    data: {
      documentId,
      status: 'RESOLVED',
      title: 'Recharge wells in hard rock',
      authors: [{ family: 'Kumar', given: 'A.' }],
      year: 2021,
      venue: 'Journal of Hydrology',
      doi: '10.1000/recharge.2021',
      groundingLevel: 'FULL_TEXT',
      fileKey: key,
      cslJson: {
        type: 'article-journal',
        title: 'Recharge wells in hard rock',
        author: [{ family: 'Kumar', given: 'A.' }],
        issued: { 'date-parts': [[2021]] },
        'container-title': 'Journal of Hydrology',
      },
    },
  });
  withFileId = withFile.id;

  // Two overlapping chunks, as the chunker writes them: the second repeats the first's last
  // sentence, which the reader must not show twice.
  const first = 'Recharge wells were built in 2019. The water table rose by 1.2 m.';
  const second = 'The water table rose by 1.2 m. Farmers reported a second crop.';
  await h.prisma.sourceChunk.createMany({
    data: [
      {
        sourceId: withFileId,
        ordinal: 0,
        page: 1,
        section: 'Results',
        text: first,
        charStart: 0,
        charEnd: first.length,
        tokenCount: 16,
      },
      {
        sourceId: withFileId,
        ordinal: 1,
        page: 2,
        section: 'Results',
        text: second,
        charStart: first.indexOf('The water table'),
        charEnd: first.indexOf('The water table') + second.length,
        tokenCount: 15,
      },
    ],
  });

  const abstractOnly = await h.prisma.source.create({
    data: {
      documentId,
      status: 'RESOLVED',
      title: 'Aquifer storage in basalt',
      year: 2018,
      groundingLevel: 'ABSTRACT',
    },
  });
  abstractOnlyId = abstractOnly.id;
  await h.prisma.sourceChunk.create({
    data: {
      sourceId: abstractOnlyId,
      ordinal: 0,
      text: 'We measured storage in fractured basalt aquifers.',
      tokenCount: 9,
    },
  });
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('GET /sources/:id/file/content', () => {
  it('streams the owner their PDF, inline, private, with its length', async () => {
    const res = await h.api(`/sources/${withFileId}/file/content`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/^inline/);
    expect(res.headers.get('cache-control')).toMatch(/private/);
    expect(res.headers.get('content-length')).toBe(String(pdf.length));
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.equals(pdf)).toBe(true);
  });

  it('answers anyone else 404 — the same as an id that never existed', async () => {
    const theirs = await asB(`/sources/${withFileId}/file/content`);
    expect(theirs.status).toBe(404);
    const never = await asB('/sources/01900000-0000-7000-8000-000000000000/file/content');
    expect(never.status).toBe(404);
    // And no body that would say otherwise.
    expect(await theirs.text()).not.toContain('%PDF');
  });

  it('answers 404 for a paper with no PDF', async () => {
    const res = await h.api(`/sources/${abstractOnlyId}/file/content`);
    expect(res.status).toBe(404);
  });

  it('answers 401 without a session', async () => {
    const res = await h.api(`/sources/${withFileId}/file/content`, { headers: { cookie: '' } });
    expect(res.status).toBe(401);
  });

  it('is counted against the file-download limit', () => {
    expect(classifyRequest('GET', `/api/v1/sources/${withFileId}/file/content`)?.heavy).toBe(
      'file',
    );
    expect(classifyRequest('GET', `/api/v1/sources/${withFileId}/file`)?.heavy).toBe('file');
    expect(classifyRequest('GET', `/api/v1/sources/${withFileId}`)?.heavy).toBeNull();
  });
});

describe('GET /sources/:id', () => {
  it('gives the owner the record, its collections and where reading stands', async () => {
    const collection = await h.prisma.sourceCollection.create({
      data: { documentId, name: 'Methods' },
    });
    await h.prisma.sourceCollectionItem.create({
      data: { collectionId: collection.id, sourceId: withFileId },
    });
    const res = await h.api(`/sources/${withFileId}`);
    expect(res.status).toBe(200);
    const view = (await res.json()) as Record<string, unknown>;
    expect(view).toMatchObject({
      id: withFileId,
      documentId,
      title: 'Recharge wells in hard rock',
      hasFile: true,
      reading: 'FULL_TEXT',
      passageCount: 2,
      collections: [{ id: collection.id, name: 'Methods' }],
    });
    // The storage key is never part of what the page receives.
    expect(JSON.stringify(view)).not.toContain('reader-test.pdf');
  });

  it('says an abstract-only paper is abstract only', async () => {
    const res = await h.api(`/sources/${abstractOnlyId}`);
    expect(await res.json()).toMatchObject({ reading: 'ABSTRACT', hasFile: false });
  });

  it('answers anyone else 404', async () => {
    expect((await asB(`/sources/${withFileId}`)).status).toBe(404);
    expect((await asB(`/sources/${withFileId}/text`)).status).toBe(404);
  });
});

describe('GET /sources/:id/text', () => {
  it('returns the passages in order without the overlap repeated', async () => {
    const res = await h.api(`/sources/${withFileId}/text`);
    expect(res.status).toBe(200);
    const { passages } = (await res.json()) as {
      passages: Array<{ page: number | null; section: string | null; text: string }>;
    };
    expect(passages).toHaveLength(2);
    expect(passages[0]).toMatchObject({ page: 1, section: 'Results' });
    expect(passages[1]?.text).toBe('Farmers reported a second crop.');
    const all = passages.map((p) => p.text).join(' ');
    expect(all.match(/The water table rose/g)).toHaveLength(1);
  });

  it('returns an abstract-only paper its abstract', async () => {
    const res = await h.api(`/sources/${abstractOnlyId}/text`);
    const { passages } = (await res.json()) as { passages: Array<{ text: string }> };
    expect(passages.map((p) => p.text)).toEqual([
      'We measured storage in fractured basalt aquifers.',
    ]);
  });
});

describe('GET /documents/:id/citations/quote', () => {
  it('renders the label in the thesis style, with the page', async () => {
    const res = await h.api(
      `/documents/${documentId}/citations/quote?sourceId=${withFileId}&page=4`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { label: string; style: string; noteStyle: boolean };
    expect(body.style).toBe('apa');
    expect(body.noteStyle).toBe(false);
    expect(body.label).toContain('Kumar');
    expect(body.label).toContain('2021');
    expect(body.label).toContain('4');
  });

  it('follows a style switch', async () => {
    await h.api(`/documents/${documentId}/citation-style`, {
      method: 'PUT',
      body: JSON.stringify({ style: 'ieee' }),
    });
    const res = await h.api(`/documents/${documentId}/citations/quote?sourceId=${withFileId}`);
    const body = (await res.json()) as { label: string; numeric: boolean };
    expect(body.numeric).toBe(true);
    expect(body.label).toMatch(/\[1\]/);
    await h.api(`/documents/${documentId}/citation-style`, {
      method: 'PUT',
      body: JSON.stringify({ style: 'apa' }),
    });
  });

  it('refuses a missing source id, and another student', async () => {
    expect((await h.api(`/documents/${documentId}/citations/quote`)).status).toBe(400);
    const theirs = await asB(`/documents/${documentId}/citations/quote?sourceId=${withFileId}`);
    expect(theirs.status).toBe(404);
  });
});
