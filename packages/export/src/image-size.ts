/**
 * Intrinsic pixel dimensions of an image, read from its own header.
 *
 * `docx`'s `ImageRun` requires an explicit `transformation`, and there is no "just use the natural
 * size" option — a wrong number does not fail, it silently stretches the student's figure. So the
 * size has to come from the file, and reading four integers out of a header is a great deal less
 * machinery than a decoding dependency for a job this small.
 *
 * Only the formats `FiguresService` accepts are handled, and for the same reason: those are the
 * only ones that can reach a document.
 */

/** A figure is centred in the text column. 450pt ≈ the usable width of A4 with 1" margins. */
export const MAX_FIGURE_WIDTH_PT = 450;

export type Pixels = { width: number; height: number };

const u16be = (b: Uint8Array, at: number): number => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u32be = (b: Uint8Array, at: number): number =>
  (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>>
  0;
const u16le = (b: Uint8Array, at: number): number => ((b[at + 1] ?? 0) << 8) | (b[at] ?? 0);

function pngSize(b: Uint8Array): Pixels | null {
  // IHDR is always the first chunk: 8-byte signature, 4-byte length, 4-byte type, then w/h.
  if (b.length < 24) return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function gifSize(b: Uint8Array): Pixels | null {
  if (b.length < 10) return null;
  return { width: u16le(b, 6), height: u16le(b, 8) };
}

/**
 * JPEG keeps its dimensions in a start-of-frame marker, which sits after a variable number of
 * other segments — so the segment chain has to be walked rather than indexed into.
 */
function jpegSize(b: Uint8Array): Pixels | null {
  let at = 2; // past SOI
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) {
      at += 1; // padding between segments is legal
      continue;
    }
    const marker = b[at + 1] ?? 0;
    // Any number of 0xFF fill bytes may precede a marker, so a second 0xFF is not a marker id —
    // it is the next byte of the run. Treating it as one made the reader take the two bytes after
    // it as a segment length and walk off into the entropy-coded data.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // Standalone markers carry no length word: TEM, and the eight restart markers.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    // Every SOFn carries the size except the four that are not frame headers at all.
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: u16be(b, at + 5), width: u16be(b, at + 7) };
    const length = u16be(b, at + 2);
    if (length < 2) return null; // malformed; stop rather than loop forever
    at += 2 + length;
  }
  return null;
}

/** WebP has three container variants and each stores the size differently. */
function webpSize(b: Uint8Array): Pixels | null {
  if (b.length < 30) return null;
  const fourcc = String.fromCharCode(b[12] ?? 0, b[13] ?? 0, b[14] ?? 0, b[15] ?? 0);
  if (fourcc === 'VP8 ') {
    // Lossy: 14-bit width and height after the 3-byte start code at offset 23.
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (fourcc === 'VP8L') {
    // Lossless: 14 bits each, packed across four bytes after the 1-byte signature.
    const bits = u32be(b, 21);
    const le = ((bits >>> 24) | ((bits >>> 8) & 0xff00) | ((bits << 8) & 0xff0000)) >>> 0;
    return { width: (le & 0x3fff) + 1, height: ((le >>> 14) & 0x3fff) + 1 };
  }
  if (fourcc === 'VP8X') {
    // Extended: 24-bit minus-one values, little-endian, at offset 24.
    const w = (b[24] ?? 0) | ((b[25] ?? 0) << 8) | ((b[26] ?? 0) << 16);
    const h = (b[27] ?? 0) | ((b[28] ?? 0) << 8) | ((b[29] ?? 0) << 16);
    return { width: w + 1, height: h + 1 };
  }
  return null;
}

export function imageSize(bytes: Uint8Array): Pixels | null {
  const size =
    bytes[0] === 0x89 && bytes[1] === 0x50
      ? pngSize(bytes)
      : bytes[0] === 0xff && bytes[1] === 0xd8
        ? jpegSize(bytes)
        : bytes[0] === 0x47 && bytes[1] === 0x49
          ? gifSize(bytes)
          : bytes[0] === 0x52 && bytes[1] === 0x49
            ? webpSize(bytes)
            : null;
  if (!size || size.width <= 0 || size.height <= 0) return null;
  return size;
}

/**
 * Scales an image down to the text column, keeping its aspect ratio.
 *
 * Only ever down. Blowing a 200px screenshot up to full width would print it as a blur, and the
 * student would reasonably read that as the export having damaged their figure.
 */
export function fitToColumn(size: Pixels, maxWidth = MAX_FIGURE_WIDTH_PT): Pixels {
  if (size.width <= maxWidth) return size;
  const scale = maxWidth / size.width;
  return { width: maxWidth, height: Math.max(1, Math.round(size.height * scale)) };
}
