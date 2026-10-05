/** The claims map — ADR-0086: the request, the rules in code, the mock. */

import { describe, expect, it } from 'vitest';
import {
  buildClaimsMapRequest,
  CLAIMS_MAP,
  claimsMapSchema,
  mockClaimsMapResponse,
  postProcessClaimsMap,
  statusFromEvidence,
} from '../src/builder/claims.js';
import { loadPrompt } from '../src/prompts.js';

const scope = {
  workingTitle: 'Barriers to rooftop solar adoption among rural households in Karnataka',
  problemStatement: 'Why uptake stays low despite subsidies.',
  objectives: ['Identify the financial barriers'],
};
const papers = [
  {
    id: 'p1',
    title: 'Household frictions in rooftop solar adoption',
    year: 2026,
    text: 'Upfront cost and roof ownership constrain adoption.',
  },
  {
    id: 'p2',
    title: 'Financing rural solar: a survey',
    year: 2024,
    text: 'Credit access raised uptake among 312 households.',
  },
  {
    id: 'p3',
    title: 'Subsidy delivery in Karnataka',
    year: 2025,
    text: 'Delays in subsidy payment deterred applicants.',
  },
];

describe('buildClaimsMapRequest', () => {
  it('is a strong-tier CROSS_PAPER call carrying the scope and one line per paper', () => {
    const req = buildClaimsMapRequest({ scope, papers, userId: 'u', documentId: 'd' });
    expect(req.action).toBe('CROSS_PAPER');
    expect(req.tier).toBe('strong');
    expect(req.system.cached).toContain(loadPrompt('claims').system);
    const user = req.messages[0]?.content ?? '';
    expect(user).toContain('<scope>');
    expect(user).toContain(
      '<paper id="p2" year="2024">Financing rural solar: a survey — Credit access',
    );
    expect(user.match(/<paper /g)).toHaveLength(3);
  });

  it(`sends at most ${CLAIMS_MAP.maxPapers} papers, each cut to ${CLAIMS_MAP.paperChars} characters`, () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `p${i}`,
      title: `Paper ${i}`,
      year: null,
      text: 'x'.repeat(2_000),
    }));
    const user =
      buildClaimsMapRequest({ scope, papers: many, userId: 'u', documentId: 'd' }).messages[0]
        ?.content ?? '';
    expect(user.match(/<paper /g)).toHaveLength(CLAIMS_MAP.maxPapers);
    expect(user).not.toContain('x'.repeat(CLAIMS_MAP.paperChars + 1));
  });
});

describe('postProcessClaimsMap', () => {
  it('keeps only sent ids, drops a claim with no supporting paper, labels from the evidence, dedupes', () => {
    const out = postProcessClaimsMap(
      {
        claims: [
          {
            claim: 'Upfront cost is the first barrier',
            status: 'well-supported',
            supporting: ['p1', 'p2', 'p9'],
            contrasting: [],
            direction: 'Test it in Karnataka.',
            limits: 'Urban samples.',
          },
          {
            claim: 'Credit access raises uptake',
            status: 'strong',
            supporting: ['p2'],
            contrasting: ['p3', 'p2'],
            direction: '',
            limits: '',
          },
          {
            claim: 'Upfront cost is the first barrier',
            status: 'contested',
            supporting: ['p1'],
            contrasting: [],
            direction: '',
            limits: '',
          },
          {
            claim: 'Nothing supports this',
            status: 'under-explored',
            supporting: ['p9'],
            contrasting: [],
            direction: '',
            limits: '',
          },
        ],
      },
      ['p1', 'p2', 'p3'],
    );
    expect(out.claims).toHaveLength(2);
    expect(out.claims[0]).toMatchObject({
      status: 'well-supported',
      supporting: ['p1', 'p2'],
      contrasting: [],
      direction: 'Test it in Karnataka.',
    });
    // An unknown label and a paper both for and against: the evidence decides, and "for" wins.
    expect(out.claims[1]).toMatchObject({
      status: 'contested',
      supporting: ['p2'],
      contrasting: ['p3'],
    });
    expect(out.stripped).toBe(2);
  });

  it('the evidence rule', () => {
    expect(statusFromEvidence(3, 0)).toBe('well-supported');
    expect(statusFromEvidence(2, 0)).toBe('under-explored');
    expect(statusFromEvidence(5, 1)).toBe('contested');
  });

  it(`keeps at most ${CLAIMS_MAP.maxClaims}`, () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      claim: `MappedClaim ${i}`,
      status: 'under-explored',
      supporting: ['p1'],
      contrasting: [],
      direction: '',
      limits: '',
    }));
    expect(postProcessClaimsMap({ claims: many }, ['p1']).claims).toHaveLength(
      CLAIMS_MAP.maxClaims,
    );
  });
});

describe('the mock', () => {
  it('answers from the papers it was given, with the three statuses', () => {
    const req = buildClaimsMapRequest({ scope, papers, userId: 'u', documentId: 'd' });
    expect(mockClaimsMapResponse.match(req)).toBe(true);
    const result = claimsMapSchema.parse(mockClaimsMapResponse.respond(req));
    const out = postProcessClaimsMap(result, ['p1', 'p2', 'p3']);
    expect(out.claims.map((c) => c.status)).toEqual([
      'well-supported',
      'contested',
      'under-explored',
    ]);
    expect(out.claims[0]?.supporting).toEqual(['p1', 'p2', 'p3']);
    expect(out.claims[1]?.contrasting).toEqual(['p3']);
    expect(out.stripped).toBe(0);
  });
});
