/**
 * Feature flags — PRD §0.2: "Simple DB-backed flags table (`FeatureFlag`), read at request time,
 * cached 60 s." FR-9.7 names the four flags.
 */

import { Injectable } from '@nestjs/common';
import type { PrismaService } from '../../common/prisma.service.js';

const CACHE_TTL_MS = 60_000;

@Injectable()
export class FlagsService {
  private cache: Map<string, boolean> = new Map();
  private loadedAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(key: string): Promise<boolean> {
    await this.refreshIfStale();
    return this.cache.get(key) ?? false;
  }

  async all(): Promise<Record<string, boolean>> {
    await this.refreshIfStale();
    return Object.fromEntries(this.cache);
  }

  /** Used by the admin UI after a toggle, so the change is visible immediately. */
  invalidate(): void {
    this.loadedAt = 0;
  }

  private async refreshIfStale(): Promise<void> {
    if (Date.now() - this.loadedAt < CACHE_TTL_MS) return;

    const rows = await this.prisma.featureFlag.findMany({
      select: { key: true, enabled: true },
    });
    this.cache = new Map(rows.map((r) => [r.key, r.enabled]));
    this.loadedAt = Date.now();
  }
}
