/**
 * A.6 Path A conversation builder — PHASES 6.1.
 *
 *   "a unit test proves the 4th question is blocked."
 *
 * The prompt file is used verbatim (rule 11); what is tested is the code around it: the history
 * is the state, the gap check appears from the second model turn on, replies parse, and the
 * question count is enforced whatever the model wants.
 */

import { describe, expect, it } from 'vitest';
import {
  buildProposalRequest,
  clarifiedTopic,
  GAP_CHECK_FAILED,
  GAP_CHECK_NONE,
  MOCK_KEEP_ASKING,
  mayAskAnotherQuestion,
  mockProposalFor,
  PROPOSAL,
  type ProposalTurn,
  parseProposalReply,
  questionsAsked,
  renderGapCheck,
  SKELETON_INSTRUCTION,
} from '../src/builder/proposal.js';
import { loadPrompt } from '../src/prompts.js';

const gap = {
  count: 1_240,
  works: [
    { title: 'Solar adoption in rural India', year: 2021, abstract: 'A survey of 300 households.' },
    { title: 'Subsidy design for rooftop PV', year: 2019, abstract: '' },
  ],
};

const ids = { userId: 'u1', documentId: 'd1' };

describe('buildProposalRequest', () => {
  it('uses the A.6 system block verbatim on the Strong tier with A.6 parameters', () => {
    const request = buildProposalRequest({
      history: [{ role: 'user', text: 'Rooftop solar' }],
      ...ids,
    });
    expect(request.tier).toBe('strong');
    expect(request.maxTokens).toBe(700);
    expect(request.temperature).toBe(0.5);
    expect(request.action).toBe('PROPOSAL');
    expect(request.system.cached).toContain(loadPrompt('proposal').system);
    expect(request.messages).toEqual([{ role: 'user', content: 'Rooftop solar' }]);
  });

  it('injects <gap_check> only from the second model turn on (A.6: "before the model’s second turn")', () => {
    const first = buildProposalRequest({
      history: [{ role: 'user', text: 'Rooftop solar' }],
      gapCheck: gap,
      ...ids,
    });
    expect(first.system.volatile ?? '').not.toContain('<gap_check');

    const second = buildProposalRequest({
      history: [
        { role: 'user', text: 'Rooftop solar' },
        { role: 'assistant', text: 'Policy, adoption, or economics?' },
        { role: 'user', text: 'Adoption in Karnataka' },
      ],
      gapCheck: gap,
      ...ids,
    });
    expect(second.system.volatile).toContain('<gap_check total="1240">');
    expect(second.system.volatile).toContain(
      '- Solar adoption in rural India (2021) — A survey of 300 households.',
    );
    expect(second.system.volatile).toContain(
      '- Subsidy design for rooftop PV (2019) — no abstract available',
    );
  });

  it('caps the gap check at eight works and carries <constraints> when given', () => {
    const many = {
      count: 50,
      works: Array.from({ length: 12 }, (_, i) => ({ title: `W${i}`, year: 2020, abstract: 'x.' })),
    };
    expect(renderGapCheck(many).split('\n')).toHaveLength(PROPOSAL.gapCheckWorks + 2);
    const request = buildProposalRequest({
      history: [{ role: 'user', text: 'x' }],
      constraints: '20,000 words; Department of Energy Studies',
      ...ids,
    });
    expect(request.system.volatile).toContain(
      '<constraints>\n20,000 words; Department of Energy Studies\n</constraints>',
    );
  });
});

describe('parseProposalReply', () => {
  it('reads a question, a skeleton, and an invalid skeleton', () => {
    expect(parseProposalReply('Is this about policy or adoption?')).toEqual({
      kind: 'question',
      text: 'Is this about policy or adoption?',
    });
    const skeleton = parseProposalReply(
      '<skeleton>\n{"workingTitle":"T","problemStatement":"P.","objectives":["a","b"],"whyOpen":"W."}\n</skeleton>',
    );
    expect(skeleton.kind).toBe('skeleton');
    if (skeleton.kind === 'skeleton') expect(skeleton.skeleton.objectives).toEqual(['a', 'b']);
    expect(parseProposalReply('<skeleton>{"workingTitle":"T"}</skeleton>').kind).toBe('invalid');
    expect(parseProposalReply('<skeleton>not json</skeleton>').kind).toBe('invalid');
  });
});

describe('the three-question limit (A.6 rule 2)', () => {
  const qa = (n: number): ProposalTurn[] =>
    Array.from({ length: n }, (_, i) => [
      {
        role: 'user' as const,
        text: i === 0 ? `Rooftop solar ${MOCK_KEEP_ASKING}` : `answer ${i}`,
      },
      { role: 'assistant' as const, text: `question ${i + 1}?` },
    ]).flat();

  it('counts questions, not skeletons', () => {
    const history: ProposalTurn[] = [
      ...qa(2),
      { role: 'user', text: 'a' },
      { role: 'assistant', text: '<skeleton>{}</skeleton>' },
    ];
    expect(questionsAsked(history)).toBe(2);
  });

  it('allows a third question and refuses a fourth', () => {
    expect(mayAskAnotherQuestion(qa(2))).toBe(true);
    expect(mayAskAnotherQuestion(qa(3))).toBe(false);
  });

  it('the mock keeps asking when told to, and yields a skeleton to the forced instruction', () => {
    // A model that would ask a fourth question…
    const asMessages = (turns: ProposalTurn[]) =>
      turns.map((t) => ({ role: t.role, content: t.text }));
    const wants = mockProposalFor({
      messages: [...asMessages(qa(3)), { role: 'user', content: 'answer 3' }],
    });
    expect(parseProposalReply(wants).kind).toBe('question');
    // …is not allowed to; the caller sends the skeleton instruction in the student's place.
    expect(mayAskAnotherQuestion(qa(3))).toBe(false);
    const forced = mockProposalFor({
      messages: [...asMessages(qa(3)), { role: 'user', content: SKELETON_INSTRUCTION }],
    });
    const reply = parseProposalReply(forced);
    expect(reply.kind).toBe('skeleton');
    if (reply.kind === 'skeleton') expect(reply.skeleton.workingTitle).toContain('Rooftop solar');
  });

  it('the mock produces a skeleton by itself once three questions are answered', () => {
    const history = [
      { role: 'user', content: 'Drip irrigation uptake' },
      { role: 'assistant', content: 'q1?' },
      { role: 'user', content: 'adoption' },
      { role: 'assistant', content: 'q2?' },
      { role: 'user', content: 'Tamil Nadu' },
      { role: 'assistant', content: 'q3?' },
      { role: 'user', content: 'a survey I run' },
    ];
    const reply = parseProposalReply(mockProposalFor({ messages: history }));
    expect(reply.kind).toBe('skeleton');
    if (reply.kind === 'skeleton') {
      expect(reply.skeleton.workingTitle).toBe('Drip irrigation uptake');
      expect(reply.skeleton.objectives.length).toBeGreaterThan(0);
    }
  });
});

describe('clarifiedTopic', () => {
  it('is the student’s own words, in order, capped', () => {
    expect(
      clarifiedTopic([
        { role: 'user', text: ' Rooftop solar ' },
        { role: 'assistant', text: 'q?' },
        { role: 'user', text: 'Karnataka' },
      ]),
    ).toBe('Rooftop solar Karnataka');
  });

  it('leaves out an answer that only picks an option ("2", "b", "(3)")', () => {
    for (const pick of ['2', ' 2. ', 'b', '(3)', '4)']) {
      expect(
        clarifiedTopic([
          { role: 'user', text: 'Mangrove soil carbon in Pichavaram' },
          { role: 'assistant', text: 'Choose one: 1) … 2) …' },
          { role: 'user', text: pick },
        ]),
      ).toBe('Mangrove soil carbon in Pichavaram');
    }
    // A short answer that is a word, or an acronym, is still the student's topic.
    expect(
      clarifiedTopic([
        { role: 'user', text: 'Crop yields' },
        { role: 'assistant', text: 'q?' },
        { role: 'user', text: 'AI' },
      ]),
    ).toBe('Crop yields AI');
  });
});

describe('renderGapCheck with nothing to show (docs/JENNI-FIX-LIST.md item 3)', () => {
  it('says plainly that no related work was found, and none may be described as found', () => {
    const block = renderGapCheck({ count: 0, works: [] });
    expect(block).toBe(`<gap_check total="0">\n${GAP_CHECK_NONE}\n</gap_check>`);
    expect(block).toContain('found no related works');
    expect(block).toContain('No related work may be described as found.');
  });

  it('says the search could not run when it failed, rather than "none exist"', () => {
    const block = renderGapCheck({ count: 0, works: [], failed: true });
    expect(block).toBe(`<gap_check total="unknown">\n${GAP_CHECK_FAILED}\n</gap_check>`);
    expect(block).toContain('could not run');
    expect(block).not.toContain('found no related works');
  });

  it('reaches the model from the second turn even when the search found nothing', () => {
    const request = buildProposalRequest({
      history: [
        { role: 'user', text: 'Mangrove soil carbon' },
        { role: 'assistant', text: 'Restored or natural stands?' },
        { role: 'user', text: 'Both' },
      ],
      gapCheck: { count: 0, works: [] },
      ...ids,
    });
    expect(request.system.volatile).toContain(GAP_CHECK_NONE);
  });

  it('keeps the listed form when works were found', () => {
    expect(renderGapCheck(gap)).not.toContain(GAP_CHECK_NONE);
    expect(renderGapCheck(gap)).not.toContain(GAP_CHECK_FAILED);
  });
});
