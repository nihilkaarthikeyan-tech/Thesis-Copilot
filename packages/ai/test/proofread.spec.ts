/**
 * Proofreading — ADR-0026. The tests are mostly about what is refused, because that is the line
 * between a proofreader and a paraphraser (PRD §12.3): a correction has to be small, in the
 * sentence, and placeable, or it is not shown.
 */

import { ACTION_PROFILES, computeCallCost } from '@tc/config';
import { describe, expect, it } from 'vitest';
import {
  buildProofreadRequest,
  changedWords,
  correctionSize,
  kindOf,
  mockProofreadResponse,
  narrowCorrection,
  PROOFREAD,
  PROOFREAD_TOKENS_PER_WORD,
  postProcessProofread,
  proofreadSchema,
  splitCorrection,
} from '../src/builder/proofread.js';
import { loadPrompt } from '../src/prompts.js';

const SENTENCES = [
  { id: 's1', text: 'The farmers recieved the subsidy late in the season.' },
  { id: 's2', text: 'Uptake were lowest where water rights was disputed.' },
  { id: 's3', text: 'This chapter examines why adoption was slow.' },
];

const correction = (over: Record<string, unknown>) => ({
  sentenceId: 's1',
  original: 'recieved',
  replacement: 'received',
  kind: 'spelling' as const,
  why: 'Misspelled.',
  ...over,
});

describe('the request', () => {
  const request = buildProofreadRequest({
    sentences: SENTENCES,
    language: 'en',
    userId: 'u',
    documentId: 'd',
  });

  it('is a Fast call metered as a command, on the proofreading prompt', () => {
    expect(request.tier).toBe('fast');
    expect(request.action).toBe('COMMAND');
    expect(request.system.cached).toContain(loadPrompt('proofread').system);
  });

  it('sends each sentence with its id, and the language', () => {
    const user = request.messages[0]?.content ?? '';
    expect(user).toContain('- s1 | The farmers recieved the subsidy late in the season.');
    expect(user).toContain('<language>en</language>');
  });

  it('sends a batch at most', () => {
    const many = Array.from({ length: 90 }, (_, i) => ({ id: `s${i}`, text: 'A sentence.' }));
    const user =
      buildProofreadRequest({ sentences: many, userId: 'u', documentId: 'd' }).messages[0]
        ?.content ?? '';
    expect(user.match(/^- s/gm)).toHaveLength(PROOFREAD.batch);
  });
});

describe('what counts as a correction', () => {
  const run = (corrections: Array<Record<string, unknown>>) =>
    postProcessProofread(proofreadSchema.parse({ corrections }), SENTENCES);

  it('keeps a small fix to a span that is in the sentence', () => {
    const { corrections, refused } = run([
      correction({}),
      correction({
        sentenceId: 's2',
        original: 'Uptake were',
        replacement: 'Uptake was',
        kind: 'agreement',
      }),
    ]);
    expect(refused).toBe(0);
    // "Uptake were" is narrowed to the word that changes.
    expect(corrections.map((c) => `${c.original}→${c.replacement}`)).toEqual([
      'recieved→received',
      'were→was',
    ]);
  });

  it('refuses a rewrite dressed as a correction', () => {
    const { corrections, refused } = run([
      correction({
        sentenceId: 's3',
        original: 'This chapter examines why adoption was slow.',
        replacement: 'In this chapter, the sluggish pace of adoption is investigated.',
        kind: 'grammar',
      }),
    ]);
    expect(corrections).toEqual([]);
    expect(refused).toBeGreaterThan(0);
  });

  it('refuses a synonym, a negation or a different word, whatever it is called', () => {
    const { corrections } = run([
      correction({ original: 'The farmers', replacement: 'The growers', kind: 'grammar' }),
      correction({
        sentenceId: 's3',
        original: 'adoption was slow',
        replacement: 'adoption was not slow',
        kind: 'grammar',
      }),
      correction({ original: 'late in', replacement: 'early in', kind: 'spelling' }),
    ]);
    expect(corrections).toEqual([]);
  });

  it('splits a sentence with three fixes into three corrections', () => {
    // What gpt-5-nano did with this sentence in the browser: one answer, three fixes in it.
    const sentence = {
      id: 's4',
      text: 'Most housholds in the district recieved the subsidy after the the planting season.',
    };
    const { corrections, refused } = postProcessProofread(
      proofreadSchema.parse({
        corrections: [
          correction({
            sentenceId: 's4',
            original: sentence.text,
            replacement:
              'Most households in the district received the subsidy after the planting season.',
          }),
        ],
      }),
      [sentence],
    );
    expect(refused).toBe(0);
    expect(corrections.map((c) => `${c.original}→${c.replacement}`)).toEqual([
      'housholds→households',
      'recieved→received',
      'the the→the',
    ]);
    // Each is labelled by what it does; the model's one reason for all three is not reused.
    expect(corrections.map((c) => c.kind)).toEqual(['spelling', 'spelling', 'grammar']);
    expect(corrections.every((c) => c.why === '')).toBe(true);
  });

  it('relabels a kind the model made up, rather than failing the batch over it', () => {
    // gpt-5-nano in JSON mode, 2026-09-24: "doubling" failed validation for forty sentences.
    const { corrections } = postProcessProofread(
      proofreadSchema.parse({
        corrections: [
          correction({
            original: 'the the',
            replacement: 'the',
            kind: 'doubling',
            sentenceId: 'd',
          }),
        ],
      }),
      [{ id: 'd', text: 'Delays compound the the problem.' }],
    );
    expect(corrections).toMatchObject([{ original: 'the the', kind: 'grammar' }]);
  });

  it('labels a correction by what it changes', () => {
    expect(kindOf('recieved', 'received')).toBe('spelling');
    expect(kindOf('were', 'was')).toBe('agreement');
    expect(kindOf('a', 'an')).toBe('grammar');
    expect(kindOf('the the', 'the')).toBe('grammar');
    expect(kindOf('However the', 'However, the')).toBe('punctuation');
  });

  it('refuses a span that is not in the sentence, or one it cannot place', () => {
    const { corrections, refused } = run([
      correction({ original: 'recieve the' }),
      correction({ sentenceId: 's9' }),
      // "the" is in s1 twice: which one would it change?
      correction({ original: 'the', replacement: 'a' }),
    ]);
    expect(corrections).toEqual([]);
    expect(refused).toBe(3);
  });

  it('refuses a change to nothing, and the same correction twice', () => {
    const { corrections, refused } = run([
      correction({ replacement: 'recieved' }),
      correction({}),
      correction({}),
    ]);
    expect(corrections).toHaveLength(1);
    expect(refused).toBe(2);
  });

  it('narrows a whole-sentence answer to the word that changed', () => {
    // What gpt-5-nano actually returned the first time the product called it (2026-09-24).
    const { corrections, refused } = run([
      correction({
        original: 'The farmers recieved the subsidy late in the season.',
        replacement: 'The farmers received the subsidy late in the season.',
      }),
    ]);
    expect(refused).toBe(0);
    expect(corrections).toMatchObject([{ original: 'recieved', replacement: 'received' }]);
  });

  it('measures the edit, not the span', () => {
    expect(changedWords('recieved', 'received')).toBe(1);
    expect(changedWords('Uptake were', 'Uptake was')).toBe(1);
    expect(changedWords('the the', 'the')).toBe(1);
    expect(changedWords('why adoption was slow', 'the sluggish pace of adoption')).toBeGreaterThan(
      PROOFREAD.maxChangedWords,
    );
  });
});

describe('what a run costs', () => {
  it('a run at its largest costs no more than the COMMAND unit it is charged as', () => {
    // ADR-0008: a shared unit is priced for the most expensive thing that draws on it. Both sides
    // at the prices Appendix E.2's budget uses (no model id, so the tier's reference price).
    const run = computeCallCost({
      tier: PROOFREAD.tier,
      usage: {
        inputTokens: Math.ceil(PROOFREAD.maxWords * PROOFREAD_TOKENS_PER_WORD.input),
        outputTokens: Math.ceil(PROOFREAD.maxWords * PROOFREAD_TOKENS_PER_WORD.output),
      },
    });
    const command = ACTION_PROFILES.COMMAND;
    const unit = computeCallCost({
      tier: command.tier,
      usage: {
        inputTokens: command.inputTokens,
        cachedInputTokens: command.cachedInputTokens,
        outputTokens: command.outputTokens,
      },
    });
    expect(run).toBeLessThanOrEqual(unit);
  });
});

describe('what a correction may change (PRD §12.3)', () => {
  it('fixes spelling, inflection, grammar words, punctuation, spacing and doubled words', () => {
    for (const [before, after] of [
      ['recieved', 'received'],
      ['appear', 'appears'],
      ['effect', 'affect'],
      ['a', 'an'],
      ['less', 'fewer'],
      ['then', 'than'],
      ['its', "it's"],
      ['were', 'was'],
      ['long term', 'long-term'],
      ['However the', 'However, the'],
      ['the the', 'the'],
      ['store', 'the store'],
      ['discuss about the', 'discuss the'],
    ] as const) {
      expect(correctionSize(before, after), `${before} → ${after}`).toBe(1);
    }
  });

  it('puts no different word in: not a synonym, a negation, an opposite, a number', () => {
    for (const [before, after] of [
      ['farmers', 'growers'],
      ['utilise', 'use'],
      ['in order to', 'to'],
      ['were significant', 'were not significant'],
      ['significant', 'insignificant'],
      ['more', 'less'],
      ['with', 'without'],
      ['all', 'some'],
      ['2019', '2020'],
    ] as const) {
      expect(correctionSize(before, after), `${before} → ${after}`).toBeNull();
    }
  });
});

describe('splitting an answer into its corrections', () => {
  it('keeps each change within the words either side of it', () => {
    const sentence = 'Uptake were lowest where water rights was disputed.';
    expect(
      splitCorrection(sentence, 'Uptake was lowest where water rights were disputed.', sentence),
    ).toEqual([
      { original: 'were', replacement: 'was' },
      { original: 'was', replacement: 'were' },
    ]);
  });
});

describe('narrowing a correction to whole words', () => {
  const narrow = (original: string, replacement: string, sentence = original) =>
    narrowCorrection(original, replacement, sentence);

  it('widens a change inside a word to the word', () => {
    expect(narrow('recieved', 'received')).toEqual({
      original: 'recieved',
      replacement: 'received',
    });
    expect(narrow('quality appear to matter', 'quality appears to matter')).toEqual({
      original: 'appear',
      replacement: 'appears',
    });
  });

  it('keeps a doubled word as the pair, so the student sees what goes', () => {
    expect(narrow('compound the the problem', 'compound the problem')).toEqual({
      original: 'the the',
      replacement: 'the',
    });
  });

  it('shows an insertion with the word after it, or before it at the end', () => {
    expect(narrow('went to store', 'went to the store')).toEqual({
      original: 'store',
      replacement: 'the store',
    });
    expect(narrow('late in the season', 'late in the season.')).toEqual({
      original: 'season',
      replacement: 'season.',
    });
  });

  it('never starts or ends on a space', () => {
    expect(narrow('the farmers , who', 'the farmers, who')).toEqual({
      original: 'farmers ,',
      replacement: 'farmers,',
    });
    expect(narrow('the  season', 'the season')).toEqual({
      original: 'the  season',
      replacement: 'the season',
    });
  });

  it('widens until the span occurs once in the sentence', () => {
    const sentence = 'The rate rose in 2019 and the rate fell in 2020.';
    // "rate" is there twice; the one being corrected is the second.
    expect(narrow('the rate fell', 'the rates fell', sentence)).toEqual({
      original: 'the rate',
      replacement: 'the rates',
    });
  });

  it('is nothing when nothing changes', () => {
    expect(narrow('received', 'received')).toBeNull();
  });
});

describe('the mock, which CI runs on', () => {
  it('finds an unmistakable misspelling and a doubled word, nothing else', () => {
    const request = buildProofreadRequest({
      sentences: [
        { id: 's1', text: 'The farmers recieved the the subsidy.' },
        { id: 's2', text: 'This sentence is fine.' },
      ],
      userId: 'u',
      documentId: 'd',
    });
    expect(mockProofreadResponse.match(request)).toBe(true);
    const parsed = proofreadSchema.parse(mockProofreadResponse.respond(request));
    const { corrections } = postProcessProofread(parsed, [
      { id: 's1', text: 'The farmers recieved the the subsidy.' },
      { id: 's2', text: 'This sentence is fine.' },
    ]);
    expect(corrections.map((c) => `${c.original}→${c.replacement}`)).toEqual([
      'recieved→received',
      'the the→the',
    ]);
  });

  it('is not the section-command mock’s request', () => {
    expect(
      mockProofreadResponse.match({ action: 'COMMAND', messages: [{ content: '<selection>x' }] }),
    ).toBe(false);
  });
});
