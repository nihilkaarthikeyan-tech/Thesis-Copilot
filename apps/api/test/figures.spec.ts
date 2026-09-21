/**
 * Figure uploads — the storage half of the editor's "Insert figure" button.
 *
 * Unit tests, not harness ones: everything worth pinning here is a pure decision about *bytes*,
 * and the parts that need a database (ownership, the key scope check) are covered by the same
 * `document: { ownerId }` filter every other chapter route uses and proven by `authz.spec.ts`.
 *
 * The format check is the interesting one. It runs against the file's leading bytes rather than
 * its name or the browser's `content-type`, because both of those are supplied by whoever is
 * uploading — `evil.png` containing HTML is a stored-XSS attempt, and a content-type header is a
 * claim, not evidence.
 */

import { describe, expect, it } from 'vitest';
import {
  describeRejection,
  figureKey,
  MAX_FIGURE_BYTES,
  sniffImage,
} from '../src/modules/chapters/figures.service.js';

/** A buffer whose first bytes are `head` — enough for a signature check, which reads at most 12. */
const withHeader = (...head: number[]): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(head, 0);
  return bytes;
};

const PNG = withHeader(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = withHeader(0xff, 0xd8, 0xff, 0xe0);
const GIF = withHeader(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
// "RIFF" + 4 size bytes + "WEBP"
const WEBP = withHeader(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);

describe('what counts as a figure', () => {
  it('accepts exactly the formats a .docx can embed', () => {
    expect(sniffImage(PNG)).toEqual({ mime: 'image/png', ext: 'png' });
    expect(sniffImage(JPEG)).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(sniffImage(GIF)).toEqual({ mime: 'image/gif', ext: 'gif' });
  });

  it('refuses WebP, which docx cannot embed, and says what to do instead', () => {
    // The rule the whole allow-list exists for: if it cannot reach the .docx, it must not be
    // insertable. A figure that renders in the editor and vanishes from the submitted file is
    // the worst of the three possible behaviours.
    expect(sniffImage(WEBP)).toBeNull();
    expect(describeRejection(WEBP)).toContain('WebP');
    expect(describeRejection(WEBP)).toContain('PNG or JPEG');
  });

  it('refuses SVG, which is a document that can carry script', () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect(sniffImage(svg)).toBeNull();
  });

  it('refuses HTML wearing an image name', () => {
    // The whole reason the check reads bytes: the filename said `.png`.
    const html = new TextEncoder().encode('<!DOCTYPE html><script>fetch("/steal")</script>');
    expect(sniffImage(html)).toBeNull();
  });

  it('refuses a PDF, which is the file a student is most likely to pick by mistake', () => {
    expect(sniffImage(withHeader(0x25, 0x50, 0x44, 0x46, 0x2d))).toBeNull();
  });

  it('refuses anything too short to have a signature rather than reading past the end', () => {
    expect(sniffImage(new Uint8Array([]))).toBeNull();
    expect(sniffImage(new Uint8Array([0x89, 0x50]))).toBeNull();
  });

  it('is not fooled by a RIFF container that is not WebP', () => {
    // RIFF is also WAV and AVI; only the bytes at offset 8 separate them.
    const wav = withHeader(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45);
    expect(sniffImage(wav)).toBeNull();
  });
});

describe('where a figure is stored', () => {
  it('puts it under the document and chapter that own it', () => {
    const key = figureKey('doc-1', 'ch-2', 'png');
    expect(key.startsWith('figures/doc-1/ch-2/')).toBe(true);
    expect(key.endsWith('.png')).toBe(true);
  });

  it('never reuses a key, so the same filename twice does not overwrite the first', () => {
    const a = figureKey('doc-1', 'ch-2', 'png');
    const b = figureKey('doc-1', 'ch-2', 'png');
    expect(a).not.toBe(b);
  });

  it('is the prefix `link` checks against, so the two cannot drift apart', () => {
    // `FiguresService.link` refuses any key outside `figures/<documentId>/<chapterId>/`. If the
    // layout above ever changes, this is what fails rather than the authorisation silently
    // rejecting every legitimate figure.
    const key = figureKey('doc-1', 'ch-2', 'jpg');
    expect(key.startsWith(`figures/doc-1/ch-2/`)).toBe(true);
    expect(key.startsWith(`figures/doc-1/ch-OTHER/`)).toBe(false);
  });
});

describe('how large a figure may be', () => {
  it('is far below the 50 MB a source PDF may be (PRD §11.3)', () => {
    expect(MAX_FIGURE_BYTES).toBe(8 * 1024 * 1024);
    expect(MAX_FIGURE_BYTES).toBeLessThan(50 * 1024 * 1024);
  });
});
