/**
 * "Import from Word" end to end (2026-10-04): `POST /documents/:id/import-docx` on the real
 * application, Postgres and MinIO.
 *
 * What it must hold to: chapters split at Heading 1 (one chapter without any), imported text is
 * the student's own (HUMAN), the outline and the chapter rows never disagree, replace is refused
 * once any chapter has text, every chapter replace touches is snapshotted first, and someone
 * else's thesis is a 404. No model is called, so no usage is recorded.
 */

import { readOutline, walkOutline } from '@tc/types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Harness, startHarness } from './_harness.js';
import { buildWord, heading1, heading2, para, thesisWord } from './_word.js';

let h: Harness;

async function upload(
  documentId: string,
  bytes: Buffer,
  mode: 'preview' | 'append' | 'replace' = 'append',
  options: { filename?: string; cookie?: string } = {},
): Promise<Response> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(bytes)], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    options.filename ?? 'thesis.docx',
  );
  return fetch(`${h.baseUrl}/api/v1/documents/${documentId}/import-docx?mode=${mode}`, {
    method: 'POST',
    headers: { cookie: options.cookie ?? h.cookie },
    body: form,
  });
}

async function newThesis(title: string): Promise<{ id: string; firstChapterId: string }> {
  const res = await h.api('/documents', {
    method: 'POST',
    body: JSON.stringify({ title, entryPath: 'A_TOPIC' }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; firstChapterId: string };
}

/** The outline's top-level ids and the chapters' ids in order must be the same list. */
async function expectInSync(documentId: string): Promise<void> {
  const [memory, chapters] = await Promise.all([
    h.prisma.documentMemory.findUniqueOrThrow({ where: { documentId } }),
    h.prisma.chapter.findMany({ where: { documentId }, orderBy: { order: 'asc' } }),
  ]);
  const outline = readOutline(memory.outline);
  expect(chapters.map((c) => c.outlineNodeId)).toEqual(outline.map((n) => n.id));
  expect(chapters.map((c) => c.title)).toEqual(outline.map((n) => n.title));
  expect(chapters.map((c) => c.order)).toEqual(chapters.map((_, i) => i + 1));
  const ids = walkOutline(outline).map((n) => n.id);
  expect(new Set(ids).size).toBe(ids.length);
}

/** The second user, through the same OTP door as the first. */
async function signIn(email: string): Promise<string> {
  const spy = vi.spyOn(console, 'log');
  await h.api('/auth/email-otp/send-verification-otp', {
    method: 'POST',
    headers: { cookie: '' },
    body: JSON.stringify({ email, type: 'sign-in' }),
  });
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

beforeAll(async () => {
  h = await startHarness('word-import@example.com');
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('preview', () => {
  it('lists the chapters the file would make and writes nothing', async () => {
    const doc = await newThesis('Preview only');
    const res = await upload(doc.id, await thesisWord(), 'preview');
    expect(res.status).toBe(200);
    const preview = (await res.json()) as {
      chapters: Array<{ title: string; words: number; sections: number; preamble: boolean }>;
      images: number;
      footnotes: number;
      tables: number;
      citationLike: number;
      canReplace: boolean;
      existing: { chapters: number; withText: number };
    };
    expect(preview.chapters.map((c) => c.title)).toEqual([
      'Front matter',
      'Introduction',
      'Methods',
    ]);
    expect(preview.chapters[1]).toMatchObject({ sections: 1, preamble: false });
    expect(preview.chapters.every((c) => c.words > 0)).toBe(true);
    expect(preview).toMatchObject({
      images: 1,
      footnotes: 1,
      tables: 1,
      citationLike: 3,
      canReplace: true,
      existing: { chapters: 1, withText: 0 },
    });
    expect(await h.prisma.chapter.count({ where: { documentId: doc.id } })).toBe(1);
  });
});

describe('append (the default)', () => {
  it('adds the chapters after the existing one, as the student’s own text, outline in step', async () => {
    const doc = await newThesis('Append');
    const res = await upload(doc.id, await thesisWord());
    expect(res.status).toBe(200);
    const result = (await res.json()) as {
      mode: string;
      created: Array<{ id: string; title: string }>;
      images: number;
      citationLike: number;
    };
    expect(result.mode).toBe('append');
    expect(result.created.map((c) => c.title)).toEqual(['Front matter', 'Introduction', 'Methods']);
    expect(result.images).toBe(1);

    const chapters = await h.prisma.chapter.findMany({
      where: { documentId: doc.id },
      orderBy: { order: 'asc' },
    });
    // The new thesis's own first chapter stays first.
    expect(chapters.map((c) => c.title)).toEqual([
      'Chapter 1',
      'Front matter',
      'Introduction',
      'Methods',
    ]);
    expect(chapters[0]?.id).toBe(doc.firstChapterId);
    await expectInSync(doc.id);

    const intro = chapters[2];
    const json = JSON.stringify(intro?.content);
    expect(json).toContain('"type":"bulletList"');
    expect(json).toContain('"type":"table"');
    expect(json).toContain('Central Ground Water Board figures.');
    expect(json).toContain('(Kumar, 2021).');
    expect(json).not.toContain('"type":"image"');
    // No citation node is invented for a citation typed as text.
    expect(json).not.toContain('"type":"citation"');
    // Imported words are HUMAN words, and the stored count is the count of them.
    const counts = intro?.wordCounts as Record<string, number>;
    expect(counts.HUMAN).toBe(intro?.wordCount);
    expect(counts.ASSIST + counts.DRAFT + counts.COMMAND + counts.HUMAN_EDITED).toBe(0);

    // Its Heading 2 is a section of its outline node.
    const memory = await h.prisma.documentMemory.findUniqueOrThrow({
      where: { documentId: doc.id },
    });
    const node = readOutline(memory.outline).find((n) => n.id === intro?.outlineNodeId);
    expect(node?.children.map((c) => c.title)).toEqual(['Background']);

    // No model was called, so nothing was spent.
    expect(await h.prisma.aiCallLog.count({ where: { documentId: doc.id } })).toBe(0);

    // A second import goes after the first, and the outline still matches.
    const again = await upload(
      doc.id,
      await buildWord([heading1('Results'), para('Yields rose.')]),
    );
    expect(again.status).toBe(200);
    const titles = (
      await h.prisma.chapter.findMany({ where: { documentId: doc.id }, orderBy: { order: 'asc' } })
    ).map((c) => c.title);
    expect(titles.at(-1)).toBe('Results');
    await expectInSync(doc.id);
  });

  it('makes one chapter of a file with no Heading 1, named after the file', async () => {
    const doc = await newThesis('No headings');
    const res = await upload(
      doc.id,
      await buildWord([para('Notes on canal irrigation.'), heading2('Sites'), para('Three.')]),
      'append',
      { filename: 'Canal notes.docx' },
    );
    expect(res.status).toBe(200);
    const result = (await res.json()) as {
      created: Array<{ title: string }>;
      splitAtHeadings: boolean;
    };
    expect(result.splitAtHeadings).toBe(false);
    expect(result.created.map((c) => c.title)).toEqual(['Canal notes']);
    await expectInSync(doc.id);
  });

  it('keeps an outline the student already has and appends after it', async () => {
    const doc = await newThesis('Has an outline');
    const outline = [
      { id: 'ch-1', title: 'Introduction', scopeNote: 'Why.', children: [] },
      { id: 'ch-2', title: 'Literature', scopeNote: 'Who.', children: [] },
    ];
    const saved = await h.api(`/documents/${doc.id}/memory/outline`, {
      method: 'PUT',
      body: JSON.stringify({ outline }),
    });
    expect(saved.status).toBe(200);

    const res = await upload(doc.id, await buildWord([heading1('Methods'), para('Surveys.')]));
    expect(res.status).toBe(200);
    const chapters = await h.prisma.chapter.findMany({
      where: { documentId: doc.id },
      orderBy: { order: 'asc' },
    });
    expect(chapters.map((c) => c.title)).toEqual(['Introduction', 'Literature', 'Methods']);
    await expectInSync(doc.id);
  });
});

describe('replace', () => {
  it('is refused once any chapter has text, and nothing changes', async () => {
    const doc = await newThesis('Has text');
    const chapter = await h.prisma.chapter.findUniqueOrThrow({ where: { id: doc.firstChapterId } });
    const written = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Chapter 1' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'My own careful paragraph.' }] },
      ],
    };
    const save = await h.api(`/chapters/${chapter.id}`, {
      method: 'PUT',
      body: JSON.stringify({ content: written, baseVersion: chapter.version }),
    });
    expect(save.status).toBe(200);

    const preview = (await (await upload(doc.id, await thesisWord(), 'preview')).json()) as {
      canReplace: boolean;
    };
    expect(preview.canReplace).toBe(false);

    const res = await upload(doc.id, await thesisWord(), 'replace');
    expect(res.status).toBe(409);
    const problem = (await res.json()) as { type: string; detail: string };
    expect(problem.type).toBe('CONFLICT');
    expect(problem.detail).toContain('Add the imported chapters after them instead');

    const after = await h.prisma.chapter.findMany({ where: { documentId: doc.id } });
    expect(after).toHaveLength(1);
    expect(JSON.stringify(after[0]?.content)).toContain('My own careful paragraph.');
  });

  it('replaces an empty thesis, snapshotting every chapter it reuses or removes', async () => {
    const doc = await newThesis('Empty');
    // Three empty chapters from an outline; the file has two.
    const saved = await h.api(`/documents/${doc.id}/memory/outline`, {
      method: 'PUT',
      body: JSON.stringify({
        outline: [
          { id: 'ch-1', title: 'One', scopeNote: '', children: [] },
          { id: 'ch-2', title: 'Two', scopeNote: '', children: [] },
          { id: 'ch-3', title: 'Three', scopeNote: '', children: [] },
        ],
      }),
    });
    expect(saved.status).toBe(200);
    const before = await h.prisma.chapter.findMany({
      where: { documentId: doc.id },
      orderBy: { order: 'asc' },
    });

    const res = await upload(
      doc.id,
      await buildWord([heading1('Introduction'), para('Why.'), heading1('Methods'), para('How.')]),
      'replace',
    );
    expect(res.status).toBe(200);
    const result = (await res.json()) as { replaced: number; created: Array<{ id: string }> };
    expect(result.replaced).toBe(before.length);

    const after = await h.prisma.chapter.findMany({
      where: { documentId: doc.id },
      orderBy: { order: 'asc' },
    });
    expect(after.map((c) => c.title)).toEqual(['Introduction', 'Methods']);
    // The first rows are reused, so their ids (and their history) survive.
    expect(after.map((c) => c.id)).toEqual(before.slice(0, 2).map((c) => c.id));
    expect(JSON.stringify(after[0]?.content)).toContain('Why.');
    await expectInSync(doc.id);

    const versions = await h.prisma.documentVersion.findMany({
      where: { documentId: doc.id, reason: 'PRE_IMPORT' },
    });
    expect(versions.map((v) => v.chapterId).sort()).toEqual(before.map((c) => c.id).sort());
  });
});

describe('refusals', () => {
  it('is a 404 on someone else’s thesis, for a preview and for an import', async () => {
    const doc = await newThesis('Private');
    const other = await signIn('word-import-intruder@example.com');
    for (const mode of ['preview', 'append', 'replace'] as const) {
      const res = await upload(doc.id, await thesisWord(), mode, { cookie: other });
      expect(res.status).toBe(404);
    }
    expect(await h.prisma.chapter.count({ where: { documentId: doc.id } })).toBe(1);
  });

  it('explains a file that is not a .docx and one that is password-protected', async () => {
    const doc = await newThesis('Wrong files');

    const pdf = await upload(doc.id, Buffer.from('%PDF-1.4\n'), 'preview', {
      filename: 'thesis.pdf',
    });
    expect(pdf.status).toBe(400);
    expect(((await pdf.json()) as { detail: string }).detail).toContain('.docx');

    // An encrypted .docx is an OLE compound file, not a zip.
    const ole = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(512),
    ]);
    const locked = await upload(doc.id, ole, 'preview', { filename: 'thesis.docx' });
    expect(locked.status).toBe(400);
    expect(((await locked.json()) as { detail: string }).detail).toContain('password-protected');

    const notWord = await upload(doc.id, Buffer.from('PK\u0003\u0004 not really a zip'), 'preview');
    expect(notWord.status).toBe(400);
    expect(((await notWord.json()) as { detail: string }).detail).toContain('could not be opened');
  });
});
