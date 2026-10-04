/**
 * Object storage — PRD §7.2 (MinIO, S3 API) and §7.5 ("all files are in object storage").
 *
 * One client for the whole API. PDFs, exports and chapter snapshots all live here, so the app
 * stays stateless and the worker can move to a second host without code changes (§7.5 step 2).
 */

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Env } from '@tc/config';
import { Client as MinioClient } from 'minio';
import { ENV } from './env.token.js';

/** How long a download link stays valid. Long enough to open a PDF, short enough not to leak. */
export const SIGNED_URL_TTL_SECONDS = 15 * 60;

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: MinioClient;
  /**
   * Signs the links a browser opens. The same credentials as `client`, but the host a browser can
   * reach (`S3_PUBLIC_URL`) — a presigned URL's signature covers its host, so it must be signed
   * for the one it will be requested at. With the region set, signing makes no network call.
   */
  private readonly signer: MinioClient;
  readonly bucket: string;

  constructor(@Inject(ENV) env: Env) {
    this.bucket = env.S3_BUCKET;
    const clientFor = (base: string) => {
      const endpoint = new URL(base);
      return new MinioClient({
        endPoint: endpoint.hostname,
        port: Number(endpoint.port) || (endpoint.protocol === 'https:' ? 443 : 80),
        useSSL: endpoint.protocol === 'https:',
        accessKey: env.S3_ACCESS_KEY,
        secretKey: env.S3_SECRET_KEY,
        region: env.S3_REGION,
      });
    };
    this.client = clientFor(env.S3_ENDPOINT);
    this.signer = env.S3_PUBLIC_URL ? clientFor(env.S3_PUBLIC_URL) : this.client;
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucket();
  }

  /** Creates the bucket if it is missing. Not fatal at boot: `/health` reports storage separately. */
  async ensureBucket(): Promise<void> {
    try {
      if (!(await this.client.bucketExists(this.bucket))) {
        await this.client.makeBucket(this.bucket);
        this.logger.log(`created bucket ${this.bucket}`);
      }
    } catch (error) {
      this.logger.warn(`could not verify bucket ${this.bucket}: ${String(error)}`);
    }
  }

  async put(
    key: string,
    body: Buffer,
    metadata: Record<string, string> = {},
  ): Promise<{ key: string; size: number }> {
    await this.client.putObject(this.bucket, key, body, body.length, metadata);
    return { key, size: body.length };
  }

  async get(key: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  /** Every key under a prefix, oldest first by name. Used to keep the last N exports (D.3.2). */
  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    const stream = this.client.listObjectsV2(this.bucket, prefix, true);
    for await (const item of stream) {
      if (item.name) keys.push(item.name);
    }
    return keys.sort();
  }

  /**
   * How much is stored, grouped by the first part of the key (`sources`, `exports`, `figures`…).
   * Walks the whole bucket, so the admin overview caches it rather than asking on every visit.
   */
  async totals(): Promise<{
    files: number;
    bytes: number;
    byPrefix: Record<string, { files: number; bytes: number }>;
  }> {
    const byPrefix: Record<string, { files: number; bytes: number }> = {};
    let files = 0;
    let bytes = 0;
    const stream = this.client.listObjectsV2(this.bucket, '', true);
    for await (const item of stream) {
      if (!item.name) continue;
      const prefix = item.name.split('/')[0] ?? '';
      const size = item.size ?? 0;
      files += 1;
      bytes += size;
      const bucket = byPrefix[prefix] ?? { files: 0, bytes: 0 };
      bucket.files += 1;
      bucket.bytes += size;
      byPrefix[prefix] = bucket;
    }
    return { files, bytes, byPrefix };
  }

  /**
   * A server-side copy within the bucket (ADR-0057, making a copy of a thesis). The bytes never
   * pass through the API, and the object's stored metadata — its content type — comes with it.
   */
  async copy(sourceKey: string, targetKey: string): Promise<void> {
    await this.client.copyObject(this.bucket, targetKey, `/${this.bucket}/${sourceKey}`);
  }

  async remove(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.statObject(this.bucket, key);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Time-limited download link — PRD §9.2 `GET /sources/:id/file` and B.5's "Open PDF at page N".
   * The link is generated only after the caller's ownership has been checked (§12.1).
   */
  async signedUrl(key: string, ttlSeconds = SIGNED_URL_TTL_SECONDS): Promise<string> {
    return this.signer.presignedGetObject(this.bucket, key, ttlSeconds);
  }
}
