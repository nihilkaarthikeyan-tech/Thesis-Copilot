/**
 * A.16 cross-paper pass and the merged glossary — PHASES 6.2.
 *
 *   "two fixture papers produce a merged glossary and at least the planted overlap is flagged
 *    (human plants one)."
 *
 * The human's fixtures are pending; these plant the overlap and the terminology difference in
 * two synthetic extractions and prove the request, the schema, the mock and the merge.
 */

import { emptyExtraction, type PaperExtraction } from '@tc/types';
import { describe, expect, it } from 'vitest';
import {
  buildCrossPaperRequest,
  crossPaperSchema,
  crossPaperUserMessage,
  mergeTerminology,
  mockCrossPaperResponse,
} from '../src/builder/xpaper.js';
import { loadPrompt } from '../src/prompts.js';

const p1: PaperExtraction = {
  ...emptyExtraction(),
  title: 'Solar adoption in rural Karnataka',
  objectives: ['Measure adoption barriers'],
  methodology: 'Survey of 312 households.',
  findings: [
    { claim: 'Upfront cost was the main barrier reported.', evidence: '78% of households' },
    { claim: 'Awareness of subsidies was high.' },
  ],
  terminology: [
    { term: 'Adoption', definition: 'Installing a rooftop unit.' },
    { term: 'Barrier', definition: 'A reason a household did not install.' },
  ],
};

const p2: PaperExtraction = {
  ...emptyExtraction(),
  title: 'Rooftop PV uptake in Tamil Nadu',
  objectives: ['Explain uptake variation'],
  methodology: 'Interviews with 40 farmers.',
  findings: [
    { claim: 'Upfront cost was the main barrier reported.' },
    { claim: 'Grid reliability shaped the decision.' },
  ],
  terminology: [
    { term: 'adoption', definition: 'Signing a net-metering contract.' },
    { term: 'Net metering', definition: 'Selling surplus power to the grid.' },
  ],
};

const papers = [
  { id: 'p1', title: p1.title, extraction: p1 },
  { id: 'p2', title: p2.title, extraction: p2 },
];

describe('buildCrossPaperRequest', () => {
  it('is a Strong, temperature-0 CROSS_PAPER call with the A.16 system block and one <paper> per extraction', () => {
    const request = buildCrossPaperRequest({ papers, userId: 'u', documentId: 'd' });
    expect(request.tier).toBe('strong');
    expect(request.temperature).toBe(0);
    expect(request.action).toBe('CROSS_PAPER');
    expect(request.system.cached).toContain(loadPrompt('xpaper').system);
    const user = request.messages[0]?.content ?? '';
    expect(user).toContain('<paper id="p1" title="Solar adoption in rural Karnataka">');
    expect(user).toContain('<paper id="p2" title="Rooftop PV uptake in Tamil Nadu">');
    expect(user).toContain('- Upfront cost was the main barrier reported. [78% of households]');
    expect(user).toContain('- Adoption: Installing a rooftop unit.');
  });

  it('escapes quotes in titles so the attribute stays well-formed', () => {
    const text = crossPaperUserMessage([{ id: 'p1', title: 'A "quoted" title', extraction: p1 }]);
    expect(text).toContain('title="A &quot;quoted&quot; title"');
  });
});

describe('the mock cross-paper response', () => {
  it('flags the planted overlap and the differing definition, and invents no contradiction', () => {
    const request = buildCrossPaperRequest({ papers, userId: 'u', documentId: 'd' });
    const raw = mockCrossPaperResponse.respond({ messages: request.messages });
    const result = crossPaperSchema.parse(raw);
    expect(result.overlaps).toEqual([
      { claim: 'Upfront cost was the main barrier reported.', papers: ['p1', 'p2'] },
    ]);
    expect(result.contradictions).toEqual([]);
    expect(result.terminology).toEqual([
      {
        term: 'Adoption',
        definitions: [
          { paper: 'p1', definition: 'Installing a rooftop unit.' },
          { paper: 'p2', definition: 'Signing a net-metering contract.' },
        ],
      },
    ]);
  });
});

describe('mergeTerminology', () => {
  it('dedupes by term, keeps both definitions when they differ, and flags the entry', () => {
    const first = mergeTerminology({}, 'p1', p1.terminology);
    expect(first.conflicts).toEqual([]);
    expect(Object.keys(first.glossary)).toEqual(['Adoption', 'Barrier']);

    const second = mergeTerminology(first.glossary, 'p2', p2.terminology);
    expect(second.conflicts).toEqual(['Adoption']);
    expect(second.glossary.Adoption).toEqual({
      definition: 'Installing a rooftop unit.',
      alternatives: [{ paper: 'p2', definition: 'Signing a net-metering contract.' }],
      conflict: true,
    });
    // Case-insensitive on the term: no second "adoption" key.
    expect(Object.keys(second.glossary).sort()).toEqual(['Adoption', 'Barrier', 'Net metering']);
  });

  it('is idempotent: the same paper merged twice adds nothing', () => {
    const once = mergeTerminology({}, 'p1', p1.terminology).glossary;
    const twice = mergeTerminology(once, 'p1', p1.terminology);
    expect(twice.glossary).toEqual(once);
    expect(twice.conflicts).toEqual([]);
  });
});
