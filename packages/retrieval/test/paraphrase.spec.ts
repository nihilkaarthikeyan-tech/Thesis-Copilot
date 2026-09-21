/**
 * Accidental-paraphrase detection.
 *
 * The false positive is the thing to guard. A student writing a literature review is *supposed*
 * to write sentences about the same subject as their sources, in the same vocabulary, and a tool
 * that calls that plagiarism is a tool they will switch off within a day — taking the true
 * positives with it. Most of these tests are about staying quiet.
 */

import { describe, expect, it } from 'vitest';
import {
  adviceFor,
  type ChunkForMatch,
  findParaphrases,
  longestCommonRun,
  PARAPHRASE,
  type SentenceForMatch,
  shingles,
  words,
} from '../src/paraphrase.js';

const chunk = (over: Partial<ChunkForMatch> & { text: string }): ChunkForMatch => ({
  chunkId: 'k1',
  sourceId: 's1',
  shortRef: 'Kumar 2021',
  page: 4,
  ...over,
});

const sentence = (over: Partial<SentenceForMatch> & { text: string }): SentenceForMatch => ({
  id: 'ch1#s1',
  chapterId: 'ch1',
  from: 10,
  to: 90,
  hasCitation: false,
  ...over,
});

const SOURCE = chunk({
  text:
    'Households in districts without a local service presence proceed far less often after an ' +
    'initial enquiry, and the drop-off is sharpest among first-time applicants who receive no ' +
    'follow-up contact within the first fortnight.',
});

describe('tokenising', () => {
  it('keeps stopwords, which are the signal and not the noise', () => {
    // Two authors choosing "of the" in the same nine places is what copying looks like.
    expect(words('The effect of the policy.')).toEqual(['the', 'effect', 'of', 'the', 'policy']);
  });

  it('drops punctuation so quotation marks do not hide a match', () => {
    expect(words('"Adoption," they wrote, "fell."')).toEqual(['adoption', 'they', 'wrote', 'fell']);
  });

  it('produces no shingles for a phrase shorter than one', () => {
    expect(shingles(words('too short here'))).toEqual([]);
  });
});

describe('the longest identical run', () => {
  it('finds a run in the middle of both texts', () => {
    const run = longestCommonRun(words('alpha beta gamma delta'), words('zzz beta gamma delta'));
    expect(run.length).toBe(3);
    expect(run.aStart).toBe(1);
  });

  it('is zero for texts with nothing in common', () => {
    expect(longestCommonRun(words('alpha beta'), words('gamma delta')).length).toBe(0);
  });

  it('does not count the same words out of order as a run', () => {
    expect(longestCommonRun(words('alpha beta gamma'), words('gamma beta alpha')).length).toBe(1);
  });
});

describe('what it flags', () => {
  it('catches a sentence copied verbatim', () => {
    const copied = sentence({
      text: 'Households in districts without a local service presence proceed far less often after an initial enquiry.',
    });
    const [match] = findParaphrases([copied], [SOURCE]);
    expect(match?.kind).toBe('verbatim');
    expect(match?.overlapWords).toBeGreaterThanOrEqual(PARAPHRASE.minVerbatimRun);
    expect(match?.shortRef).toBe('Kumar 2021');
  });

  it('catches a lightly reworded sentence', () => {
    const reworded = sentence({
      text: 'In districts without a local service presence, households proceed far less often once they have made an initial enquiry to the office.',
    });
    const [match] = findParaphrases([reworded], [SOURCE]);
    expect(match).toBeTruthy();
  });

  it('reports the words that actually overlap, so a student can judge it', () => {
    const copied = sentence({
      text: 'Households in districts without a local service presence proceed far less often after an initial enquiry.',
    });
    const [match] = findParaphrases([copied], [SOURCE]);
    expect(match?.overlapText).toContain('local service presence');
  });
});

describe('what it stays quiet about', () => {
  it('says nothing about a sentence that already carries a citation', () => {
    const cited = sentence({
      text: 'Households in districts without a local service presence proceed far less often after an initial enquiry.',
      hasCitation: true,
    });
    expect(findParaphrases([cited], [SOURCE])).toEqual([]);
  });

  it('says nothing about original prose on the same subject', () => {
    const original = sentence({
      text: 'Distance to the nearest office therefore appears to shape whether a family persists with the process at all.',
    });
    expect(findParaphrases([original], [SOURCE])).toEqual([]);
  });

  it('ignores a short sentence, where one shared clause is most of it', () => {
    const short = sentence({ text: 'Households proceed far less often.' });
    expect(findParaphrases([short], [SOURCE])).toEqual([]);
  });

  it('does not fire on ordinary academic scaffolding', () => {
    const scaffold = sentence({
      text: 'It has been shown that the effect of the intervention on the outcome of interest is positive.',
    });
    const boilerplate = chunk({
      text: 'It has been shown that the effect of the treatment on the measured variable is negligible in this setting.',
    });
    const found = findParaphrases([scaffold], [boilerplate]);
    // Seven shared words of scaffolding is below the verbatim bar by design.
    expect(found.filter((m) => m.kind === 'verbatim')).toEqual([]);
  });

  it('is not fooled by padding scaffolding out to any length', () => {
    // The rule is content, not length — this is the fault the scaffolding case above exposed.
    // A run can be made arbitrarily long with function words and still mean nothing.
    const padded = sentence({
      text: 'It has been shown that the effect of the intervention on the outcome of interest is that there is a result.',
    });
    const boilerplate = chunk({
      text: 'It has been shown that the effect of the treatment on the outcome of interest is that there is a change.',
    });
    expect(findParaphrases([padded], [boilerplate])).toEqual([]);
  });

  it('says nothing when the library is empty', () => {
    expect(
      findParaphrases([sentence({ text: 'Any sentence at all, of reasonable length here.' })], []),
    ).toEqual([]);
  });
});

describe('how it reports', () => {
  it('reports one finding per sentence, not one per matching chunk', () => {
    const copied = sentence({
      text: 'Households in districts without a local service presence proceed far less often after an initial enquiry.',
    });
    const twice = [SOURCE, chunk({ chunkId: 'k2', text: SOURCE.text })];
    expect(findParaphrases([copied], twice)).toHaveLength(1);
  });

  it('puts verbatim above close', () => {
    const close = sentence({
      id: 'ch1#s2',
      text: 'In districts without a local service presence, households proceed far less often once they have made an initial enquiry to the office.',
    });
    const verbatim = sentence({
      id: 'ch1#s3',
      text: 'Households in districts without a local service presence proceed far less often after an initial enquiry.',
    });
    const found = findParaphrases([close, verbatim], [SOURCE]);
    expect(found[0]?.kind).toBe('verbatim');
  });

  it('only ever advises adding attribution, never avoiding detection', () => {
    const copied = sentence({
      text: 'Households in districts without a local service presence proceed far less often after an initial enquiry.',
    });
    const [match] = findParaphrases([copied], [SOURCE]);
    const advice = match ? adviceFor(match) : '';
    expect(advice).toMatch(/quotation marks|cite/i);
    // PRD §12.3. The inverse of this feature is a banned one, and the difference is the wording.
    expect(advice).not.toMatch(/reword|rephrase|avoid|detect|undetect|humanis|humaniz/i);
  });

  it('names the page when there is one, because a quote needs it', () => {
    const copied = sentence({
      text: 'Households in districts without a local service presence proceed far less often after an initial enquiry.',
    });
    const [match] = findParaphrases([copied], [SOURCE]);
    expect(match ? adviceFor(match) : '').toContain('p. 4');
  });
});
