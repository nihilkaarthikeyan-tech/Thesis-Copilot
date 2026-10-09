/**
 * ADR-0138 (R5b): sub-sections added in code after A.9, from the plan's own titles. The titles
 * below are real title-only plans from the outline rounds (eval/results/outline-h3d-*.json).
 */

import type { OutlineNode } from '@tc/types';
import { describe, expect, it } from 'vitest';
import { addSubsections, splitSectionTitle } from '../src/builder/subsections.js';

describe('splitSectionTitle', () => {
  it.each([
    ['Financing, incentives and affordability', ['Financing', 'Incentives', 'Affordability']],
    ['Upfront cost, subsidies and finance', ['Upfront cost', 'Subsidies', 'Finance']],
    ['Survey instruments and interview guides', ['Survey instruments', 'Interview guides']],
    ['Population, setting and sampling', ['Population', 'Setting', 'Sampling']],
    ['Electrode materials and tool wear', ['Electrode materials', 'Tool wear']],
    ['Materials, SLM build and post-processing', ['Materials', 'SLM build', 'Post-processing']],
  ])('%s → one sub-section per named part', (title, parts) => {
    expect(splitSectionTitle(title)).toEqual(parts);
  });

  it.each([
    [
      'Technical and infrastructural constraints',
      ['Technical constraints', 'Infrastructural constraints'],
    ],
    [
      'Behavioural and psychosocial determinants of adherence',
      ['Behavioural determinants of adherence', 'Psychosocial determinants of adherence'],
    ],
    ['Policy and institutional barriers', ['Policy barriers', 'Institutional barriers']],
    [
      'Safety, environmental and ethical considerations',
      ['Safety considerations', 'Environmental considerations', 'Ethical considerations'],
    ],
    [
      'Adoption barriers: economic, institutional and technical',
      ['Economic', 'Institutional', 'Technical'],
    ],
  ])('%s → the shared noun goes to every part', (title, parts) => {
    expect(splitSectionTitle(title)).toEqual(parts);
  });

  it('does not share a noun a part does not modify', () => {
    // "Credit outcomes" would be a different thing; "influence" is not a kind-noun.
    expect(splitSectionTitle('Credit and business outcomes')).toEqual([
      'Credit',
      'Business outcomes',
    ]);
    expect(splitSectionTitle('Information, perceptions and social influence')).toEqual([
      'Information',
      'Perceptions',
      'Social influence',
    ]);
  });

  it.each([
    'Gap and how this thesis addresses it',
    'Knowledge gap and thesis contribution',
    'Summary and synthesis',
    'Research design and rationale',
    'Research design and justification',
    'Design and rationale',
    'Relationship between income and empowerment',
    'Composite versus conventional electrodes and their wear',
    'Effects of selective laser melting on microstructure and defects',
    'Research and development spending',
    'Monitoring and evaluation framework',
    'Reliability and validity',
    'Analytical methods',
    'Electrode materials',
    'Cost, finance, subsidies, awareness and trust',
  ])('%s stays one section', (title) => {
    expect(splitSectionTitle(title)).toBeNull();
  });

  it('ignores a parenthesis and reads "&" as "and"', () => {
    expect(splitSectionTitle('Cost & finance (household view)')).toEqual(['Cost', 'Finance']);
  });
});

const section = (title: string, scopeNote = '', children: OutlineNode[] = []): OutlineNode => ({
  id: `s-${title.toLowerCase().replace(/\W+/g, '-')}`,
  title,
  scopeNote,
  children,
});
const chapter = (id: string, title: string, children: OutlineNode[]): OutlineNode => ({
  id,
  title,
  scopeNote: '',
  children,
});

function plan(): OutlineNode[] {
  return [
    chapter('ch1-introduction', 'Introduction', [section('Objectives and scope')]),
    chapter('ch2-literature-review', 'Literature Review', [
      section('Rooftop solar adoption patterns in India'),
      section(
        'Financing, incentives and affordability',
        'Review studies on upfront cost and loan access. Assess how subsidies and net-metering incentives change uptake. Note where affordability is measured.',
      ),
      section('Technical and infrastructural constraints'),
      section('Gap and how this thesis addresses it'),
    ]),
    chapter('ch3-methodology', 'Methodology', [
      section('Research design and rationale'),
      section('Sample frame and data collection'),
      section('Ethics and data management'),
    ]),
    chapter('ch4-results', 'Results', [
      section('Findings on upfront cost, subsidies and finance'),
      section('Robustness and sensitivity checks'),
    ]),
    chapter('ch5-discussion', 'Discussion', [section('Policy and practical implications')]),
  ];
}

describe('addSubsections', () => {
  it('divides Literature Review and Methodology sections that name several parts', () => {
    const out = addSubsections(plan(), 'STEM_EMPIRICAL');
    const titles = (i: number) =>
      (out[i]?.children ?? []).map((s) => [s.title, s.children.map((c) => c.title)]);
    expect(titles(1)).toEqual([
      ['Rooftop solar adoption patterns in India', []],
      ['Financing, incentives and affordability', ['Financing', 'Incentives', 'Affordability']],
      [
        'Technical and infrastructural constraints',
        ['Technical constraints', 'Infrastructural constraints'],
      ],
      ['Gap and how this thesis addresses it', []],
    ]);
    expect(titles(2)).toEqual([
      ['Research design and rationale', []],
      ['Sample frame and data collection', ['Sample frame', 'Data collection']],
      ['Ethics and data management', ['Ethics', 'Data management']],
    ]);
  });

  it('keeps the Literature Review its sections: it adds, never removes or merges', () => {
    const before = plan();
    const out = addSubsections(before, 'STEM_EMPIRICAL');
    expect(out.map((c) => c.children.length)).toEqual(before.map((c) => c.children.length));
    expect(out.map((c) => c.children.map((s) => s.title))).toEqual(
      before.map((c) => c.children.map((s) => s.title)),
    );
  });

  it('never divides a section outside the Literature Review and Methodology', () => {
    const out = addSubsections(plan(), 'STEM_EMPIRICAL');
    for (const i of [0, 3, 4]) {
      for (const s of out[i]?.children ?? []) expect(s.children).toEqual([]);
    }
  });

  it('gives a sub-section the sentences of its parent note that speak of it', () => {
    const out = addSubsections(plan(), 'STEM_EMPIRICAL');
    const [financing, incentives, affordability] = out[1]?.children[1]?.children ?? [];
    expect(financing?.scopeNote).toBe('');
    expect(incentives?.scopeNote).toBe(
      'Assess how subsidies and net-metering incentives change uptake.',
    );
    expect(affordability?.scopeNote).toBe('Note where affordability is measured.');
  });

  it('gives unique slug ids under the parent', () => {
    const out = addSubsections(plan(), 'STEM_EMPIRICAL');
    const ids = out.flatMap((c) => c.children.flatMap((s) => s.children.map((g) => g.id)));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('s-financing-incentives-and-affordability-sub1-financing');
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('leaves a section the model already divided as it is', () => {
    const own = section('Financing, incentives and affordability', '', [
      section('Loans'),
      section('Subsidies'),
    ]);
    const nodes = [chapter('ch2-literature-review', 'Literature Review', [own])];
    expect(addSubsections(nodes, 'STEM_EMPIRICAL')[0]?.children[0]).toEqual(own);
  });

  it('gives a section called "Methodology" the blueprint parts, wherever it sits', () => {
    const nodes = [
      chapter('ch1-introduction', 'Introduction', [section('Research methodology')]),
      chapter('ch2-the-novels', 'The early novels', [section('Methods')]),
    ];
    const out = addSubsections(nodes);
    for (const c of out) {
      expect(c.children[0]?.children.map((g) => g.title)).toEqual([
        'Research design',
        'Data collection',
        'Analysis techniques',
      ]);
    }
  });

  it('finds the chapters by title when the template is flexible or unknown', () => {
    const nodes = [
      chapter('ch1-a-review-of-the-literature', 'A review of the literature', [
        section('Economic and social barriers'),
      ]),
      chapter('ch2-findings', 'Findings by theme', [section('Trust and awareness')]),
    ];
    const out = addSubsections(nodes);
    expect(out[0]?.children[0]?.children.map((g) => g.title)).toEqual([
      'Economic barriers',
      'Social barriers',
    ]);
    expect(out[1]?.children[0]?.children).toEqual([]);
  });

  it('divides at most three sections of a chapter: those naming the most parts, then the earliest', () => {
    const nodes = [
      chapter('ch3-methodology', 'Methodology', [
        section('Sample frame and data collection'),
        section('Survey instruments and interview guides'),
        section('Population, setting and sampling'),
        section('Qualitative fieldwork and stakeholder interviews'),
        section('Ethics and data management'),
      ]),
    ];
    const divided = addSubsections(nodes, 'STEM_EMPIRICAL')[0]?.children.map(
      (s) => s.children.length,
    );
    expect(divided).toEqual([2, 2, 3, 0, 0]);
  });

  it('drops a leading "the" from a part', () => {
    expect(splitSectionTitle('Self-help groups and the limits of credit alone')).toEqual([
      'Self-help groups',
      'Limits of credit alone',
    ]);
  });

  it('does not change its input', () => {
    const before = plan();
    const copy = structuredClone(before);
    addSubsections(before, 'STEM_EMPIRICAL');
    expect(before).toEqual(copy);
  });
});
