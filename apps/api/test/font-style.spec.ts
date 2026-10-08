/**
 * R33 (ADR-0120) through the real HTTP path: the font style is kept in the account's settings,
 * refuses a style the editor does not have, and the chapter `.docx` is written in it.
 */

import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './_harness.js';

/** One entry of a `.docx` (a zip), found by its local header and inflated. */
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

beforeAll(async () => {
  h = await startHarness('font-style@example.com');
}, 600_000);

afterAll(async () => {
  await h?.stop();
});

async function chapterStyles(documentId: string, chapterId: string): Promise<string> {
  const exported = await h.api(`/documents/${documentId}/export`, {
    method: 'POST',
    body: JSON.stringify({ chapterId, format: 'docx' }),
  });
  expect(exported.status).toBe(201);
  const { url } = (await exported.json()) as { url: string };
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  const styles = zipEntry(bytes, 'word/styles.xml');
  return styles.slice(styles.indexOf('<w:docDefaults>'), styles.indexOf('</w:docDefaults>'));
}

describe('the font style setting', () => {
  it('is absent until chosen, then kept, and writes the chapter .docx in it', async () => {
    const initial = (await (await h.api('/settings')).json()) as { fontStyle?: string };
    expect(initial.fontStyle).toBeUndefined();

    const created = await h.api('/documents', {
      method: 'POST',
      body: JSON.stringify({ title: 'Drip irrigation uptake', entryPath: 'A_TOPIC' }),
    });
    const doc = (await created.json()) as { id: string; firstChapterId: string };

    // The default leaves Word on its own font.
    expect(await chapterStyles(doc.id, doc.firstChapterId)).not.toContain('Times New Roman');

    const put = await h.api('/settings', {
      method: 'PUT',
      body: JSON.stringify({ fontStyle: 'serif' }),
    });
    expect(put.status).toBe(200);
    const after = (await (await h.api('/settings')).json()) as {
      fontStyle?: string;
      autoCite: boolean;
    };
    expect(after.fontStyle).toBe('serif');
    expect(after.autoCite).toBe(true);
    expect(await chapterStyles(doc.id, doc.firstChapterId)).toContain('w:ascii="Times New Roman"');

    await h.api('/settings', { method: 'PUT', body: JSON.stringify({ fontStyle: 'sans' }) });
    expect(await chapterStyles(doc.id, doc.firstChapterId)).toContain('w:ascii="Arial"');
  });

  it('refuses a style the editor does not have', async () => {
    const put = await h.api('/settings', {
      method: 'PUT',
      body: JSON.stringify({ fontStyle: 'comic-sans' }),
    });
    expect(put.status).toBe(400);
  });
});
