/**
 * Reading a figure's dimensions out of its header.
 *
 * `docx`'s `ImageRun` has no "natural size" option — a wrong number does not fail the export, it
 * silently prints the student's figure stretched or squashed into the thesis they hand in. So the
 * numbers have to be right, and they have to come from the file.
 *
 * The fixtures are real headers, byte for byte, rather than whatever the code happens to read.
 */

import { describe, expect, it } from 'vitest';
import { fitToColumn, imageSize, MAX_FIGURE_WIDTH_PT } from '../src/image-size.js';

/** PNG: 8-byte signature, then IHDR length/type, then width and height as big-endian uint32. */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

/** GIF87a/89a: "GIF8?a" then width and height as little-endian uint16. */
function gif(width: number, height: number): Uint8Array {
  const b = new Uint8Array(16);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
  new DataView(b.buffer).setUint16(6, width, true);
  new DataView(b.buffer).setUint16(8, height, true);
  return b;
}

/**
 * JPEG: SOI, then one segment to skip, then SOF0 carrying height then width (big-endian, in that
 * order — the reverse of every other format here, which is exactly the kind of detail worth a
 * test).
 */
function jpeg(width: number, height: number, { withPadding = false } = {}): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  // A JFIF APP0 segment of 16 bytes, purely to make the reader walk the chain.
  parts.push(0xff, 0xe0, 0x00, 0x10);
  for (let i = 0; i < 14; i += 1) parts.push(0x00);
  if (withPadding) parts.push(0xff, 0xff); // legal fill bytes between segments
  parts.push(0xff, 0xc0, 0x00, 0x11, 0x08);
  parts.push((height >> 8) & 0xff, height & 0xff);
  parts.push((width >> 8) & 0xff, width & 0xff);
  for (let i = 0; i < 8; i += 1) parts.push(0x00);
  return new Uint8Array(parts);
}

describe('reading dimensions', () => {
  it('reads a PNG', () => {
    expect(imageSize(png(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  });

  it('reads a GIF, whose numbers are little-endian', () => {
    expect(imageSize(gif(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it('reads a JPEG, walking past the segments before the frame header', () => {
    expect(imageSize(jpeg(800, 600))).toEqual({ width: 800, height: 600 });
  });

  it('tolerates the fill bytes that are legal between JPEG segments', () => {
    expect(imageSize(jpeg(800, 600, { withPadding: true }))).toEqual({ width: 800, height: 600 });
  });

  it('does not confuse a JPEG width with its height', () => {
    // SOF0 stores height first. Getting this backwards rotates every non-square figure in the
    // thesis and nothing else would notice.
    const portrait = imageSize(jpeg(600, 900));
    expect(portrait).toEqual({ width: 600, height: 900 });
    expect(portrait?.height).toBeGreaterThan(portrait?.width ?? 0);
  });

  it('returns null rather than guessing for a format it does not read', () => {
    expect(imageSize(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull(); // PDF
    expect(imageSize(new Uint8Array([]))).toBeNull();
  });

  it('returns null for a truncated header instead of reading past the end', () => {
    expect(imageSize(png(100, 100).slice(0, 18))).toBeNull();
  });

  it('does not loop forever on a malformed JPEG segment length', () => {
    // A zero length would advance the cursor by nothing; the reader has to bail instead.
    const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0, 0, 0, 0, 0, 0]);
    expect(imageSize(broken)).toBeNull();
  });
});

describe('fitting a figure to the text column', () => {
  it('leaves a small figure alone rather than blowing it up into a blur', () => {
    expect(fitToColumn({ width: 200, height: 100 })).toEqual({ width: 200, height: 100 });
  });

  it('scales an oversized figure down and keeps its shape', () => {
    const fitted = fitToColumn({ width: 1800, height: 900 });
    expect(fitted.width).toBe(MAX_FIGURE_WIDTH_PT);
    expect(fitted.height).toBe(MAX_FIGURE_WIDTH_PT / 2);
  });

  it('never scales a very tall figure to zero height', () => {
    const fitted = fitToColumn({ width: 4000, height: 3 });
    expect(fitted.height).toBeGreaterThanOrEqual(1);
  });
});
