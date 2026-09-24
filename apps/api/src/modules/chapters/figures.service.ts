/**
 * Figures inside a chapter — the storage half of the editor's "Insert figure" button.
 *
 * Added 2026-09-21 alongside the formatting toolbar. The editor has had a `ThesisImage` node and
 * an `uploadImage` command since it was built, but the command returns `false` unless it is given
 * an upload handler, and nothing ever gave it one — so the feature existed in the schema and not
 * in the product.
 *
 * Deliberately **not** a `Source`. A figure is the student's own illustration: it is not cited, it
 * is not retrievable, it is not indexed, and it must not appear in the library or count against
 * the library quota. It is a file that belongs to one chapter and is written into the `.docx` at
 * export. The only thing it shares with a source is the bucket.
 *
 * The URL handed back is a signed GET, so the object stays private — the same treatment every
 * other artefact in this product gets (§12.1). It expires, which is fine and is the reason the
 * node also stores `key`: the editor renders from `src`, and anything that needs the image later
 * (export, a reload the next day) re-signs from the key rather than trusting a stale link.
 */

import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { ownsFigureKey } from '../../common/figure-links.js';
import { PrismaService } from '../../common/prisma.service.js';
import { StorageService } from '../../common/storage.service.js';

/** The subset of `docx`'s `ImageRun` types a figure is allowed to be. */
export type DocxImageExt = 'png' | 'jpg' | 'gif';

/**
 * What a figure may be.
 *
 * An allow-list, checked against the **bytes** rather than the filename or the browser's
 * content-type — both of those are supplied by whoever is uploading, so neither is evidence.
 *
 * The list is exactly what `docx`'s `ImageRun` can embed (`"jpg" | "png" | "gif" | "bmp"`,
 * verified in `node_modules/docx/dist/index.d.ts`), and that is the whole rule: **a figure that
 * cannot reach the `.docx` must not be insertable.** Letting a student place an image that looks
 * right in the editor and silently becomes "[image]" in the file they submit is worse than
 * refusing it while they still have the original to convert.
 *
 * That excludes WebP, which is otherwise a perfectly good format and is what a modern browser
 * hands you when you save a picture — hence the specific advice in the rejection message. It also
 * excludes SVG, for a second and independent reason given at `sniffImage`.
 */
const SIGNATURES: ReadonlyArray<{
  mime: string;
  ext: DocxImageExt;
  match: (b: Uint8Array) => boolean;
}> = [
  {
    mime: 'image/png',
    ext: 'png',
    match: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/gif',
    ext: 'gif',
    match: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  },
];

/** Signatures we recognise well enough to name in a refusal, but cannot put into a `.docx`. */
const UNEXPORTABLE: ReadonlyArray<{
  name: string;
  advice: string;
  match: (b: Uint8Array) => boolean;
}> = [
  {
    name: 'WebP',
    advice: 'Save it as PNG or JPEG and insert that.',
    // RIFF....WEBP
    match: (b) =>
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
  {
    name: 'SVG',
    advice: 'Export it as PNG at the size you want it printed, and insert that.',
    match: (b) => {
      const head = new TextDecoder().decode(b.slice(0, 256)).trimStart().toLowerCase();
      return head.startsWith('<svg') || head.startsWith('<?xml');
    },
  },
];

/** Names the format when we can, so the student is told what to do instead of just "no". */
export function describeRejection(bytes: Uint8Array): string {
  const known = UNEXPORTABLE.find((f) => f.match(bytes));
  if (known) {
    return `A ${known.name} image cannot be placed in a Word document. ${known.advice}`;
  }
  return 'That does not look like a PNG, JPEG or GIF image.';
}

/** PRD §11.3 caps a source PDF at 50 MB; a figure has no reason to be anywhere near that. */
export const MAX_FIGURE_BYTES = 8 * 1024 * 1024;

export function figureKey(documentId: string, chapterId: string, ext: string): string {
  return `figures/${documentId}/${chapterId}/${randomUUID()}.${ext}`;
}

/**
 * Identifies the format from the leading bytes.
 *
 * SVG would be excluded by the export rule above on its own, but it is worth saying that it would
 * be excluded anyway: it is a document, not an image. It can carry `<script>` and external
 * references, and it would be served from our own origin behind a signed URL — so accepting one
 * is accepting stored XSS in a thesis that gets shared with a supervisor. The three formats above
 * cannot execute anything.
 */
export function sniffImage(bytes: Uint8Array): { mime: string; ext: DocxImageExt } | null {
  const found = SIGNATURES.find((s) => bytes.length >= 12 && s.match(bytes));
  return found ? { mime: found.mime, ext: found.ext } : null;
}

@Injectable()
export class FiguresService {
  private readonly logger = new Logger(FiguresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async upload(input: {
    ownerId: string;
    chapterId: string;
    filename: string;
    bytes: Uint8Array;
  }): Promise<{ key: string; url: string }> {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: input.chapterId, document: { ownerId: input.ownerId } },
      select: { id: true, documentId: true },
    });
    if (!chapter) throw new NotFoundError('That chapter');

    if (input.bytes.length === 0) throw new ValidationError('That file is empty.');
    if (input.bytes.length > MAX_FIGURE_BYTES) {
      throw new ValidationError(
        `A figure may be up to ${Math.floor(MAX_FIGURE_BYTES / (1024 * 1024))} MB. That one is larger.`,
      );
    }

    const kind = sniffImage(input.bytes);
    if (!kind) {
      throw new ValidationError(describeRejection(input.bytes));
    }

    const key = figureKey(chapter.documentId, chapter.id, kind.ext);
    await this.storage.put(key, Buffer.from(input.bytes), { 'content-type': kind.mime });
    this.logger.log({ chapterId: chapter.id, bytes: input.bytes.length }, 'figure uploaded');

    return { key, url: await this.storage.signedUrl(key) };
  }

  /** Re-signs a figure the chapter already holds, for a reload after the first link expired. */
  async link(ownerId: string, chapterId: string, key: string): Promise<{ url: string }> {
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: chapterId, document: { ownerId } },
      select: { documentId: true },
    });
    if (!chapter) throw new NotFoundError('That chapter');
    // The key is client-supplied, so it is checked against the path this document is allowed to
    // read rather than trusted. Without this, any key in the bucket would be signable by anyone.
    // The document, not the chapter: a figure moved to another chapter keeps its key, and the
    // chapter read re-signs by the same rule (`withFreshFigureLinks`).
    if (!ownsFigureKey(chapter.documentId, key)) throw new NotFoundError('That figure');
    if (!(await this.storage.exists(key))) throw new NotFoundError('That figure');
    return { url: await this.storage.signedUrl(key) };
  }
}
