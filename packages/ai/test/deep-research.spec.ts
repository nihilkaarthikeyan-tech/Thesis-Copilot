/**
 * Deep research in chat — ADR-0080: the two requests, the plan's cleaning and the limits. Pure;
 * the searching and metering are the API's (`apps/api/test/chat-deep*.spec.ts`).
 */

import { describe, expect, it } from 'vitest';
import { postProcessChat } from '../src/builder/chat.js';
import {
  buildDeepChatRequest,
  buildResearchPlanRequest,
  cleanResearchPlan,
  DEEP_RESEARCH,
  mockResearchPlanResponse,
  researchPlanSchema,
} from '../src/builder/deep-research.js';
import { loadPrompt } from '../src/prompts.js';

const scope = {
  workingTitle: 'Barriers to rooftop solar adoption among rural households in Karnataka',
  problemStatement: 'Why uptake stays low despite subsidies.',
  objectives: ['Identify the financial barriers', 'Compare them with information barriers'],
};
const question =
  'What are the main financial barriers to rooftop solar adoption for rural households in India?';

describe('the plan request (A.4.1)', () => {
  it('is a strong-tier RESEARCH call carrying the thesis scope and the question', () => {
    const req = buildResearchPlanRequest({ scope, question, userId: 'u', documentId: 'd' });
    expect(req.action).toBe('RESEARCH');
    expect(req.tier).toBe('strong');
    expect(req.maxTokens).toBe(DEEP_RESEARCH.planner.maxTokens);
    expect(req.system.cached).toContain(loadPrompt('research_plan').system);
    const user = req.messages[0]?.content ?? '';
    expect(user).toContain('<thesis>');
    expect(user).toContain(`Working title: ${scope.workingTitle}`);
    expect(user).toContain('- Identify the financial barriers');
    expect(user).toContain(`<question>${question}</question>`);
  });

  it('the mock plans from the question’s own words, in the schema', () => {
    const req = buildResearchPlanRequest({ scope, question, userId: 'u', documentId: 'd' });
    expect(mockResearchPlanResponse.match(req)).toBe(true);
    const plan = researchPlanSchema.parse(mockResearchPlanResponse.respond(req));
    expect(plan.parts).toHaveLength(3);
    for (const part of plan.parts) {
      expect(part.query.split(' ').length).toBeGreaterThanOrEqual(3);
      expect(part.query).toContain('financial');
    }
    // The answer request is not a plan request.
    const answer = buildDeepChatRequest({
      memoryBlock: '',
      question,
      history: [],
      passages: [],
      filters: {},
      userId: 'u',
      documentId: 'd',
      plan: plan.parts,
    });
    expect(mockResearchPlanResponse.match(answer)).toBe(false);
  });
});

describe('cleanResearchPlan', () => {
  it('strips quotation and question marks, drops short, long and repeated queries, keeps at most five', () => {
    const parts = cleanResearchPlan({
      parts: [
        {
          title: 'Upfront cost.',
          question: 'What does cost do?',
          query: '"upfront cost" rooftop solar?',
        },
        { title: 'Credit', question: 'Is credit available?', query: 'Upfront Cost Rooftop Solar' },
        { title: 'Too short', question: 'Is it short?', query: 'solar cost' },
        {
          title: 'Too long',
          question: 'Is it long?',
          query: 'one two three four five six seven eight nine ten eleven twelve thirteen',
        },
        {
          title: 'Subsidy',
          question: 'How do subsidies land?',
          query: 'subsidy delivery rooftop solar',
        },
        {
          title: 'Payback',
          question: 'What payback?',
          query: 'payback period rooftop solar households',
        },
        { title: 'Awareness', question: 'Who knows?', query: 'financing awareness rooftop solar' },
        { title: 'Trust', question: 'Who trusts?', query: 'installer trust rooftop solar' },
        { title: 'Sixth', question: 'A sixth?', query: 'net metering rooftop solar households' },
      ],
    });
    expect(parts.map((p) => p.query)).toEqual([
      'upfront cost rooftop solar',
      'subsidy delivery rooftop solar',
      'payback period rooftop solar households',
      'financing awareness rooftop solar',
      'installer trust rooftop solar',
    ]);
    expect(parts[0]?.title).toBe('Upfront cost');
    expect(parts).toHaveLength(DEEP_RESEARCH.planner.maxParts);
  });

  it('returns nothing usable as an empty list, never a throw', () => {
    expect(
      cleanResearchPlan({ parts: [{ title: 'x', question: 'why not', query: 'a b' }] }),
    ).toEqual([]);
  });
});

describe('the answer request (A.4.2)', () => {
  const plan = [
    { title: 'Upfront cost', question: 'How much does the system cost up front?', query: 'q1' },
    { title: 'Credit & "loans"', question: 'Can households borrow?', query: 'q2' },
  ];
  const passages = [
    { id: 'S1#c1', shortRef: 'Kumar 2021', page: 7, text: 'Upfront cost was the main barrier.' },
    {
      id: 'Sweb1#cabstract',
      shortRef: 'Financing rooftop…, 2023',
      page: null,
      text: 'Credit access raised uptake.',
      origin: 'search' as const,
    },
  ];

  it('carries the plan, marks search passages, and is a RESEARCH call with the longer budget', () => {
    const req = buildDeepChatRequest({
      memoryBlock: '<memory/>',
      question,
      history: [{ role: 'user', text: 'Earlier question' }],
      passages,
      filters: { yearFrom: 2020 },
      userId: 'u',
      documentId: 'd',
      plan,
    });
    expect(req.action).toBe('RESEARCH');
    expect(req.tier).toBe('strong');
    expect(req.maxTokens).toBe(DEEP_RESEARCH.answer.maxTokens);
    expect(req.system.cached).toContain(loadPrompt('chat_deep').system);
    expect(req.system.cached).toContain('<memory/>');
    expect(req.messages).toHaveLength(2);
    const user = req.messages.at(-1)?.content ?? '';
    expect(user).toContain('<filters>{"yearFrom":2020}</filters>');
    expect(user).toContain(
      '<part title="Upfront cost">How much does the system cost up front?</part>',
    );
    expect(user).toContain('<part title="Credit &amp; &quot;loans&quot;">');
    expect(user).toContain('<passage id="S1#c1" source="Kumar 2021" page="7">');
    expect(user).toContain(
      '<passage id="Sweb1#cabstract" source="Financing rooftop…, 2023" origin="search">',
    );
    expect(user).toContain(`<question>${question}</question>`);
  });

  it(`sends at most ${DEEP_RESEARCH.maxPassages} passages`, () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `S${i}#c1`,
      shortRef: `P ${i}`,
      page: null,
      text: `Passage ${i}.`,
    }));
    const req = buildDeepChatRequest({
      memoryBlock: '',
      question,
      history: [],
      passages: many,
      filters: {},
      userId: 'u',
      documentId: 'd',
      plan,
    });
    const user = req.messages.at(-1)?.content ?? '';
    expect(user.match(/<passage /g)).toHaveLength(DEEP_RESEARCH.maxPassages);
  });

  it('a "Direct answer:" label is dropped; the sentence after it stays', () => {
    const out = postProcessChat(
      'Direct answer: Three things stop them {{cite:S1#c1}}.\n\n### Part\nMore {{cite:S1#c1}}.',
      passages.map((p) => p.id),
    );
    expect(out.text.startsWith('Three things stop them')).toBe(true);
    expect(out.outcome).toBe('answered');
  });

  it('grounding is A.4’s: a citation not in the request is stripped and counted', () => {
    const out = postProcessChat(
      'Cost first {{cite:S1#c1}}. Credit helps {{cite:Sweb1#cabstract}}. Made up {{cite:S9#c9}}.',
      passages.map((p) => p.id),
    );
    expect(out.cited).toEqual(['S1#c1', 'Sweb1#cabstract']);
    expect(out.hallucinated).toEqual(['S9#c9']);
    expect(out.text).not.toContain('S9#c9');
  });
});
