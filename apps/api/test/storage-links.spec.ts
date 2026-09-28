/**
 * Download links a browser can open (2026-09-28).
 *
 * Production reaches MinIO as `http://minio:9000`, a Compose-network name. Every export, figure,
 * invoice and "Open PDF" link was signed for that host, so on the live site none of them opened —
 * and nothing caught it, because in development and CI the browser can reach MinIO directly.
 * `S3_PUBLIC_URL` signs them for the site's own origin instead. Signing is local (the region is
 * configured), so these tests need no running MinIO.
 */

import type { Env } from '@tc/config';
import { describe, expect, it } from 'vitest';
import { StorageService } from '../src/common/storage.service.js';

const base = {
  S3_ENDPOINT: 'http://minio:9000',
  S3_ACCESS_KEY: 'access-key',
  S3_SECRET_KEY: 'secret-key-for-tests',
  S3_BUCKET: 'thesis-copilot',
  S3_REGION: 'us-east-1',
} as unknown as Env;

describe('StorageService.signedUrl', () => {
  it('signs for the public origin when one is set', async () => {
    const storage = new StorageService({ ...base, S3_PUBLIC_URL: 'https://thesis.rademics.ai' });
    const link = new URL(await storage.signedUrl('exports/doc/thesis.docx'));
    expect(link.origin).toBe('https://thesis.rademics.ai');
    expect(link.pathname).toBe('/thesis-copilot/exports/doc/thesis.docx');
    expect(link.searchParams.get('X-Amz-Signature')).toBeTruthy();
  });

  it('keeps signing for the endpoint when no public origin is set', async () => {
    const storage = new StorageService(base);
    expect(new URL(await storage.signedUrl('figures/doc/f.png')).origin).toBe('http://minio:9000');
  });

  it('never puts the internal host in a public link', async () => {
    const storage = new StorageService({ ...base, S3_PUBLIC_URL: 'https://thesis.rademics.ai' });
    expect(await storage.signedUrl('sources/doc/paper.pdf')).not.toContain('minio');
  });
});
