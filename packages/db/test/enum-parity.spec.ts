/**
 * The `AiAction` list in `packages/config` drives plan caps and the cost model; the `AiAction` enum
 * in `schema.prisma` drives the database columns. They are two hand-maintained copies of one list
 * from PRD §8, so this test fails the build the moment they diverge.
 */

import { AI_ACTIONS } from '@tc/config';
import { describe, expect, it } from 'vitest';
import { AI_ACTION_VALUES } from '../src/enums.js';

describe('AiAction parity between schema.prisma and packages/config', () => {
  it('contains the same members', () => {
    expect([...AI_ACTION_VALUES].sort()).toEqual([...AI_ACTIONS].sort());
  });

  it('is declared in the same order as PRD §8', () => {
    expect([...AI_ACTION_VALUES]).toEqual([...AI_ACTIONS]);
  });
});
