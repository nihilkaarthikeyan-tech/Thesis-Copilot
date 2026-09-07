/**
 * The two §2.2 behaviours the 2026-09-07 audit found unbuilt.
 *
 *   "Language | Follows document language setting."
 *   "Citation toggle | Auto-cite from library can be toggled independently of autocomplete."
 *
 * Both had a home in the data model and no effect: `Document.language` was stored and read by
 * nothing, and the only citation switch was `automaticSuggest`, which is about *when* a suggestion
 * appears rather than whether it cites.
 */

import { describe, expect, it } from 'vitest';
import { buildMemoryBlock, languageLine } from '../src/builder/memory.js';
import { postProcessAssist } from '../src/builder/postprocess.js';

const memory = (language?: string | null) =>
  buildMemoryBlock({
    scope: {
      workingTitle: 'A low-cost solar dryer',
      problemStatement: 'Open drying loses catch.',
      objectives: ['Design it'],
      whyOpen: 'Coastal performance is unreported.',
    },
    outline: [],
    glossary: {},
    styleProfile: null,
    chapter: { outlineNodeId: 'ch-1', text: 'Some chapter text.' },
    ...(language === undefined ? {} : { language }),
  });

describe('§2.2 — the document language reaches the prompt', () => {
  it('says nothing for English, so the cached prefix is unchanged', () => {
    // A.1 already asks for "plain academic English", and every document today is English. Adding
    // a redundant line would invalidate every cached prefix for no gain.
    for (const tag of [undefined, null, '', 'en', 'en-GB', 'EN']) {
      expect(languageLine(tag), String(tag)).toBe(null);
    }
    expect(memory('en').text).toBe(memory().text);
  });

  it('names the language, and says not to write in English, for anything else', () => {
    const line = languageLine('hi');
    expect(line).toContain('Hindi');
    expect(line).toContain('not in English');
  });

  it('knows the languages the picker offers', () => {
    expect(languageLine('ta')).toContain('Tamil');
    expect(languageLine('bn')).toContain('Bengali');
    expect(languageLine('fr')).toContain('French');
  });

  it('passes an unknown tag through rather than inventing a name for it', () => {
    // "Write in mr-IN" is still an instruction a model follows; a made-up language name is not.
    const line = languageLine('xx-YZ');
    expect(line).toContain('xx-YZ');
  });

  it('appends the line after the memory block, leaving the block itself untouched', () => {
    // `_memory.md` is verbatim from Appendix A (§0.3 rule 6) and has no slot for this.
    const english = memory('en').text;
    const hindi = memory('hi').text;
    expect(hindi.startsWith(english)).toBe(true);
    expect(hindi.slice(english.length)).toContain('Hindi');
  });
});

describe('§2.2 — auto-cite is toggled independently of autocomplete', () => {
  const output = 'Cost was the main barrier {{cite:S1#c1}}. Awareness mattered less.';
  const passages = ['S1#c1'];

  it('keeps citations when the toggle is on, which is the default', () => {
    for (const autoCite of [undefined, true]) {
      const out = postProcessAssist({ output, passageIds: passages, before: '', autoCite });
      expect(out.text, String(autoCite)).toContain('{{cite:S1#c1}}');
      expect(out.cited, String(autoCite)).toEqual(['S1#c1']);
    }
  });

  it('removes every marker when it is off', () => {
    const out = postProcessAssist({ output, passageIds: passages, before: '', autoCite: false });
    expect(out.text).not.toContain('{{cite:');
    expect(out.cited).toEqual([]);
    // The sentence survives; only the marker goes.
    expect(out.text).toContain('Cost was the main barrier');
  });

  it('does not count a suppressed citation as a hallucination', () => {
    // The student turned them off. Counting that as the model inventing a source would poison the
    // one metric that says whether grounding is working (§10.6).
    const out = postProcessAssist({ output, passageIds: passages, before: '', autoCite: false });
    expect(out.hallucinated).toEqual([]);
  });

  it('still strips a genuinely invented citation when the toggle is on', () => {
    const out = postProcessAssist({
      output: 'A claim {{cite:S9#c9}}.',
      passageIds: passages,
      before: '',
      autoCite: true,
    });
    expect(out.hallucinated).toEqual(['S9#c9']);
  });

  it('tidies the space a removed marker leaves before the full stop', () => {
    const out = postProcessAssist({ output, passageIds: passages, before: '', autoCite: false });
    expect(out.text).not.toMatch(/\s+\./);
  });
});
