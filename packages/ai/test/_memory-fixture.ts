/**
 * A fixture document memory for the prompt builder tests — the same one every snapshot renders,
 * so a change in the rendering shows up as a diff against a file a human has read.
 */

import type { OutlineNode } from '@tc/types';
import type { MemoryInput } from '../src/builder/memory.js';

export const outline: OutlineNode[] = [
  {
    id: '1-introduction',
    title: 'Introduction',
    scopeNote: 'Sets out why rooftop solar uptake in rural Karnataka remains low.',
    children: [
      { id: '1-1-context', title: 'Context', scopeNote: '', children: [] },
      { id: '1-2-gap', title: 'The gap', scopeNote: '', children: [] },
    ],
  },
  {
    id: '2-literature',
    title: 'Literature review',
    scopeNote: 'What is known about household adoption barriers, and where the evidence thins out.',
    subTheme: 'adoption',
    children: [
      { id: '2-1-cost', title: 'Cost barriers', scopeNote: '', children: [] },
      { id: '2-2-awareness', title: 'Awareness and trust', scopeNote: '', children: [] },
    ],
  },
  {
    id: '3-method',
    title: 'Method',
    scopeNote: 'A structured questionnaire administered to 312 households across three districts.',
    children: [],
  },
  {
    id: '4-findings',
    title: 'Findings',
    scopeNote: 'Cost dominates; awareness is not the binding constraint.',
    children: [],
  },
  {
    id: '5-discussion',
    title: 'Discussion',
    scopeNote: 'What the pattern means for subsidy design.',
    children: [],
  },
];

export const fixtureMemory: MemoryInput = {
  scope: {
    workingTitle: 'Barriers to rooftop solar adoption in rural Karnataka',
    problemStatement:
      'Cost, not awareness, appears to drive non-adoption, but existing studies stop at the district level.',
    objectives: [
      'Measure household-level adoption across three districts',
      'Identify the binding barrier to adoption',
      'Assess whether current subsidies address it',
    ],
    whyOpen: 'District-level surveys cannot separate cost from awareness at the household level.',
  },
  outline,
  glossary: {
    Adoption: { definition: 'A household installing and commissioning a rooftop unit.' },
    Barrier: {
      definition: 'A reason a household that considered a unit did not install one.',
      usageNote: 'Cost, not awareness, in this thesis',
    },
    'Net metering': {
      definition: 'A tariff arrangement crediting exported electricity against consumption.',
    },
    'Willingness to pay': {
      definition: 'The maximum a household reports it would spend on a unit.',
    },
  },
  styleProfile: null,
  chapter: {
    outlineNodeId: '2-literature',
    text: 'The literature on adoption barriers is extensive. Cost is the barrier most often cited.',
  },
};

export const fixtureStyleProfile = {
  avgSentenceLen: 21,
  register: 'formal',
  voice: 'passive',
  transitions: ['however', 'in contrast', 'this suggests'],
  voiceNote:
    'Prefers short declarative sentences; opens paragraphs with the claim; uses "however" and "in contrast"; avoids rhetorical questions.',
  hedging: 'medium',
  sample: ['Cost is the barrier most often cited.', 'However, awareness was rarely mentioned.'],
};
