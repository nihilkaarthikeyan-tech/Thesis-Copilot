/**
 * Attachments to a chat question — ADR-0083 (row 42 of the Jenni coverage map, 2026-10-05).
 *
 * A student can hand the chat a file with the question: a picture (a figure, a table from a
 * paper, a handwritten note) or a document (PDF, Word, plain text). Nothing is added to the
 * library and nothing becomes a source: an attachment is read for this question only.
 *
 * - A picture goes to the model as an image part of the question (as ADR-0064's equation photo
 *   does), from object storage, under a key that names the thesis.
 * - A document is read here (`extractPdf`, `extractDocx`, or the text as given), cut to
 *   `MAX_TEXT_CHARS`, and goes to the model as one more passage, `Satt<n>#c1`, labelled
 *   "Attached: <name>". A.4's grounding applies as to any passage: the answer may cite it, and the
 *   citation carries the file's name, not a source — it cannot become a thesis citation.
 * - The record lives in Redis for `TTL_SECONDS`, keyed by the student and the thesis, so an id
 *   from another account or another thesis finds nothing.
 */

import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { PromptPassage } from '@tc/ai';
import { extractDocx, extractPdf } from '@tc/retrieval';
import { NotFoundError, ValidationError } from '../../common/errors.js';
import { PrismaService } from '../../common/prisma.service.js';
import { RedisService } from '../../common/redis.service.js';
import { StorageService } from '../../common/storage.service.js';
import { sniffImage } from '../chapters/figures.service.js';

export const CHAT_ATTACHMENTS = {
  /** Per question. Three is a figure, a table and a note; more is a library upload. */
  maxPerQuestion: 3,
  maxImageBytes: 5 * 1024 * 1024,
  maxDocumentBytes: 15 * 1024 * 1024,
  /** About 3,000 tokens of a document: the start of it, where the abstract and method are. */
  maxTextChars: 12_000,
  /** How long an uploaded attachment waits to be asked about. */
  ttlSeconds: 2 * 60 * 60,
} as const;

export type AttachmentKind = 'image' | 'document';

export type StoredAttachment = {
  id: string;
  userId: string;
  documentId: string;
  kind: AttachmentKind;
  name: string;
  /** Object-storage key of a picture. */
  key?: string;
  mediaType?: string;
  /** The text of a document, already cut. */
  text?: string;
};

export type UploadedAttachment = {
  id: string;
  kind: AttachmentKind;
  name: string;
  /** Characters read from a document; absent for a picture. */
  chars?: number;
};

/** What a question's attachments add to its request. */
export type LoadedAttachments = {
  images: Array<{ data: Uint8Array; mediaType: string }>;
  passages: PromptPassage[];
  /** Passage id → the file it came from, for the citation's label. */
  byKey: Map<string, { name: string }>;
};

export const EMPTY_ATTACHMENTS: LoadedAttachments = { images: [], passages: [], byKey: new Map() };

export function attachmentPassageId(index: number): string {
  return `Satt${index + 1}#c1`;
}

const redisKey = (id: string) => `chat:attachment:${id}`;

const isPdf = (bytes: Uint8Array) =>
  bytes.length > 4 &&
  bytes[0] === 0x25 &&
  bytes[1] === 0x50 &&
  bytes[2] === 0x44 &&
  bytes[3] === 0x46;
const isZip = (bytes: Uint8Array) => bytes.length > 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;

/** A document's text as the prompt gets it: whitespace collapsed, cut at a sentence end. */
export function cutText(text: string, max: number = CHAT_ATTACHMENTS.maxTextChars): string {
  const clean = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (clean.length <= max) return clean;
  const head = clean.slice(0, max);
  const end = head.lastIndexOf('. ');
  return (end > max * 0.6 ? head.slice(0, end + 1) : head).trim();
}

@Injectable()
export class ChatAttachmentsService {
  private readonly logger = new Logger(ChatAttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  async upload(
    userId: string,
    documentId: string,
    filename: string,
    bytes: Uint8Array,
  ): Promise<UploadedAttachment> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId: userId },
      select: { id: true },
    });
    if (!document) throw new NotFoundError('That document');
    if (bytes.length === 0) throw new ValidationError('That file is empty.');
    const name =
      filename
        .replace(/[\r\n\t]/g, ' ')
        .trim()
        .slice(0, 120) || 'attachment';
    const id = randomUUID();

    const image = sniffImage(bytes);
    if (image) {
      if (bytes.length > CHAT_ATTACHMENTS.maxImageBytes) {
        throw new ValidationError('A picture may be up to 5 MB.');
      }
      const key = `chat-attachments/${documentId}/${id}.${image.ext}`;
      await this.storage.put(key, Buffer.from(bytes), { 'content-type': image.mime });
      await this.remember({
        id,
        userId,
        documentId,
        kind: 'image',
        name,
        key,
        mediaType: image.mime,
      });
      this.logger.log({ documentId, bytes: bytes.length }, 'chat attachment: picture');
      return { id, kind: 'image', name };
    }

    if (bytes.length > CHAT_ATTACHMENTS.maxDocumentBytes) {
      throw new ValidationError('A document may be up to 15 MB.');
    }
    let text: string;
    if (isPdf(bytes)) {
      const extracted = await extractPdf(bytes);
      text = extracted.pages.map((p) => p.text).join('\n\n');
    } else if (isZip(bytes) && /\.docx$/i.test(name)) {
      text = (await extractDocx(bytes)).text;
    } else if (/\.(txt|md|csv|tex|rtf)$/i.test(name) || looksLikeText(bytes)) {
      text = Buffer.from(bytes).toString('utf8');
    } else {
      throw new ValidationError(
        'Attach a picture (PNG, JPEG, GIF), a PDF, a Word file or a text file.',
      );
    }
    const cut = cutText(text);
    if (!/\p{L}{3}/u.test(cut)) {
      throw new ValidationError('Nothing readable was found in that file.');
    }
    await this.remember({ id, userId, documentId, kind: 'document', name, text: cut });
    this.logger.log({ documentId, chars: cut.length }, 'chat attachment: document');
    return { id, kind: 'document', name, chars: cut.length };
  }

  /**
   * The attachments a question names, as the request takes them. An id that is unknown, expired,
   * another student's or another thesis's is refused: the question should not go out with less
   * than the student attached.
   */
  async load(
    userId: string,
    documentId: string,
    ids: readonly string[],
  ): Promise<LoadedAttachments> {
    if (ids.length === 0) return EMPTY_ATTACHMENTS;
    if (ids.length > CHAT_ATTACHMENTS.maxPerQuestion) {
      throw new ValidationError(
        `Attach up to ${CHAT_ATTACHMENTS.maxPerQuestion} files to a question.`,
      );
    }
    const out: LoadedAttachments = { images: [], passages: [], byKey: new Map() };
    for (const id of [...new Set(ids)]) {
      const raw = await this.redis.client.get(redisKey(id));
      const stored = raw ? (JSON.parse(raw) as StoredAttachment) : null;
      if (!stored || stored.userId !== userId || stored.documentId !== documentId) {
        throw new ValidationError('An attachment has expired or is not yours. Attach it again.');
      }
      if (stored.kind === 'image' && stored.key && stored.mediaType) {
        const data = new Uint8Array(await this.storage.get(stored.key));
        out.images.push({ data, mediaType: stored.mediaType });
      } else if (stored.kind === 'document' && stored.text) {
        const passageId = attachmentPassageId(out.passages.length);
        out.passages.push({
          id: passageId,
          shortRef: `Attached: ${stored.name}`,
          page: null,
          text: stored.text,
        });
        out.byKey.set(passageId, { name: stored.name });
      }
    }
    return out;
  }

  private async remember(record: StoredAttachment): Promise<void> {
    await this.redis.client.set(
      redisKey(record.id),
      JSON.stringify(record),
      'EX',
      CHAT_ATTACHMENTS.ttlSeconds,
    );
  }
}

/** Mostly printable: a text file without a telling extension. */
function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 2_000);
  let odd = 0;
  for (const b of sample) if (b === 0 || (b < 9 && b !== 0) || (b > 13 && b < 32)) odd++;
  return sample.length > 0 && odd / sample.length < 0.02;
}
