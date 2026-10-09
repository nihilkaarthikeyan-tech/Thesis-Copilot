/**
 * ADR-0147: academic punctuation. Dashes used as punctuation become a thesis's commas, colons,
 * semicolons and parentheses; nothing else changes. Many of the inputs are sentences the real
 * models wrote in the stored evaluation runs (`eval/results/`).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  academicPunctuation,
  academicPunctuationUnlessStudents,
  countDashes,
  stockPhrases,
} from '../src/builder/academic-style.js';
import { unchangedSentencesKept } from '../src/builder/chapter-build.js';
import { postProcessChat } from '../src/builder/chat.js';
import { citationMoved, postProcessCommand } from '../src/builder/command.js';
import { postProcessRevision } from '../src/builder/comment.js';
import { postProcessDraft } from '../src/builder/draft.js';
import { postProcessAssist } from '../src/builder/postprocess.js';
import { postProcessProofread } from '../src/builder/proofread.js';
import { splitSentences } from '../src/builder/quality.js';
import { postProcessTone } from '../src/builder/tone.js';

const letters = (t: string) => t.replace(/[^\p{L}\p{N}]/gu, '');
const markers = (t: string) => [...t.matchAll(/\{\{[^}]*\}\}/g)].map((m) => m[0]);

/** Every case: the rule's own output, and the invariants that hold for any input. */
function check(input: string, expected: string): void {
  const out = academicPunctuation(input);
  expect(out).toBe(expected);
  expect(letters(out)).toBe(letters(input));
  expect(markers(out)).toEqual(markers(input));
  for (const key of new Set(markers(input).map((m) => m.slice(7, -2)))) {
    expect(citationMoved(input, out, key) && !citationMoved(input, input, key)).toBe(false);
  }
}

describe('academicPunctuation: a pair of dashes around an aside', () => {
  const cases: Array<[string, string]> = [
    [
      'Financial constraints—especially the initial investment burden—are repeatedly emphasised as a primary inhibitor. {{cite:S3#c1}}',
      'Financial constraints, especially the initial investment burden, are repeatedly emphasised as a primary inhibitor. {{cite:S3#c1}}',
    ],
    ['The method — which was new — worked.', 'The method, which was new, worked.'],
    [
      'Heat treatment relieves residual stresses and—under intercritical conditions—reverses martensite to austenite. {{cite:S3#c1}}',
      'Heat treatment relieves residual stresses and, under intercritical conditions, reverses martensite to austenite. {{cite:S3#c1}}',
    ],
    // The aside has its own commas: parentheses.
    [
      'Users report barriers—such as cost, trust and privacy—that slow adoption. {{cite:S5#c1}}',
      'Users report barriers (such as cost, trust and privacy) that slow adoption. {{cite:S5#c1}}',
    ],
    // A list joined by "and": parentheses, so it does not read as part of the sentence's list.
    [
      'SLM imparts unique features in steels—hierarchical subgrains and fine precipitates—that enhance strength. {{cite:S6#c1}}',
      'SLM imparts unique features in steels (hierarchical subgrains and fine precipitates) that enhance strength. {{cite:S6#c1}}',
    ],
    // "which" after the closing parenthesis keeps the comma the pair stood for.
    [
      'The number of apps grew—estimated at 40,000 in 2012 and 100,000 by 2014—which created a large supply. {{cite:S3#c1}}',
      'The number of apps grew (estimated at 40,000 in 2012 and 100,000 by 2014), which created a large supply. {{cite:S3#c1}}',
    ],
    // A participle after the aside also takes the comma.
    [
      'Studies identify barriers to continued use—such as usefulness, reminders and credibility—pointing to mechanisms. {{cite:S5#c1}}',
      'Studies identify barriers to continued use (such as usefulness, reminders and credibility), pointing to mechanisms. {{cite:S5#c1}}',
    ],
    // Spaced en dashes are dashes too.
    [
      'Implementation context – especially clinician integration – shapes continued use.',
      'Implementation context, especially clinician integration, shapes continued use.',
    ],
    // Spaced hyphens used as dashes.
    [
      'Adoption - at least in Kerala - rose after 2018.',
      'Adoption, at least in Kerala, rose after 2018.',
    ],
    // Double hyphens.
    [
      'The panels--once costly--are now affordable.',
      'The panels, once costly, are now affordable.',
    ],
    // A citation inside the aside stays inside it.
    [
      'Credit alone—as one ethnography found {{cite:S5#c1}}—can deepen debt.',
      'Credit alone, as one ethnography found {{cite:S5#c1}}, can deepen debt.',
    ],
    // A whole clause as the aside: parentheses.
    [
      'The trial—it ran for three months—found no difference in HbA1c. {{cite:S6#c1}}',
      'The trial (it ran for three months) found no difference in HbA1c. {{cite:S6#c1}}',
    ],
    // An aside that ends the clause before a comma.
    ['Uptake rose—slowly—, then fell.', 'Uptake rose, slowly, then fell.'],
  ];
  for (const [input, expected] of cases) it(input.slice(0, 60), () => check(input, expected));
});

describe('academicPunctuation: one dash', () => {
  const cases: Array<[string, string]> = [
    // Before an explanation that is a whole clause: a semicolon.
    [
      'They differ on how microstructure shifts the balance between MRR and tool wear—some report larger grain raises MRR at the cost of wear. {{cite:S1#c1}}',
      'They differ on how microstructure shifts the balance between MRR and tool wear; some report larger grain raises MRR at the cost of wear. {{cite:S1#c1}}',
    ],
    [
      'Costs fell sharply — the panels became affordable.',
      'Costs fell sharply; the panels became affordable.',
    ],
    // Before a list: a colon.
    [
      'Three factors matter most — cost, trust and access.',
      'Three factors matter most: cost, trust and access.',
    ],
    ['The barriers are financial—cost and credit.', 'The barriers are financial: cost and credit.'],
    // A short closing phrase: a colon.
    ['One factor dominates — peak current.', 'One factor dominates: peak current.'],
    // A descriptive phrase: a comma.
    [
      'Adoption remains low in rural Kerala — a pattern reported across several Indian states.',
      'Adoption remains low in rural Kerala, a pattern reported across several Indian states.',
    ],
    [
      'Undermining social capital—highlighting conditions under which credit can worsen constraints. {{cite:S5#c1}}',
      'Undermining social capital, highlighting conditions under which credit can worsen constraints. {{cite:S5#c1}}',
    ],
    // A conjunction: a comma.
    [
      'Subsidies raise uptake — but only where installers are trusted.',
      'Subsidies raise uptake, but only where installers are trusted.',
    ],
    [
      'Peak current was the dominant factor—accounting for the largest share of variance. {{cite:S2#c1}}',
      'Peak current was the dominant factor, accounting for the largest share of variance. {{cite:S2#c1}}',
    ],
    // A linking phrase with its comma, then a clause: a semicolon.
    [
      'Heat treatment strongly affects corrosion outcomes—for example, intercritical tempering is reported to enhance pitting resistance. {{cite:S4#c1}}',
      'Heat treatment strongly affects corrosion outcomes; for example, intercritical tempering is reported to enhance pitting resistance. {{cite:S4#c1}}',
    ],
    // A linking phrase without a clause after it: a comma.
    [
      'Several barriers remain — for example, cost and access.',
      'Several barriers remain, for example, cost and access.',
    ],
    // An answer word.
    [
      'Yes — at least one study in your library finds that subsidies increase adoption. {{cite:S3#c1}}',
      'Yes, at least one study in your library finds that subsidies increase adoption. {{cite:S3#c1}}',
    ],
    // Never a second colon in a sentence.
    [
      'Short answer: the evidence is mixed — some studies find gains.',
      'Short answer: the evidence is mixed; some studies find gains.',
    ],
    // A dash at the end of a sentence is simply removed.
    ['Adoption rose —.', 'Adoption rose.'],
    // A citation before the dash stays on its claim.
    [
      'Subsidies motivate investment {{cite:S3#c1}} — and flexible payment helps poorer households {{cite:S2#c1}}.',
      'Subsidies motivate investment {{cite:S3#c1}}, and flexible payment helps poorer households {{cite:S2#c1}}.',
    ],
    // Two sentences, each with its own dash.
    [
      'Costs fell — the panels became affordable. Uptake rose — slowly.',
      'Costs fell; the panels became affordable. Uptake rose: slowly.',
    ],
  ];
  for (const [input, expected] of cases) it(input.slice(0, 60), () => check(input, expected));
});

describe('academicPunctuation: what is left alone', () => {
  const unchanged = [
    // Ranges.
    'Adoption rose between 2015–2020 {{cite:S1#c1}}.',
    'See pp. 3–9 and 12-15.',
    'Scores ranged from 4 – 7 on the scale.',
    // Hyphenated compounds and name pairs.
    'A dose–response relationship and the Michaelis–Menten model are well known.',
    'Low-cost, well-known, state-of-the-art methods.',
    // Minus signs and subtraction.
    'The difference was 5 - 3 = 2 points.',
    'The temperature fell to −5 °C.',
    // LaTeX.
    'The rate is $k = a - b$ when $x -- y$ holds.',
    '$$\nE = mc^2 - \\Delta\n$$',
    'The bound \\(a - b\\) holds.',
    // Code.
    'Run `pnpm lint -- --fix` first.',
    // A quotation keeps its punctuation.
    'One respondent said "we cannot pay — not now" and left.',
    'The authors call it “a slow — and uneven — transition” {{cite:S2#c1}}.',
    // A Markdown table row.
    '| Factor | Effect — size |\n|---|---|\n| Cost | high — 0.4 |',
    // A horizontal rule and bullets.
    '---',
    '- Cost is the main barrier.\n- Trust matters too.',
    // A citation marker with a hyphen in its id.
    'Uptake is low {{cite:S-1#c-2}}.',
    // A URL.
    'Data are at https://example.org/a--b and nowhere else.',
    // Nothing to do.
    'Plain academic prose with commas, semicolons; and colons: nothing else.',
  ];
  for (const input of unchanged) it(input.slice(0, 60), () => check(input, input));

  it('turns an em dash between two numbers into the en dash of a range', () => {
    check('Adoption rose between 2015—2020.', 'Adoption rose between 2015–2020.');
    check('See pages 3 — 9.', 'See pages 3–9.');
  });
});

describe('academicPunctuation: Hindi and other scripts', () => {
  it('uses commas for a pair in Devanagari text and keeps the danda', () => {
    check(
      'ग्रामीण परिवारों में — विशेषकर केरल में — सौर ऊर्जा का उपयोग बढ़ा है। {{cite:S1#c1}}',
      'ग्रामीण परिवारों में, विशेषकर केरल में, सौर ऊर्जा का उपयोग बढ़ा है। {{cite:S1#c1}}',
    );
  });
  it('uses a comma for a single dash in Devanagari text', () => {
    check(
      'लागत सबसे बड़ी बाधा है — यह कई अध्ययनों में पाया गया है।',
      'लागत सबसे बड़ी बाधा है, यह कई अध्ययनों में पाया गया है।',
    );
  });
  it('handles a Hindi sentence with an English term and a citation', () => {
    check(
      'UPI का उपयोग — शहरी क्षेत्रों में — तेज़ी से बढ़ा {{cite:S2#c1}}।',
      'UPI का उपयोग, शहरी क्षेत्रों में, तेज़ी से बढ़ा {{cite:S2#c1}}।',
    );
  });
});

describe('academicPunctuation: structure around the dashes', () => {
  it('keeps nested parentheses and wraps an aside that has them', () => {
    check(
      'Electrode microstructure (e.g., graphite grain size (fine or coarse))—an often ignored factor—shapes wear.',
      'Electrode microstructure (e.g., graphite grain size (fine or coarse)), an often ignored factor, shapes wear.',
    );
  });
  it('handles a list item with a bold label', () => {
    check(
      '- **Cost** — households cannot pay the upfront price {{cite:S1#c1}}.',
      '- **Cost**: households cannot pay the upfront price {{cite:S1#c1}}.',
    );
  });
  it('handles a heading', () => {
    check('### Barriers — cost and trust', '### Barriers: cost and trust');
  });
  it('works line by line and keeps paragraph breaks', () => {
    check(
      'Costs fell — the panels became affordable.\n\nThe method — which was new — worked.',
      'Costs fell; the panels became affordable.\n\nThe method, which was new, worked.',
    );
  });
  it('keeps a citation right after a pair on its sentence', () => {
    check(
      'Complementary interventions—especially training and networks—amplify impacts {{cite:S7#c1}} {{cite:S3#c1}}.',
      'Complementary interventions (especially training and networks) amplify impacts {{cite:S7#c1}} {{cite:S3#c1}}.',
    );
  });
  it('keeps a needs-source marker untouched (a dash before nothing but a marker goes)', () => {
    check(
      'No passage covers this — [[NEEDS SOURCE: cost data — 2020 to 2024]]',
      'No passage covers this [[NEEDS SOURCE: cost data — 2020 to 2024]]',
    );
  });
  it('handles three dashes in one sentence: a pair, then a single', () => {
    check(
      'Costs—once high—fell sharply — the panels became affordable.',
      'Costs, once high, fell sharply; the panels became affordable.',
    );
  });
  it('does not split a sentence at an abbreviation', () => {
    check(
      'Several factors (e.g. cost) matter—as Sharma et al. report—for uptake.',
      'Several factors (e.g. cost) matter, as Sharma et al. report, for uptake.',
    );
  });
  it('returns the same string object when there is nothing to change', () => {
    const text = 'No dashes here.';
    expect(academicPunctuation(text)).toBe(text);
  });
  it('is idempotent', () => {
    const once = academicPunctuation('Costs—once high—fell — the panels became affordable.');
    expect(academicPunctuation(once)).toBe(once);
  });
});

describe('countDashes and stockPhrases', () => {
  it('counts dashes used as punctuation only', () => {
    expect(countDashes('A—b — c – d - e')).toBe(4);
    expect(countDashes('2015–2020, 3 - 4, well-known\n- a bullet')).toBe(0);
    expect(countDashes('- bullet item — with a dash')).toBe(1);
  });
  it('finds stock phrases', () => {
    expect(
      stockPhrases(
        'It is important to note that trust plays a crucial role. Furthermore, this underscores the need to delve deeper.',
      ),
    ).toEqual([
      'delve',
      // "plays a crucial role" counts under both labels: each is a measure of its own.
      'crucial',
      'it is important to note',
      'plays a vital role',
      'underscores',
      'Furthermore/Moreover/Additionally opener',
    ]);
    expect(stockPhrases('Cost limits adoption in Kerala {{cite:S1#c1}}.')).toEqual([]);
  });
  it('counts "Furthermore," only as a sentence opener', () => {
    expect(stockPhrases('Costs fell. Furthermore, uptake rose.')).toHaveLength(1);
    expect(stockPhrases('Costs fell {{cite:S1#c1}} Moreover, uptake rose.')).toHaveLength(1);
    expect(stockPhrases('The furthermore clause.')).toHaveLength(0);
  });
});

describe('academicPunctuationUnlessStudents', () => {
  it("leaves a rewrite alone when the student's own text used dashes", () => {
    expect(academicPunctuationUnlessStudents('Costs fell — sharply.', 'costs fell — sharply')).toBe(
      'Costs fell — sharply.',
    );
  });
  it("corrects the model's dashes when the student wrote none", () => {
    expect(academicPunctuationUnlessStudents('Costs fell — sharply.', 'costs fell sharply')).toBe(
      'Costs fell: sharply.',
    );
  });
});

describe('ADR-0147: the backstop on every path that puts generated text in front of the student', () => {
  const passages = [{ id: 'S1#c1', shortRef: 'Rao 2021', page: null, text: 'Cost limits uptake.' }];

  it('Assist (ghost text)', () => {
    const out = postProcessAssist({
      output: 'Cost is the main barrier — especially in rural Karnataka {{cite:S1#c1}}.',
      passageIds: ['S1#c1'],
      before: 'Rooftop solar adoption remains low.',
    });
    expect(out.text).toBe(
      'Cost is the main barrier, especially in rural Karnataka {{cite:S1#c1}}.',
    );
    expect(out.cited).toEqual(['S1#c1']);
  });

  it('Draft a section (also the chapter and literature review builds and their fixes)', () => {
    const out = postProcessDraft(
      '### Cost\n\nUpfront cost—the price of panels and inverters—limits uptake among rural households in the state {{cite:S1#c1}}.',
      passages,
      30,
    );
    expect(out.result.markdown).toContain(
      'Upfront cost (the price of panels and inverters) limits uptake',
    );
    expect(countDashes(out.result.markdown)).toBe(0);
  });

  it('Edit commands: corrected when the selection had no dash, kept when it did', () => {
    const plain = postProcessCommand(
      'Costs fell — sharply.',
      'Costs fell sharply.',
      [],
      'formalise',
    );
    expect(plain.text).toBe('Costs fell: sharply.');
    const own = postProcessCommand(
      'Costs fell — sharply.',
      'Costs fell — sharply.',
      [],
      'formalise',
    );
    expect(own.text).toBe('Costs fell — sharply.');
  });

  it('Chat answers', () => {
    const out = postProcessChat('Yes — subsidies raise uptake {{cite:S1#c1}}.', ['S1#c1']);
    expect(out.text).toBe('Yes, subsidies raise uptake {{cite:S1#c1}}.');
  });

  it('A guide-comment revision', () => {
    const out = postProcessRevision(
      'Costs fell — the panels became affordable.',
      'Costs fell.',
      [],
    );
    expect(out.text).toBe('Costs fell; the panels became affordable.');
  });

  it('Tone rewrites', () => {
    const { items } = postProcessTone(
      {
        items: [{ sentenceId: 's1', why: 'register', rewrite: 'Costs fell — sharply — in 2020.' }],
      },
      [{ id: 's1', text: 'Costs fell a lot in 2020.' }],
    );
    expect(items[0]?.replacement).toBe('Costs fell, sharply, in 2020.');
  });

  it('Proofreading never offers a dash as a correction', () => {
    const { corrections } = postProcessProofread(
      {
        corrections: [
          {
            sentenceId: 's1',
            original: 'fell, sharply',
            replacement: 'fell — sharply',
            kind: 'punctuation',
            why: '',
          },
        ],
      },
      [{ id: 's1', text: 'Costs fell, sharply in 2020.' }],
    );
    expect(corrections).toHaveLength(0);
  });

  it('The ADR-0066 edit actions (counter-argument, hedge, translate) go through the same command path', () => {
    const counter = postProcessCommand(
      'Subsidies raise uptake {{cite:S1#c1}} — yet cost still limits it {{cite:S1#c1}}.',
      'Subsidies raise uptake {{cite:S1#c1}}.',
      ['S1#c1'],
      'counter',
    );
    // (The command path already drops the second citation of the same passage.)
    expect(counter.text).toBe('Subsidies raise uptake {{cite:S1#c1}}, yet cost still limits it.');
    expect(counter.hallucinated).toEqual([]);
    const hedge = postProcessCommand(
      'Cost may limit uptake — at least in the households surveyed.',
      'Cost limits uptake.',
      [],
      'hedge',
    );
    expect(hedge.text).toBe('Cost may limit uptake, at least in the households surveyed.');
    // A translation into Hindi: the Devanagari rule, a comma.
    const translate = postProcessCommand(
      'लागत सबसे बड़ी बाधा है — विशेषकर ग्रामीण परिवारों के लिए।',
      'Cost is the main barrier, especially for rural households.',
      [],
      'translate',
    );
    expect(translate.text).toBe('लागत सबसे बड़ी बाधा है, विशेषकर ग्रामीण परिवारों के लिए।');
  });

  it('Deep-research chat answers (headed, with lists) keep their structure and lose the dashes', () => {
    const out = postProcessChat(
      [
        '## Where the sources agree',
        '',
        'Both studies find cost the main barrier — in Karnataka and in Kerala {{cite:S1#c1}}.',
        '',
        '- Subsidies help — but only where installers are trusted {{cite:S1#c1}}.',
        '- Trust matters — less than cost.',
        '',
        '## For your thesis',
        '',
        'The gap is clear: no study — of the two — measures post-installation experience.',
      ].join('\n'),
      ['S1#c1'],
    );
    expect(out.text).toContain('## Where the sources agree');
    expect(out.text).toContain(
      'Both studies find cost the main barrier, in Karnataka and in Kerala {{cite:S1#c1}}.',
    );
    expect(out.text).toContain(
      '- Subsidies help, but only where installers are trusted {{cite:S1#c1}}.',
    );
    expect(out.text).toContain('- Trust matters: less than cost.');
    expect(out.text).toContain('no study, of the two, measures post-installation experience.');
    expect(countDashes(out.text)).toBe(0);
  });

  it('Assist in Hindi', () => {
    const out = postProcessAssist({
      output: 'लागत मुख्य बाधा है — विशेषकर ग्रामीण कर्नाटक में {{cite:S1#c1}}।',
      passageIds: ['S1#c1'],
      before: 'छत पर सौर ऊर्जा का उपयोग कम है।',
    });
    expect(out.text).toBe('लागत मुख्य बाधा है, विशेषकर ग्रामीण कर्नाटक में {{cite:S1#c1}}।');
  });

  it("A chapter-build fix: the backstop's punctuation never counts as a changed sentence", () => {
    // The fixer returns the section with one flagged sentence corrected and a dash elsewhere; the
    // guard compares sentences by their words, so the corrected punctuation keeps `ratio` at 1.
    const original =
      'Upfront cost limits uptake {{cite:S1#c1}}. Trust matters too. Panels are costly.';
    const fixed = postProcessDraft(
      'Upfront cost limits uptake — among rural households {{cite:S1#c1}}. Trust matters too. Panels cost a lot.',
      passages,
      10,
    ).result.markdown;
    expect(fixed).toBe(
      'Upfront cost limits uptake, among rural households {{cite:S1#c1}}. Trust matters too. Panels cost a lot.',
    );
    const kept = unchangedSentencesKept(original, fixed, [
      'Upfront cost limits uptake {{cite:S1#c1}}.',
      'Panels are costly.',
    ]);
    expect(kept).toEqual({ kept: 1, expected: 1, ratio: 1 });
  });

  it('A draft with a table, an equation, code and a quotation keeps every one of them', () => {
    const markdown = [
      '### Results',
      '',
      'The yield rose — from 4–7 t/ha — after 2015–2020 {{cite:S1#c1}}.',
      '',
      '| Year | Yield — t/ha |',
      '|---|---|',
      '| 2015 | 4 — 5 |',
      '',
      '$$\ny = a - b\n$$',
      '',
      'The authors write that "the gain — though small — was real" {{cite:S1#c1}}. See `a -- b`.',
    ].join('\n');
    const out = postProcessDraft(markdown, passages, 10).result.markdown;
    expect(out).toContain('The yield rose, from 4–7 t/ha, after 2015–2020 {{cite:S1#c1}}.');
    expect(out).toContain('| Year | Yield — t/ha |');
    expect(out).toContain('| 2015 | 4 — 5 |');
    expect(out).toContain('$$\ny = a - b\n$$');
    expect(out).toContain('"the gain — though small — was real" {{cite:S1#c1}}');
    expect(out).toContain('`a -- b`');
  });
});

describe('ADR-0147: punctuation only, on every output the real models wrote in the stored runs', () => {
  // `eval/results/*.json` holds what the models wrote (`aRaw`, `bRaw`) for every evaluated path.
  // Whatever the rule does to them, the words, numbers and citation markers must be the same,
  // every citation must stay in its sentence, and no dash used as punctuation may remain.
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, '..', 'eval', 'results');
  const outputs: Array<{ file: string; text: string }> = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const data = JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
      rows?: Array<Record<string, unknown>>;
    };
    for (const row of data.rows ?? []) {
      for (const side of ['aRaw', 'bRaw']) {
        const text = row[side];
        if (typeof text === 'string' && text.trim() && !text.startsWith('FAILED')) {
          outputs.push({ file, text });
        }
      }
    }
  }
  const PROSE = /^(assist|draft|chat|chat_deep|command|revise)-/;
  const citationSentences = (text: string) =>
    splitSentences(text).flatMap((s, i) => [...s.matchAll(/\{\{cite:[^}]+\}\}/g)].map(() => i));

  it(`holds on all ${outputs.length} stored outputs`, () => {
    expect(outputs.length).toBeGreaterThan(1000);
    const faults: string[] = [];
    let changed = 0;
    for (const { file, text } of outputs) {
      const out = academicPunctuation(text);
      if (out !== text) changed++;
      if (letters(out) !== letters(text)) faults.push(`${file}: words changed`);
      if (markers(out).join() !== markers(text).join()) faults.push(`${file}: markers changed`);
      if (citationSentences(out).join() !== citationSentences(text).join()) {
        faults.push(`${file}: a citation moved`);
      }
      // A structured output (a proposal skeleton, an outline) is JSON whose strings are quoted,
      // and a quotation keeps its punctuation; the prose paths must come out with no dash.
      if (PROSE.test(file) && countDashes(out) > 0) {
        faults.push(`${file}: a dash remains: ${out.slice(0, 80)}`);
      }
      if (academicPunctuation(out) !== out) faults.push(`${file}: not idempotent`);
    }
    expect(faults).toEqual([]);
    // The rule did something: the stored drafts and edit commands are full of dashes.
    expect(changed).toBeGreaterThan(100);
  });
});
