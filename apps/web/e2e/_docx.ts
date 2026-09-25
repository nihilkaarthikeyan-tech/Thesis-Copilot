/**
 * One entry of a `.docx` (a zip), read with no dependency: find the local header by name, then
 * inflate the raw deflate stream after it. Enough for `word/document.xml` and `word/footnotes.xml`.
 */

import { inflateRawSync } from 'node:zlib';

export function docxEntry(zip: Buffer, name: string): string {
  for (let i = 0; i + 30 < zip.length; i++) {
    if (zip.readUInt32LE(i) !== 0x04034b50) continue;
    const method = zip.readUInt16LE(i + 8);
    const size = zip.readUInt32LE(i + 18);
    const nameLength = zip.readUInt16LE(i + 26);
    const extra = zip.readUInt16LE(i + 28);
    const found = zip.subarray(i + 30, i + 30 + nameLength).toString('utf8');
    const start = i + 30 + nameLength + extra;
    if (found === name) {
      const data = zip.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    }
  }
  return '';
}
