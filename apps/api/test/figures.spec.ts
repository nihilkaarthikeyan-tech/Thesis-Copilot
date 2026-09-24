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
import { ownsFigureKey, withFreshFigureLinks } from '../src/common/figure-links.js';
import type { StorageService } from '../src/common/storage.service.js';
import {
  describeRejection,
  figureKey,
  MAX_FIGURE_BYTES,
  sniffImage,
} from '../src/modules/chapters/figures.service.js';
import { loadFigures } from '../src/modules/export/figure-bytes.js';

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

  it('is owned by its document and no other, the rule `link`, reads and exports check', () => {
    // If the layout above ever changes, this is what fails rather than the authorisation
    // silently rejecting every legitimate figure.
    const key = figureKey('doc-1', 'ch-2', 'jpg');
    expect(ownsFigureKey('doc-1', key)).toBe(true);
    expect(ownsFigureKey('doc-2', key)).toBe(false);
    expect(ownsFigureKey('doc-1', 'sources/doc-1/paper.pdf')).toBe(false);
    expect(ownsFigureKey('doc-1', 'figures/doc-1/../doc-2/x.png')).toBe(false);
  });
});

describe('the link a figure is shown with', () => {
  const image = (key: string, src = 'http://old/expired') => ({
    type: 'image',
    attrs: { key, src, alt: '' },
  });

  it('is minted afresh on every read, for figures at any depth', async () => {
    // Stored links last fifteen minutes; one saved on 09-21 answered 403 on 09-24.
    const content = {
      type: 'doc',
      content: [
        image('figures/doc-1/ch-1/a.png'),
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [{ type: 'tableCell', content: [image('figures/doc-1/ch-2/b.png')] }],
            },
          ],
        },
      ],
    };
    await withFreshFigureLinks(content, 'doc-1', async (key) => `https://signed/${key}`);
    expect(JSON.stringify(content)).not.toContain('http://old/expired');
    expect(JSON.stringify(content)).toContain('https://signed/figures/doc-1/ch-2/b.png');
  });

  it('is never signed for a key another document owns', async () => {
    const content = { type: 'doc', content: [image('figures/doc-2/ch-9/theirs.png')] };
    const signed: string[] = [];
    await withFreshFigureLinks(content, 'doc-1', async (key) => {
      signed.push(key);
      return `https://signed/${key}`;
    });
    expect(signed).toEqual([]);
    expect(content.content[0]?.attrs.src).toBe('http://old/expired');
  });
});

describe('how large a figure may be', () => {
  it('is far below the 50 MB a source PDF may be (PRD §11.3)', () => {
    expect(MAX_FIGURE_BYTES).toBe(8 * 1024 * 1024);
    expect(MAX_FIGURE_BYTES).toBeLessThan(50 * 1024 * 1024);
  });
});

describe('the figures an export reads', () => {
  // A 1x1 PNG, enough for `imageSize` to measure.
  const png = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
      'base64',
    ),
  );

  it('are only this document’s own, whatever keys the chapter names', async () => {
    const read: string[] = [];
    const storage = {
      get: async (key: string) => {
        read.push(key);
        return Buffer.from(png);
      },
    } as unknown as StorageService;
    const content = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { key: 'figures/doc-1/ch-1/mine.png' } },
        // Another thesis's figure, named by someone who learned its key.
        { type: 'image', attrs: { key: 'figures/doc-2/ch-9/theirs.png' } },
      ],
    };
    const images = await loadFigures(storage, content, 'doc-1');
    expect(read).toEqual(['figures/doc-1/ch-1/mine.png']);
    expect(Object.keys(images)).toEqual(['figures/doc-1/ch-1/mine.png']);
  });
});
