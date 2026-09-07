/**
 * The guide cycle's builders — PRD Appendix D.2.2, A.13, A.14, FR-7.4, FR-7.5; PHASES v2 B2 and
 * the VERIFY batch ("guide cycle").
 *
 * Three things are load-bearing here, and each of them protects the student rather than the model.
 *
 * **Re-anchoring must fail honestly.** A comment that silently points at the wrong sentence is
 * worse than one that admits it is adrift, because the student will answer the wrong paragraph and
 * tell their guide it is done.
 *
 * **A revision may not invent a citation.** A guide asking for evidence is not a licence to supply
 * a source that does not exist (§10.6).
 *
 * **`[[NEEDS INPUT: …]]` is not text.** A.14 emits it when the comment asks for something only the
 * student has; it names a gap, and writing it into a chapter would put a placeholder into a thesis.
 */

import { describe, expect, it } from 'vitest';
import { type AnchorSentence, findAnchor, normalise, similarity } from '../src/builder/anchor.js';
import {
  COMMENT_CLASSES,
  classifySchema,
  mockClassifyResponse,
  NEEDS_INPUT_RE,
  postProcessRevision,
} from '../src/builder/comment.js';

/** Sentences with the offsets a chapter would give them. */
function sentences(...texts: string[]): AnchorSentence[] {
  let at = 0;
  return texts.map((text) => {
    const row = { text, from: at, to: at + text.length };
    at = row.to + 1;
    return row;
  });
}

const CHAPTER = sentences(
  'Coastal fish drying in Tamil Nadu is still largely open-air.',
  'Open drying loses an estimated fifth of the catch to spoilage and contamination.',
  'Losses concentrate in the monsoon months, when drying times triple.',
);

describe('D.2.2 — normalise and similarity', () => {
  it('collapses whitespace and case but keeps the words', () => {
    expect(normalise('  The   Quick\nBrown  ')).toBe('the quick brown');
  });

  it('scores an identical string 1 and a disjoint one near 0', () => {
    expect(similarity('solar dryer', 'solar dryer')).toBe(1);
    expect(similarity('solar dryer', 'zzzzzzz')).toBeLessThan(0.1);
  });

  it('is insensitive to whitespace and case', () => {
    expect(similarity('Solar   Dryer', 'solar dryer')).toBe(1);
  });

  it('scores a near-miss high but below 1', () => {
    const score = similarity(
      'Open drying loses an estimated fifth of the catch.',
      'Open drying loses about a fifth of the catch.',
    );
    expect(score).toBeGreaterThan(0.7);
    expect(score).toBeLessThan(1);
  });
});

describe('D.2.2 — findAnchor, in the three attempts it is specified as', () => {
  it('1. finds the quote exactly, with the offsets it actually occupies', () => {
    const quote = 'an estimated fifth of the catch';
    const match = findAnchor(quote, CHAPTER);
    expect(match?.how).toBe('exact');
    expect(match?.score).toBe(1);
    const source = CHAPTER.map((s) => s.text).join(' ');
    expect(source.slice(match?.from, match?.to)).toBe(quote);
  });

  it('2. finds it again after the whitespace and case have changed', () => {
    const match = findAnchor(
      '  open drying LOSES an estimated   fifth of the catch to spoilage and contamination.  ',
      CHAPTER,
    );
    expect(match?.how).toBe('normalised');
    expect(match?.from).toBe(CHAPTER[1]?.from);
    expect(match?.to).toBe(CHAPTER[1]?.to);
  });

  it('3. finds a rewritten sentence by similarity, and says so', () => {
    const match = findAnchor(
      'Open drying loses an estimated fifth of the catch to spoilage and contaminants.',
      CHAPTER,
      0.85,
    );
    expect(match?.how).toBe('similar');
    expect(match?.score).toBeGreaterThanOrEqual(0.85);
  });

  it('spans consecutive sentences when the guide quoted more than one', () => {
    const match = findAnchor(`${CHAPTER[1]?.text} ${CHAPTER[2]?.text}`, CHAPTER);
    expect(match).not.toBeNull();
    expect(match?.from).toBe(CHAPTER[1]?.from);
    expect(match?.to).toBe(CHAPTER[2]?.to);
  });

  it('returns null rather than a wrong range when the passage is gone', () => {
    expect(findAnchor('A sentence about photovoltaic inverter topologies.', CHAPTER)).toBeNull();
  });

  it('returns null for an empty quote or an empty chapter', () => {
    expect(findAnchor('   ', CHAPTER)).toBeNull();
    expect(findAnchor('anything', [])).toBeNull();
  });

  it('respects the threshold it is given', () => {
    const loose = 'Open drying loses roughly one fifth of the landed catch each season.';
    expect(findAnchor(loose, CHAPTER, 0.99)).toBeNull();
    expect(findAnchor(loose, CHAPTER, 0.5)).not.toBeNull();
  });
});

describe('A.14 — postProcessRevision', () => {
  const original = 'Open drying loses a fifth of the catch {{cite:fao2019}}.';

  it('keeps a citation the passage already had', () => {
    const out = postProcessRevision(
      'Open drying loses about a fifth of the landed catch {{cite:fao2019}}.',
      original,
      [],
    );
    expect(out.text).toContain('{{cite:fao2019}}');
    expect(out.hallucinated).toEqual([]);
    expect(out.keptCitations).toBe(true);
  });

  it('keeps a citation a supplied passage supports', () => {
    const out = postProcessRevision(
      'Losses are seasonal {{cite:kumar2021}}.',
      'Losses are seasonal.',
      ['kumar2021'],
    );
    expect(out.text).toContain('{{cite:kumar2021}}');
    expect(out.hallucinated).toEqual([]);
  });

  it('strips a citation that was in neither, and names it', () => {
    const out = postProcessRevision(
      'Open drying loses a fifth {{cite:fao2019}} and quality falls {{cite:invented2024}}.',
      original,
      [],
    );
    expect(out.text).not.toContain('invented2024');
    expect(out.text).toContain('fao2019');
    expect(out.hallucinated).toEqual(['invented2024']);
  });

  it('reports when a revision dropped a citation the original had', () => {
    const out = postProcessRevision('Open drying loses a fifth of the catch.', original, []);
    expect(out.keptCitations).toBe(false);
  });

  it('collects every [[NEEDS INPUT: …]] the model emitted', () => {
    const out = postProcessRevision(
      'We surveyed [[NEEDS INPUT: how many households]] households in [[NEEDS INPUT: which district]].',
      'We surveyed households.',
      [],
    );
    expect(out.needsInput).toEqual(['how many households', 'which district']);
  });

  it('leaves the marker in the text, so the caller cannot apply it by accident', () => {
    // `ReviewService.accept` refuses a revision containing one. It has to be findable to refuse.
    const out = postProcessRevision('We surveyed [[NEEDS INPUT: how many]] households.', 'x', []);
    NEEDS_INPUT_RE.lastIndex = 0;
    expect(NEEDS_INPUT_RE.test(out.text)).toBe(true);
  });

  it('tidies the spacing a stripped citation leaves behind', () => {
    const out = postProcessRevision('Losses are real {{cite:nope}}   and seasonal.', 'x', []);
    expect(out.text).not.toMatch(/ {2,}/);
  });

  it('is not confused by being run twice — the regex is global', () => {
    const run = () => postProcessRevision('A [[NEEDS INPUT: thing]].', 'x', []).needsInput;
    expect(run()).toEqual(['thing']);
    expect(run()).toEqual(['thing']);
  });
});

describe('A.13 — the classification mock', () => {
  const ask = (comment: string) => ({
    action: 'CLASSIFY_COMMENT',
    messages: [{ content: `<comment>${comment}</comment>` }],
  });

  it('answers within the schema', () => {
    const result = mockClassifyResponse.respond(ask('Fix the comma here.'));
    expect(() => classifySchema.parse(result)).not.toThrow();
    expect(COMMENT_CLASSES as readonly string[]).toContain(result.class);
  });

  it('reads a request to rethink an argument as SUBSTANTIVE', () => {
    for (const comment of [
      'This does not follow from the previous section — rethink the argument.',
      'Your conclusion contradicts what you claimed in chapter 2.',
    ]) {
      expect(mockClassifyResponse.respond(ask(comment)).class, comment).toBe('SUBSTANTIVE');
    }
  });

  it('reads a typo or formatting note as MECHANICAL', () => {
    for (const comment of ['Typo: "recieve".', 'Fix the spelling in this sentence.']) {
      expect(mockClassifyResponse.respond(ask(comment)).class, comment).toBe('MECHANICAL');
    }
  });

  it('falls back to CLARIFICATION, the class that costs least when it is wrong', () => {
    // SUBSTANTIVE would wrongly deny a one-click apply; MECHANICAL would wrongly offer one for an
    // argument. CLARIFICATION is the safe middle, so an unrecognised comment lands there.
    expect(mockClassifyResponse.respond(ask('Hmm.')).class).toBe('CLARIFICATION');
  });

  it('only answers a CLASSIFY_COMMENT request', () => {
    expect(mockClassifyResponse.match({ action: 'ASSIST' })).toBe(false);
    expect(mockClassifyResponse.match({ action: 'CLASSIFY_COMMENT' })).toBe(true);
  });
});
