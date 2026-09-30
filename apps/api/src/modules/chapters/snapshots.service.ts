/**
 * Chapter snapshots — PRD Appendix B.7 and §8 `DocumentVersion` ("MinIO key (gzipped JSON)").
 *
 * A snapshot is written when ≥ 10 minutes have passed since the last one and the content changed,
 * on Ctrl/Cmd+S, and before draft accept / scoped revision. Object storage holds the body; the
 * `DocumentVersion` row holds the key and the reason.
 */

import { gunzipSync, gzipSync } from 'node:zlib';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Env } from '@tc/config';
import { Client as MinioClient } from 'minio';
import { ENV } from '../../common/env.token.js';
import { PrismaService } from '../../common/prisma.service.js';
import { totalWords, wordCountsOf } from './word-counts.js';

export const SNAPSHOT_REASONS = [
  'AUTOSAVE',
  'MANUAL',
  'PRE_DRAFT_ACCEPT',
  'PRE_REVISION',
  // Written before a restore overwrites the chapter, so a restore is itself one click from undone.
  'PRE_RESTORE',
  // ADR-0039: written before a chapter build appends its draft blocks to the chapter.
  'PRE_CHAPTER_BUILD',
] as const;
export type SnapshotReason = (typeof SNAPSHOT_REASONS)[number];

/** B.7: a periodic snapshot at most every ten minutes. */
export const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;

@Injectable()
export class SnapshotsService implements OnModuleInit {
  private readonly logger = new Logger(SnapshotsService.name);
  private readonly minio: MinioClient;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) env: Env,
  ) {
    const endpoint = new URL(env.S3_ENDPOINT);
    this.bucket = env.S3_BUCKET;
    this.minio = new MinioClient({
      endPoint: endpoint.hostname,
      port: Number(endpoint.port) || (endpoint.protocol === 'https:' ? 443 : 80),
      useSSL: endpoint.protocol === 'https:',
      accessKey: env.S3_ACCESS_KEY,
      secretKey: env.S3_SECRET_KEY,
      region: env.S3_REGION,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      if (!(await this.minio.bucketExists(this.bucket))) {
        await this.minio.makeBucket(this.bucket);
        this.logger.log(`created bucket ${this.bucket}`);
      }
    } catch (error) {
      // Not fatal at boot: /health reports object storage, and the first snapshot will retry.
      this.logger.warn(`could not verify bucket ${this.bucket}: ${String(error)}`);
    }
  }

  async write(input: {
    documentId: string;
    chapterId: string;
    content: unknown;
    reason: SnapshotReason;
    /** The chapter's length at this version, so the history list can tell versions apart. */
    wordCount?: number;
  }): Promise<{ id: string; snapshotKey: string; createdAt: Date }> {
    const key = `snapshots/${input.documentId}/${input.chapterId}/${Date.now()}-${input.reason.toLowerCase()}.json.gz`;
    const body = gzipSync(Buffer.from(JSON.stringify(input.content), 'utf8'));

    await this.minio.putObject(this.bucket, key, body, body.length, {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
    });

    const row = await this.prisma.documentVersion.create({
      data: {
        documentId: input.documentId,
        chapterId: input.chapterId,
        snapshotKey: key,
        reason: input.reason,
        // Counted here rather than trusted to every caller: four places write snapshots, and a
        // history list with a length on some rows and not others is a list nobody can compare.
        wordCount: input.wordCount ?? totalWords(wordCountsOf(input.content)),
      },
      select: { id: true, snapshotKey: true, createdAt: true },
    });

    await this.prisma.chapter.update({
      where: { id: input.chapterId },
      data: { snapshotAt: row.createdAt },
    });

    return row;
  }

  /**
   * A snapshot's body, as the ProseMirror document it was.
   *
   * Stored gzipped (`write` sets `Content-Encoding` as metadata, but MinIO hands back the bytes it
   * was given, so nothing decompresses them on the way out). The magic-number check keeps an
   * object written some other way readable rather than failing inside `gunzip`.
   */
  async read(key: string): Promise<unknown> {
    const stream = await this.minio.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const gzipped = body.length > 2 && body[0] === 0x1f && body[1] === 0x8b;
    return JSON.parse((gzipped ? gunzipSync(body) : body).toString('utf8'));
  }

  /** B.7 rule: snapshot only if the last one is older than the interval (or there is none). */
  isDue(snapshotAt: Date | null, now = new Date()): boolean {
    return !snapshotAt || now.getTime() - snapshotAt.getTime() >= SNAPSHOT_INTERVAL_MS;
  }
}
