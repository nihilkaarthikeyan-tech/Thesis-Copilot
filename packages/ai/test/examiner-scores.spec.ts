/**
 * The examiner's score card (ADR-0111, Jenni build plan R24): the request and what the code lets
 * through.
 */

import { describe, expect, it } from 'vitest';
import {
  buildExaminerScoresRequest,
  cleanExaminerScores,
  EXAMINER_SCORES,
  examinerScoresUserMessage,
  soundnessBlocking,
} from '../src/builder/examiner-scores.js';

const sentence = (plain: string) => ({ marked: plain, plain, from: 0, to: 0, citations: [] });

const INPUT = {
  discipline: 'Development Economics',
  degree: 'PhD',
  chapterTitle: 'Literature Review',
  purpose: 'What is known about mobile banking among rural women',
  sections: [
    {
      title: 'Access',
      sentences: [sentence('Access to a phone rose sharply after 2016.'), sentence('Use lagged.')],
    },
    { title: 'Trust', sentences: [sentence('Trust in agents shaped first use.')] },
  ],
  issues: [
    {
      severity: 'warning' as const,
      type: 'tense',
      section: 'Trust',
      explanation: 'One study, in the present tense.',
    },
    {
      severity: 'blocking' as const,
      type: 'unsupported',
      section: 'Access',
      explanation: 'The passage gives 2018, not 2016.',
    },
  ],
  userId: 'u',
  documentId: 'd',
};

const card = (over: Partial<Record<string, unknown>> = {}) => ({
  reading: 'Each section follows from the last.',
  soundness: { score: 8, reason: 'Claims match their passages. Extra sentence here.' },
  presentation: { score: 7.4, reason: 'Sections follow the title.' },
  contribution: { score: 6, reason: 'Mostly restates sources.' },
  overall: { score: 7, reason: 'Sound, minor revisions.' },
  ...over,
});

describe('the examiner scores request', () => {
  it('sends the chapter by section and the issues, blocking first, in the review unit', () => {
    const message = examinerScoresUserMessage(INPUT);
    expect(message).toContain('<scores discipline="Development Economics" degree="PhD">');
    expect(message).toContain(
      '<section title="Access">Access to a phone rose sharply after 2016. Use lagged.</section>',
    );
    expect(message.indexOf('severity="blocking"')).toBeLessThan(
      message.indexOf('severity="warning"'),
    );
    // Each issue carries its type, so each score weighs its own kind (v2).
    expect(message).toContain('<issue severity="blocking" type="unsupported" section="Access">');
    const request = buildExaminerScoresRequest(INPUT);
    expect(request).toMatchObject({ tier: 'strong', action: 'EXAMINER_REVIEW', temperature: 0 });
    expect(request.system.cached).toContain('Score the chapter as it stands');
  });

  it('cuts a long chapter so every section keeps a share', () => {
    const long = 'A sentence about rural women and their phones. '.repeat(400);
    const message = examinerScoresUserMessage({
      ...INPUT,
      sections: [
        { title: 'One', sentences: [sentence(long)] },
        { title: 'Two', sentences: [sentence(long)] },
      ],
    });
    const sections = message.match(/<section title="[^"]+">[^<]*<\/section>/g) ?? [];
    expect(sections).toHaveLength(2);
    expect(message.length).toBeLessThan(EXAMINER_SCORES.chapterChars + 2_000);
    for (const s of sections) expect(s).toContain('[…]');
  });
});

describe('cleanExaminerScores', () => {
  it('rounds into 1–10 and keeps each reason to its first sentence', () => {
    const out = cleanExaminerScores(card({ overall: { score: 14, reason: 'Fine.' } }), {
      blocking: 0,
    });
    expect(out).toMatchObject({
      soundness: { score: 8, reason: 'Claims match their passages.' },
      presentation: { score: 7 },
      overall: { score: 10 },
    });
  });

  it('holds soundness at 6 only for a blocking issue of a soundness type', () => {
    expect(soundnessBlocking(INPUT.issues)).toBe(1);
    expect(
      soundnessBlocking([
        { severity: 'blocking', type: 'terminology' },
        ...INPUT.issues.slice(0, 1),
      ]),
    ).toBe(0);
    expect(cleanExaminerScores(card(), { blocking: 2 })?.soundness.score).toBe(6);
    expect(cleanExaminerScores(card(), { blocking: 0 })?.soundness.score).toBe(8);
  });

  it('shows no card at all when a score is missing or not a number', () => {
    const { overall: _gone, ...three } = card();
    expect(cleanExaminerScores(three, { blocking: 0 })).toBeNull();
    expect(
      cleanExaminerScores(card({ contribution: { score: 'high', reason: 'x' } }), { blocking: 0 }),
    ).toBeNull();
    expect(
      cleanExaminerScores(card({ contribution: { score: Number.NaN, reason: 'x' } }), {
        blocking: 0,
      }),
    ).toBeNull();
  });
});
