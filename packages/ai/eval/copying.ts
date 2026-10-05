/**
 * Measures for the copying round (ADR-0075, 2026-10-05), taken in code on what the student would
 * see, after production's post-processing.
 *
 * The side-by-side study (docs/research/side-by-side-2026-10-05.md §4, §7) found three faults in
 * Assist and Draft that a judge alone would not count: a suggestion that reused its cited passage
 * almost word for word, two claims sharing one citation, an intensifier the passage did not use;
 * and a draft that opened by describing itself. Each is counted here.
 *
 * The copying measure is the product's own: `longestCommonRun` and `closeToPassages` from
 * @tc/retrieval (ADR-0071), imported by path because @tc/retrieval depends on @tc/ai and the
 * evaluation is not part of either package's build. Words inside quotation marks are left out of
 * the run: a quotation is attribution, not copying.
 */

import { closeToPassages, longestCommonRun, words } from '../../retrieval/src/paraphrase.js';
import type { PromptPassage } from '../src/builder/assist.js';
import { splitSentences } from '../src/builder/quality.js';

export type Measures = {
  /** Longest run of identical words shared with any passage in the request, quotations removed. */
  longestRun: number;
  /** The run, as words, for the record. */
  runText: string;
  /** Production's ADR-0071 flag ("close to Bagla 2026's wording") would show. */
  flagged: boolean;
  /** Sentences of prose (headings and needs-source lines left out). */
  sentences: number;
  /** Sentences carrying their own citation. */
  citedSentences: number;
  /** Citation markers. */
  citations: number;
  /** Intensifiers that no passage in the request uses. */
  intensifiers: string[];
  /** ADR-0078: sentences calling a source "this study" / "the study". */
  ownStudy: number;
  /** Sentences that describe the section, chapter or review rather than the evidence. */
  selfDescribing: number;
  /** Words inside quotation marks. */
  quotedWords: number;
};

const CITE = /\{\{cite:[^}]+\}\}/g;

/**
 * A.1 forbids "empty intensifiers ('significant', 'crucial', 'various') unless the passage
 * supports them". The list is the usual academic set; a word counts only when no passage in the
 * request contains it, so "significantly" reporting a test the paper ran is not counted.
 */
const INTENSIFIERS = [
  'significant',
  'significantly',
  'substantial',
  'substantially',
  'crucial',
  'crucially',
  'critical',
  'critically',
  'various',
  'vital',
  'pivotal',
  'paramount',
  'notably',
  'remarkably',
  'considerably',
  'greatly',
  'highly',
  'dramatically',
  'profoundly',
  'extremely',
  'very',
  'markedly',
  'severely',
];

/** "This chapter presents…", "This section examines…", "In this section…", "The following review…". */
const SELF_DESCRIBING = [
  /^(this|the present|the following|the current|the next)\s+(section|subsection|chapter|review|synthesis|part|discussion)\b/i,
  /^in (this|the following|the present) (section|subsection|chapter|review|part)\b/i,
];

/**
 * ADR-0078: a source called "this study", "the study", "this research"… In a thesis those words
 * mean the student's own work, so a cited sentence that uses them about a paper reads as a claim
 * about the thesis (the real-model run, 2026-10-05: "The study employs a qualitative, exploratory
 * design…", and "the framework used in this study" about Bagla 2026). "This study" counts
 * anywhere; "the study" only when it opens the sentence: "Bagla reports…; the study used…" has
 * already named its source and reads correctly.
 */
const THIS_STUDY = /\b(this|the present|the current|our)\s+(study|research|investigation|paper)\b/i;
const OPENS_THE_STUDY = /^the\s+(study|research|investigation|paper)\b/i;

export function callsSourceTheStudy(sentence: string): boolean {
  const s = sentence.trim();
  return THIS_STUDY.test(s) || OPENS_THE_STUDY.test(s);
}

export function isSelfDescribing(sentence: string): boolean {
  const s = sentence.replace(/^#+\s.*$/m, '').trim();
  return SELF_DESCRIBING.some((re) => re.test(s));
}

/** Prose only: Markdown headings and needs-source lines are not sentences of the thesis. */
function prose(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line) && !/^\s*\[\[NEEDS SOURCE/i.test(line))
    .join('\n');
}

export function measure(text: string, passages: readonly PromptPassage[]): Measures {
  const body = prose(text);
  const quoted = [...body.matchAll(/["“]([^"”]+)["”]/g)].map((m) => m[1] ?? '');
  const unquoted = body.replace(/["“][^"”]+["”]/g, ' ').replace(CITE, ' ');
  const mine = words(unquoted);

  let longest = { length: 0, aStart: 0 };
  for (const p of passages) {
    const run = longestCommonRun(mine, words(p.text));
    if (run.length > longest.length) longest = run;
  }

  const flagged =
    closeToPassages(
      body.replace(/["“][^"”]+["”]/g, ' '),
      passages.map((p) => ({
        chunkId: p.id,
        sourceId: p.id,
        shortRef: p.shortRef,
        page: p.page,
        text: p.text,
      })),
    ) !== null;

  const sentences = splitSentences(body.replace(/\n+/g, ' ')).filter(
    (s) => words(s.replace(CITE, ' ')).length >= 4,
  );
  const sources = passages.map((p) => p.text.toLowerCase()).join(' ');
  const intensifiers = mine.filter(
    (w) => INTENSIFIERS.includes(w) && !new RegExp(`\\b${w}\\b`).test(sources),
  );

  return {
    longestRun: longest.length,
    runText: mine.slice(longest.aStart, longest.aStart + longest.length).join(' '),
    flagged,
    sentences: sentences.length,
    citedSentences: sentences.filter((s) => /\{\{cite:[^}]+\}\}/.test(s)).length,
    citations: (body.match(CITE) ?? []).length,
    intensifiers,
    selfDescribing: sentences.filter(isSelfDescribing).length,
    ownStudy: sentences.filter((s) => callsSourceTheStudy(s)).length,
    quotedWords: quoted.reduce((n, q) => n + words(q).length, 0),
  };
}

export type MeasureTotals = {
  outputs: number;
  /** Outputs with a shared run of 6+ words with a passage (quotations removed). */
  run6: number;
  /** …of 8+ words, the verbatim bar of ADR-0071. */
  run8: number;
  /** Outputs production's own check would flag. */
  flagged: number;
  meanLongestRun: number;
  sentences: number;
  citedSentences: number;
  /** Sentences in an answer that cites, but not carrying a citation of their own. */
  sharedCitation: number;
  citations: number;
  /** Sentences per citation marker, over answers that cite. */
  claimsPerCitation: number;
  intensifiers: number;
  selfDescribing: number;
  ownStudy: number;
  quotedWords: number;
};

export function totals(all: readonly Measures[]): MeasureTotals {
  const nonEmpty = all.filter((m) => m.sentences > 0);
  const citing = nonEmpty.filter((m) => m.citations > 0);
  const sum = (f: (m: Measures) => number, xs = nonEmpty) => xs.reduce((n, m) => n + f(m), 0);
  return {
    outputs: nonEmpty.length,
    run6: nonEmpty.filter((m) => m.longestRun >= 6).length,
    run8: nonEmpty.filter((m) => m.longestRun >= 8).length,
    flagged: nonEmpty.filter((m) => m.flagged).length,
    meanLongestRun: nonEmpty.length ? +(sum((m) => m.longestRun) / nonEmpty.length).toFixed(2) : 0,
    sentences: sum((m) => m.sentences),
    citedSentences: sum((m) => m.citedSentences),
    sharedCitation: sum((m) => m.sentences - m.citedSentences, citing),
    citations: sum((m) => m.citations),
    claimsPerCitation: sum((m) => m.citations, citing)
      ? +(sum((m) => m.sentences, citing) / sum((m) => m.citations, citing)).toFixed(2)
      : 0,
    intensifiers: sum((m) => m.intensifiers.length),
    selfDescribing: sum((m) => m.selfDescribing),
    ownStudy: sum((m) => m.ownStudy ?? 0),
    quotedWords: sum((m) => m.quotedWords),
  };
}
