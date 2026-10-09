/**
 * ADR-0133 (2026-10-09 fix): what an edit's literature search asks and what it keeps.
 */

import { describe, expect, it } from 'vitest';
import {
  EDIT_SEARCH,
  editSearchContext,
  editSearchPlan,
  keepRelevant,
  namesNothing,
} from '../src/index.js';

const LIVE =
  'Many rural households in Karnataka have not installed rooftop solar panels even though subsidies exist. The upfront cost and access to credit appear to matter.';

describe('editSearchPlan', () => {
  it('searches the subject, not the instruction (the live run searched "add published claim …")', () => {
    const plan = editSearchPlan({
      selection: LIVE,
      instruction: 'Add evidence from published studies for each claim',
    });
    expect(plan.keyword[0]).toBe('rural households karnataka installed rooftop solar panels even');
    for (const q of plan.keyword) expect(q).not.toMatch(/\b(add|published|claim)\b/);
    // Relevance is the subject alone; the semantic search also hears the instruction.
    expect(plan.relevance).toBe(LIVE);
    expect(plan.semantic).toContain('Add evidence from published studies');
  });

  it('borrows the instruction only when the selection names too little', () => {
    const plan = editSearchPlan({
      selection: 'This is true {{cite:S1#c1}}.',
      instruction: 'Add evidence on groundwater recharge in hard rock aquifers',
    });
    expect(plan.keyword[0]).toContain('groundwater recharge');
  });

  it('leads with the thesis and the chapter when they name something', () => {
    const context = editSearchContext({
      thesisTitle: 'Fly ash as partial cement replacement in concrete',
      chapterTitle: 'Chapter 2',
      scopeNote: 'Durability under chloride attack.',
    });
    expect(context).toBe(
      'Fly ash as partial cement replacement in concrete. Durability under chloride attack.',
    );
    const plan = editSearchPlan({ selection: 'Strength falls early.', context });
    expect(plan.relevance.startsWith(context)).toBe(true);
    expect(plan.semantic.startsWith(context)).toBe(true);
  });

  it('an untitled thesis and an unnamed chapter add nothing', () => {
    expect(namesNothing('Untitled thesis')).toBe(true);
    expect(namesNothing('Chapter 3')).toBe(true);
    expect(namesNothing('Literature Review')).toBe(false);
    expect(editSearchContext({ thesisTitle: 'Untitled thesis', chapterTitle: 'Chapter 1' })).toBe(
      '',
    );
  });
});

describe('keepRelevant — the measured rule', () => {
  it('drops the live run’s off-field paper and keeps the on-topic ones, five at most', () => {
    // Cosines from the 2026-10-09 run (ADR-0133).
    const scored = [
      { title: 'The Last Mile of a Subsidy', cosine: 0.779 },
      { title: 'Government Subsidies on Household Adoption', cosine: 0.765 },
      { title: 'Barriers to rooftop solar PV adoption', cosine: 0.716 },
      { title: 'Household solar adoption in Kerala', cosine: 0.685 },
      { title: 'Demand for off-grid solar, Rwanda', cosine: 0.654 },
      { title: 'Solar PV for primary health care', cosine: 0.574 },
    ];
    expect(keepRelevant(scored).map((s) => s.title)).toEqual([
      'The Last Mile of a Subsidy',
      'Government Subsidies on Household Adoption',
      'Barriers to rooftop solar PV adoption',
      'Household solar adoption in Kerala',
    ]);
  });

  it('keeps nothing when only weak candidates came back', () => {
    expect(keepRelevant([{ cosine: 0.62 }, { cosine: 0.615 }, { cosine: 0.574 }])).toEqual([]);
  });

  it('drops a paper on a neighbouring question well below the best', () => {
    const kept = keepRelevant([
      { id: 'a', cosine: 0.89 },
      { id: 'b', cosine: 0.84 },
      { id: 'c', cosine: 0.69 },
    ]);
    expect(kept.map((k) => k.id)).toEqual(['a', 'b']);
    expect(EDIT_SEARCH.maxPapers).toBe(5);
  });
});
