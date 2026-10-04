/**
 * docs/i18n/hi-review.md is the native speaker's checklist (ADR-0061, docs/PENDING.md). It must
 * list exactly what `hi.ts` says, so it is generated, and this test fails when it is stale.
 * `UPDATE_I18N_REVIEW=1 pnpm --filter @tc/web test` rewrites it.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hi } from '../src/i18n/hi';
import { reviewSheet } from '../src/i18n/review';

const SHEET = resolve(__dirname, '../../../docs/i18n/hi-review.md');

describe('the Hindi review sheet', () => {
  it('lists every translated string as the catalogue has it', () => {
    const expected = reviewSheet('हिन्दी', hi);
    if (process.env.UPDATE_I18N_REVIEW) writeFileSync(SHEET, expected, 'utf8');
    expect(readFileSync(SHEET, 'utf8').replaceAll('\r\n', '\n')).toBe(expected);
  });
});
