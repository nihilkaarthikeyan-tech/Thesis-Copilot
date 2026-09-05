/**
 * `pnpm pilot:report` — PHASES 5.10. The arithmetic, without a database: words by provenance
 * from a ProseMirror document, and the percentile the TTFB figures use.
 */

import { describe, expect, it } from 'vitest';
import { percentile, renderReport, wordsByProvenance } from '../scripts/pilot-report.js';

const mark = (kind: string) => [{ type: 'provenance', attrs: { kind, actionId: null } }];

describe('wordsByProvenance', () => {
  it('counts words per kind and treats unmarked text as HUMAN (B.4)', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Prior studies found ' },
            { type: 'text', text: 'that cost was the barrier.', marks: mark('ASSIST') },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'A drafted section of six words.', marks: mark('DRAFT') },
            { type: 'text', text: ' Edited.', marks: mark('HUMAN_EDITED') },
            { type: 'citation', attrs: { key: 'kumar2021' } },
          ],
        },
      ],
    };
    expect(wordsByProvenance(doc)).toEqual({
      HUMAN: 3,
      ASSIST: 5,
      DRAFT: 6,
      COMMAND: 0,
      HUMAN_EDITED: 1,
    });
  });

  it('is zero everywhere for an empty or absent document', () => {
    expect(wordsByProvenance(null).HUMAN).toBe(0);
    expect(wordsByProvenance({ type: 'doc', content: [] }).ASSIST).toBe(0);
  });
});

describe('percentile', () => {
  it('is null with no samples, the max at p100, the nearest-rank value otherwise', () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile([300], 95)).toBe(300);
    const twenty = Array.from({ length: 20 }, (_, i) => (i + 1) * 10);
    expect(percentile(twenty, 50)).toBe(100);
    expect(percentile(twenty, 95)).toBe(190);
    expect(percentile(twenty, 100)).toBe(200);
  });
});

describe('renderReport', () => {
  it('prints one line per student and the platform block', () => {
    const text = renderReport({
      period: '2026-09',
      students: [
        {
          email: 'a@example.com',
          plan: 'FREE_TRIAL',
          documents: 1,
          words: { HUMAN: 120, ASSIST: 30, DRAFT: 0, COMMAND: 0, HUMAN_EDITED: 4 },
          assist: { shown: 10, accepted: 6, partial: 1, rate: 70 },
          draft: { accepted: 1, discarded: 0 },
          ttfbMs: { p50: 280, p95: 410 },
          costInr: 3.25,
          capExceeded: 2,
        },
      ],
      platform: {
        students: 1,
        words: { HUMAN: 120, ASSIST: 30, DRAFT: 0, COMMAND: 0, HUMAN_EDITED: 4 },
        costInr: 3.25,
        calls: 12,
        failedCalls: 0,
        hallucinatedCites: 0,
        capExceeded: 2,
        ttfbMs: { p50: 280, p95: 410 },
      },
    });
    expect(text).toContain('period 2026-09');
    expect(text).toContain('a@example.com');
    expect(text).toMatch(/70\s+1\/0\s+280 ms\s+410 ms\s+3\.25\s+2/);
    expect(text).toContain('cap-exceeded        2');
  });
});
