/**
 * Chapter snapshots — PRD Appendix B.7 and §8 `DocumentVersion` ("MinIO key (gzipped JSON)").
 *
 * A snapshot is written when ≥ 10 minutes have passed since the last one and the content changed,
 * on Ctrl/Cmd+S, and before draft accept / scoped revision. Object storage holds the body; the
 * `DocumentVersion` row holds the key and the reason.
 */

import { gzipSync } from 'node:zlib';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Env } from '@tc/config';
import { Client as MinioClient } from 'minio';
import { ENV } from '../../common/env.token.js';
import { PrismaService } from '../../common/prisma.service.js';

export const SNAPSHOT_REASONS = ['AUTOSAVE', 'MANUAL', 'PRE_DRAFT_ACCEPT', 'PRE_REVISION'] as const;
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
      },
      select: { id: true, snapshotKey: true, createdAt: true },
    });

    await this.prisma.chapter.update({
      where: { id: input.chapterId },
      data: { snapshotAt: row.createdAt },
    });

    return row;
  }

  /** B.7 rule: snapshot only if the last one is older than the interval (or there is none). */
  isDue(snapshotAt: Date | null, now = new Date()): boolean {
    return !snapshotAt || now.getTime() - snapshotAt.getTime() >= SNAPSHOT_INTERVAL_MS;
  }
}
