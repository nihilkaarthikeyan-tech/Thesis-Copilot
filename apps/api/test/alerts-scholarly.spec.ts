/**
 * ADR-0149: the admin is told before OpenAlex starts refusing — at 70% and 90% of the key's free
 * daily budget — and when an index is refusing. Unit-level: the day's count and the indexes'
 * state are handed in, so nothing here touches Redis or the network.
 */

import type { IndexState, OpenAlexDay } from '@tc/retrieval';
import { describe, expect, it } from 'vitest';
import { AlertsService } from '../src/modules/admin/alerts.service.js';

const service = () =>
  new AlertsService(
    {} as never,
    { send: async () => undefined } as never,
    { SEED_ADMIN_EMAIL: 'admin@example.test' } as never,
    {} as never,
  );

const day = (searches: number): OpenAlexDay => ({
  date: '2026-10-10',
  searches,
  lists: 0,
  lookups: 40,
  keyed: searches,
  usd: searches * 0.001,
  shareOfKeyedBudget: searches * 0.001,
});

const healthy = async (): Promise<IndexState[]> => [];
const now = new Date('2026-10-10T18:00:00Z');

describe('scholarly alerts (ADR-0149)', () => {
  it('is quiet below 70% of the day', async () => {
    const out = await service().scholarlyBreaches(now, {
      today: async () => day(699),
      states: healthy,
    });
    expect(out).toEqual([]);
  });

  it('warns at 70%, and only the higher warning is open at 90%', async () => {
    const at70 = await service().scholarlyBreaches(now, {
      today: async () => day(700),
      states: healthy,
    });
    expect(at70.map((b) => b.kind)).toEqual(['OPENALEX_BUDGET_70']);
    expect(at70[0]?.detail).toContain('700 searches');
    const at90 = await service().scholarlyBreaches(now, {
      today: async () => day(905),
      states: healthy,
    });
    expect(at90.map((b) => b.kind)).toEqual(['OPENALEX_BUDGET_90']);
  });

  it('reports a spent key and a refusing index', async () => {
    const out = await service().scholarlyBreaches(now, {
      today: async () => day(1000),
      states: async () => [
        {
          service: 'openalex',
          keyedExhaustedUntil: Date.parse('2026-10-11T00:00:00Z'),
          refusedUntil: null,
          refusingSince: null,
          reason: 'Rate limit exceeded: Insufficient budget',
        },
        {
          service: 'semanticscholar',
          keyedExhaustedUntil: null,
          refusedUntil: now.getTime() + 60_000,
          refusingSince: now.getTime() - 20 * 60_000,
          reason: 'Too Many Requests',
        },
      ],
    });
    expect(out.map((b) => b.kind)).toEqual([
      'OPENALEX_BUDGET_90',
      'OPENALEX_KEY_SPENT',
      'INDEX_REFUSING',
    ]);
    expect(out[2]?.detail).toContain('semanticscholar has refused every request for 20 min');
  });

  it('a Redis fault is not an alert and does not stop the others', async () => {
    const out = await service().scholarlyBreaches(now, {
      today: async () => {
        throw new Error('ECONNREFUSED');
      },
      states: healthy,
    });
    expect(out).toEqual([]);
  });
});
