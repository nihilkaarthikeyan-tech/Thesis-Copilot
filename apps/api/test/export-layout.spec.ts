/**
 * R27 (ADR-0121) through the real HTTP path and storage: the export dialog's layout reaches the
 * thesis and chapter `.docx`, the template's checks still run, and PAGE_SETUP reads the layout the
 * file was built with — so a departure from the template is a finding, never a silent change.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

function zipEntry(zip: Buffer, name: string): string {
  for (let i = 0; i + 30 < zip.length; i++) {
    if (zip.readUInt32LE(i) !== 0x04034b50) continue;
    const method = zip.readUInt16LE(i + 8);
    const size = zip.readUInt32LE(i + 18);
    const nameLength = zip.readUInt16LE(i + 26);
    const extra = zip.readUInt16LE(i + 28);
    const start = i + 30 + nameLength + extra;
    if (zip.subarray(i + 30, i + 30 + nameLength).toString('utf8') === name) {
      const data = zip.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    }
  }
  return '';
}

let h: Harness;
let doc: { id: string; firstChapterId: string };

beforeAll(async () => {
  h = await startHarness('export-layout@example.com');
  // The seed's example template, as `pnpm db:seed` installs it.
  await h.prisma.institutionTemplate.create({
    data: {
      name: 'EXAMPLE_IN_UNIVERSITY',
      spec: JSON.parse(
        readFileSync(
          fileURLToPath(
            new URL('../../../packages/db/prisma/seed-data/example-template.json', import.meta.url),
          ),
          'utf8',
        ),
      ),
    },
  });
  const created = await h.api('/documents', {
    method: 'POST',
    body: JSON.stringify({ title: 'Drip irrigation uptake', entryPath: 'A_TOPIC' }),
  });
  doc = (await created.json()) as typeof doc;
  await h.prisma.chapter.update({
    where: { id: doc.firstChapterId },
    data: {
      content: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Introduction' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Rainfall fell sharply over the decade.' }],
          },
        ],
      },
    },
  });
  await h.prisma.comment.create({
    data: {
      documentId: doc.id,
      chapterId: doc.firstChapterId,
      authorEmail: 'guide@example.edu',
      quotedText: 'fell sharply',
      body: 'Which years?',
    },
  });
}, 600_000);

afterAll(async () => {
  await h?.stop();
});

const download = async (url: string) => Buffer.from(await (await fetch(url)).arrayBuffer());

describe('the export layout', () => {
  it('builds the thesis double-spaced, and PAGE_SETUP says it is not the template', async () => {
    const res = await h.api(`/documents/${doc.id}/export/thesis`, {
      method: 'POST',
      body: JSON.stringify({ format: 'docx', layout: { preset: 'double', comments: true } }),
    });
    expect(res.status).toBe(200);
    const result = (await res.json()) as {
      url: string;
      layout: { preset: string; lineSpacing: number; matchesTemplate: boolean };
      compliance: {
        checks: Array<{ check: string; passed: boolean; findings: Array<{ message: string }> }>;
      };
    };
    expect(result.layout).toMatchObject({
      preset: 'double',
      lineSpacing: 2,
      matchesTemplate: false,
    });
    const page = result.compliance.checks.find((c) => c.check === 'PAGE_SETUP');
    expect(page?.passed).toBe(false);
    expect(page?.findings.map((f) => f.message).join(' ')).toMatch(/Line spacing is 2/);

    const bytes = await download(result.url);
    expect(zipEntry(bytes, 'word/styles.xml')).toContain('w:line="480"');
    expect(zipEntry(bytes, 'word/comments.xml')).toContain('Which years?');
  });

  it('the thesis preset passes PAGE_SETUP, as an export without a layout does', async () => {
    const res = await h.api(`/documents/${doc.id}/export/thesis`, {
      method: 'POST',
      body: JSON.stringify({ format: 'docx', layout: { preset: 'thesis' } }),
    });
    const result = (await res.json()) as {
      compliance: { checks: Array<{ check: string; passed: boolean }> };
    };
    expect(result.compliance.checks.find((c) => c.check === 'PAGE_SETUP')?.passed).toBe(true);
  });

  it('lays a chapter out in two columns', async () => {
    const res = await h.api(`/documents/${doc.id}/export`, {
      method: 'POST',
      body: JSON.stringify({
        chapterId: doc.firstChapterId,
        format: 'docx',
        layout: { preset: 'two-column' },
      }),
    });
    expect(res.status).toBe(201);
    const { url } = (await res.json()) as { url: string };
    expect(zipEntry(await download(url), 'word/document.xml')).toMatch(/<w:cols [^>]*w:num="2"/);
  });

  it('refuses a layout the dialog does not offer', async () => {
    const res = await h.api(`/documents/${doc.id}/export/thesis`, {
      method: 'POST',
      body: JSON.stringify({ format: 'docx', layout: { preset: 'thesis', sizePt: 30 } }),
    });
    expect(res.status).toBe(400);
  });
});
