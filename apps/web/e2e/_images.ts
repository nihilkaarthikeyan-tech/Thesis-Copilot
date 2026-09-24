/**
 * Images the browser tests upload, made here rather than checked in. Three specs had their own
 * copy of the PNG below; a copy drifts.
 */

import { deflateSync } from 'node:zlib';

/** A 3x2 red PNG, hand-assembled: the smallest thing the exporter has to measure and embed. */
export function tinyPng(): Buffer {
  const crc32 = (buf: Buffer): number => {
    let c = ~0;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xed_b8_83_20 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(3, 0); // width
  ihdr.writeUInt32BE(2, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  // Two rows of three red pixels, each row prefixed by its filter byte.
  const row = Buffer.from([0x00, 0xff, 0x00, 0x00, 0xff, 0x00, 0x00, 0xff, 0x00, 0x00]);
  const raw = Buffer.concat([row, row]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
