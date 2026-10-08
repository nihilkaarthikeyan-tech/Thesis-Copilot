/**
 * ADR-0057 — "Make a copy" of a thesis.
 *
 * Pinned: the copy has its own chapters, memory, settings and library (sources, chunks with
 * their vectors, citations, pins, files, figures) with every id inside the JSON rewritten to its
 * own; it has none of the original's shares, link, comments, usage or exports; it costs no
 * allowance; editing or erasing either thesis leaves the other exactly as it was; and only the
 * owner can make one.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StorageService } from '../src/common/storage.service.js';
import { copyTitle, remapIds, remapKey } from '../src/modules/documents/copy-ids.js';
import { buildPdf, type Harness, startHarness } from './_harness.js';

const A = '01900000-0000-7000-8000-00000000000a';
const B = '01900000-0000-7000-8000-00000000000b';

describe('id rewriting, pure', () => {
  const ids = new Map([[A, B]]);

  it('maps exact ids and the id segments of a storage key, and nothing else', () => {
    expect(remapIds({ sourceId: A, note: `see ${A}`, list: [A] }, ids)).toEqual({
      sourceId: B,
      note: `see ${A}`,
      list: [B],
    });
    expect(remapKey(`figures/${A}/x/${A}.png`, ids)).toBe(`figures/${B}/x/${B}.png`);
    expect(remapIds(`figures/${A}/c.png`, ids)).toBe(`figures/${B}/c.png`);
    expect(remapIds(`https://example.org/figures/${A}`, ids)).toBe(
      `https://example.org/figures/${A}`,
    );
  });

  it('builds new objects rather than sharing the old ones', () => {
    const before = { nested: { list: [{ id: A }] } };
    const after = remapIds(before, ids);
    after.nested.list.push({ id: 'x' });
    expect(before.nested.list).toHaveLength(1);
  });

  it('titles the copy "<title> (copy)" within the limit (R29, ADR-0114)', () => {
    expect(copyTitle('Solar Drying')).toBe('Solar Drying (copy)');
    const long = copyTitle('x'.repeat(300));
    expect(long).toHaveLength(300);
    // Shortened before the suffix, so a long copy still says what it is.
    expect(long.endsWith('… (copy)')).toBe(true);
    expect(copyTitle('y'.repeat(293))).toBe(`${'y'.repeat(293)} (copy)`);
  });
});

describe('making a copy, through the API', () => {
  let h: Harness;
  let storage: StorageService;
  let otherCookie: string;
  let originalId: string;
  let originalChapterId: string;
  let sourceId: string;
  let chunkId: string;
  let copyId: string;
  let copyChapterId: string;
  const figureKey = () => `figures/${originalId}/${originalChapterId}/fig-1.png`;

  const call = (cookie: string | null, path: string, init: RequestInit = {}) =>
    fetch(`${h.baseUrl}/api/v1${path}`, {
      ...init,
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        origin: 'http://localhost:3000',
        ...(cookie ? { cookie } : {}),
        ...(init.headers ?? {}),
      },
    });
  const owner = (path: string, init?: RequestInit) => call(h.cookie, path, init);

  async function save(chapterId: string, content: unknown) {
    const current = (await (await owner(`/chapters/${chapterId}`)).json()) as { version: number };
    const saved = await owner(`/chapters/${chapterId}`, {
      method: 'PUT',
      body: JSON.stringify({ content, baseVersion: current.version }),
    });
    expect(saved.status).toBe(200);
  }

  beforeAll(async () => {
    h = await startHarness('copy-owner@example.com');
    storage = h.app.get(StorageService);

    const created = await owner('/documents', {
      method: 'POST',
      body: JSON.stringify({ title: 'Solar Drying of Coastal Catch', entryPath: 'A_TOPIC' }),
    });
    const document = (await created.json()) as { id: string; firstChapterId: string };
    originalId = document.id;
    originalChapterId = document.firstChapterId;
    await h.prisma.document.update({
      where: { id: originalId },
      data: { citationStyle: 'ieee', language: 'en-GB', lifecycle: 'IN_REVIEW' },
    });

    // A library source with a file, a chunk carrying a vector, and a pin.
    const source = await h.prisma.source.create({
      data: {
        documentId: originalId,
        status: 'RESOLVED',
        title: 'Solar tunnel dryers in Kerala',
        doi: '10.1000/solar',
        year: 2021,
        authors: [{ family: 'Nair', given: 'A.' }],
        cslJson: { title: 'Solar tunnel dryers in Kerala', type: 'article-journal' },
        groundingLevel: 'FULL_TEXT',
      },
    });
    sourceId = source.id;
    const fileKey = `sources/${originalId}/${sourceId}.pdf`;
    await storage.put(fileKey, buildPdf(['Solar tunnel dryers.']), {
      'Content-Type': 'application/pdf',
    });
    await h.prisma.source.update({ where: { id: sourceId }, data: { fileKey } });
    const vector = `[${Array.from({ length: 1024 }, (_, i) => ((i % 7) / 10).toFixed(1)).join(',')}]`;
    const [chunk] = await h.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "SourceChunk" ("id", "sourceId", "ordinal", "text", "tokenCount", "embedding")
      VALUES (uuid_generate_v7(), ${sourceId}::uuid, 0, 'Dryers cut spoilage by a fifth.', 7, ${vector}::vector)
      RETURNING "id"::text AS id`;
    chunkId = (chunk as { id: string }).id;
    await h.prisma.chapterSourcePin.create({ data: { chapterId: originalChapterId, sourceId } });
    await h.prisma.documentMemory.update({
      where: { documentId: originalId },
      data: {
        scope: { workingTitle: 'Solar drying' },
        gapMap: { themes: [{ name: 'Dryers', count: 1, thin: false, sourceIds: [sourceId] }] },
      },
    });

    // A figure, and a chapter that cites the source and shows the figure.
    await storage.put(figureKey(), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
      'Content-Type': 'image/png',
    });
    await save(originalChapterId, {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Open drying loses a fifth of the catch. ' },
            {
              type: 'citation',
              attrs: { key: 'cite-1', sourceId, chunkId, role: 'parenthetical' },
            },
          ],
        },
        { type: 'image', attrs: { key: figureKey(), src: 'stale', alt: 'A dryer' } },
      ],
    });
    expect(await h.prisma.citation.count({ where: { chapterId: originalChapterId } })).toBe(1);

    // What must not travel: a share, a link, a comment.
    const shared = await owner(`/documents/${originalId}/feedback/shares`, {
      method: 'POST',
      body: JSON.stringify({ guideEmail: 'copy-guide@example.ac.in' }),
    });
    expect(shared.status).toBe(200);
    expect((await owner(`/documents/${originalId}/feedback/link`, { method: 'POST' })).status).toBe(
      200,
    );
    await h.prisma.comment.create({
      data: {
        documentId: originalId,
        chapterId: originalChapterId,
        authorEmail: 'g@x.in',
        body: 'Hm.',
      },
    });

    // A second account for the owner-only rule.
    const email = 'copy-other@example.com';
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
    otherCookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  }, 180_000);

  afterAll(async () => {
    await h?.stop();
  });

  it('only the owner can copy', async () => {
    expect(
      (await call(otherCookie, `/documents/${originalId}/copy`, { method: 'POST' })).status,
    ).toBe(404);
    expect((await call(null, `/documents/${originalId}/copy`, { method: 'POST' })).status).toBe(
      401,
    );
    expect(await h.prisma.document.count()).toBe(1);
  });

  it('makes "… (copy)" without spending any allowance', async () => {
    const usageBefore = await h.prisma.usageLedger.findMany({ orderBy: { action: 'asc' } });
    const res = await owner(`/documents/${originalId}/copy`, { method: 'POST' });
    expect(res.status).toBe(200);
    const copy = (await res.json()) as { id: string; title: string; firstChapterId: string };
    copyId = copy.id;
    copyChapterId = copy.firstChapterId;
    expect(copy.title).toBe('Solar Drying of Coastal Catch (copy)');
    expect(copyId).not.toBe(originalId);
    expect(copyChapterId).not.toBe(originalChapterId);
    expect(await h.prisma.usageLedger.findMany({ orderBy: { action: 'asc' } })).toEqual(
      usageBefore,
    );
    expect(await h.prisma.aiCallLog.count()).toBe(0);

    const row = await h.prisma.document.findUniqueOrThrow({ where: { id: copyId } });
    expect(row.ownerId).toBe(h.userId);
    expect(row.citationStyle).toBe('ieee');
    expect(row.language).toBe('en-GB');
    expect(row.lifecycle).toBe('DRAFTING');

    const list = (await (await owner('/documents')).json()) as Array<{ id: string }>;
    expect(list.map((d) => d.id)).toContain(copyId);
    const audit = await h.prisma.auditEvent.findFirst({ where: { kind: 'DOCUMENT_COPIED' } });
    expect(audit?.documentId).toBe(copyId);
  });

  it('copies the library with its own ids, files and vectors', async () => {
    const sources = await h.prisma.source.findMany({ where: { documentId: copyId } });
    expect(sources).toHaveLength(1);
    const copied = sources[0] as (typeof sources)[number];
    expect(copied.id).not.toBe(sourceId);
    expect(copied.title).toBe('Solar tunnel dryers in Kerala');
    expect(copied.groundingLevel).toBe('FULL_TEXT');
    expect(copied.fileKey).toBe(`sources/${copyId}/${copied.id}.pdf`);
    expect(await storage.exists(copied.fileKey as string)).toBe(true);

    const vectors = await h.prisma.$queryRaw<Array<{ sourceId: string; embedding: string }>>`
      SELECT "sourceId"::text AS "sourceId", "embedding"::text AS embedding FROM "SourceChunk"
      WHERE "sourceId" IN (${sourceId}::uuid, ${copied.id}::uuid)`;
    expect(vectors).toHaveLength(2);
    expect(vectors[0]?.embedding).toBe(vectors[1]?.embedding);

    const pins = await h.prisma.chapterSourcePin.findMany({ where: { chapterId: copyChapterId } });
    expect(pins).toEqual([{ chapterId: copyChapterId, sourceId: copied.id, section: '' }]);

    const memory = await h.prisma.documentMemory.findUniqueOrThrow({
      where: { documentId: copyId },
    });
    expect(memory.scope).toEqual({ workingTitle: 'Solar drying' });
    expect(JSON.stringify(memory.gapMap)).toContain(copied.id);
    expect(JSON.stringify(memory.gapMap)).not.toContain(sourceId);
  });

  it('points the copied chapter at its own source, chunk and figure', async () => {
    const chapter = await h.prisma.chapter.findUniqueOrThrow({ where: { id: copyChapterId } });
    const text = JSON.stringify(chapter.content);
    const copiedSource = await h.prisma.source.findFirstOrThrow({ where: { documentId: copyId } });
    const copiedChunk = await h.prisma.sourceChunk.findFirstOrThrow({
      where: { sourceId: copiedSource.id },
    });
    expect(text).toContain(copiedSource.id);
    expect(text).toContain(copiedChunk.id);
    expect(text).not.toContain(sourceId);
    expect(text).not.toContain(chunkId);
    expect(text).not.toContain(`figures/${originalId}`);
    const copiedFigure = `figures/${copyId}/${copyChapterId}/fig-1.png`;
    expect(text).toContain(copiedFigure);
    expect(await storage.exists(copiedFigure)).toBe(true);

    const citations = await h.prisma.citation.findMany({ where: { chapterId: copyChapterId } });
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({
      sourceId: copiedSource.id,
      chunkId: copiedChunk.id,
      nodeKey: 'cite-1',
    });
  });

  it('copies none of the shares, the link, the comments or the history', async () => {
    const where = { documentId: copyId };
    expect(await h.prisma.guideShare.count({ where })).toBe(0);
    expect(await h.prisma.shareLink.count({ where })).toBe(0);
    expect(await h.prisma.comment.count({ where })).toBe(0);
    expect(await h.prisma.exportArtifact.count({ where })).toBe(0);
    expect(await h.prisma.documentVersion.count({ where })).toBe(0);
    const shares = (await (
      await owner(`/documents/${copyId}/feedback/shares`)
    ).json()) as unknown[];
    expect(shares).toEqual([]);
  });

  it('editing the copy leaves the original as it was, and the other way round', async () => {
    const originalBefore = await h.prisma.chapter.findUniqueOrThrow({
      where: { id: originalChapterId },
    });
    await save(copyChapterId, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rewritten in the copy.' }] }],
    });
    const originalAfter = await h.prisma.chapter.findUniqueOrThrow({
      where: { id: originalChapterId },
    });
    expect(originalAfter.content).toEqual(originalBefore.content);
    expect(originalAfter.version).toBe(originalBefore.version);
    expect(await h.prisma.citation.count({ where: { chapterId: originalChapterId } })).toBe(1);

    await save(originalChapterId, {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Rewritten in the original.' }] },
      ],
    });
    const copyNow = await h.prisma.chapter.findUniqueOrThrow({ where: { id: copyChapterId } });
    expect(JSON.stringify(copyNow.content)).toContain('Rewritten in the copy.');
  });

  it('erasing the original leaves the copy whole, files included', async () => {
    // The guide share is not a co-author, so the original may be deleted.
    const removed = await owner(`/documents/${originalId}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(await h.prisma.document.count({ where: { id: originalId } })).toBe(0);

    const copiedSource = await h.prisma.source.findFirstOrThrow({ where: { documentId: copyId } });
    expect(await storage.exists(copiedSource.fileKey as string)).toBe(true);
    expect(await storage.exists(`figures/${copyId}/${copyChapterId}/fig-1.png`)).toBe(true);
    expect(await h.prisma.sourceChunk.count({ where: { sourceId: copiedSource.id } })).toBe(1);
    expect((await owner(`/documents/${copyId}`)).status).toBe(200);
    expect((await owner(`/chapters/${copyChapterId}`)).status).toBe(200);
  });
});
