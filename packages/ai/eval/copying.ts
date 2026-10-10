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
  /**
   * ADR-0147 round 3: the most words of a shared run that are not a proper name, a figure or a
   * term the passage defines with its own acronym (`passageTokens`). Reported beside `longestRun`,
   * never instead of it.
   */
  longestRunNames: number;
  /** That run, as words. */
  runTextNames: string;
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
  /** ADR-0079: sentences restating a paper's aims, scope or setting. */
  aims: number;
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
const OPENS_THE_STUDY = /^the\s+(study|research|investigation|paper)\b(?!\s+by\b)/i;

export function callsSourceTheStudy(sentence: string): boolean {
  const s = sentence.trim();
  return THIS_STUDY.test(s) || OPENS_THE_STUDY.test(s);
}

/**
 * ADR-0079: a paper's aims, scope or setting restated as a sentence of the thesis. The same-topic
 * run of 2026-10-05 wrote "The study focuses on rural women in Virudhunagar district {{cite:…}}"
 * and "This research concentrates on…", which in a thesis read as the thesis's own aim, and ADR-0078's
 * renaming and filter do not catch them. Counted: a research noun ("study", "research", "paper",
 * "review", "article", "investigation", "analysis") followed in the same sentence by a verb of
 * intent or setting (aims, intends, seeks, set out, focuses, concentrates, was conducted, was
 * carried out, examines, investigates, explores), or "focuses on"/"concentrates on" anywhere.
 * A finding ("the study found that 57% were housewives") does not match.
 */
const AIMS =
  /\b(study|research|paper|review|article|investigation|analysis|work)\b[^.;:]{0,40}?\b(aims?|aimed|intends?|intended|seeks?|sought|set out|sets out|focus(es|ed|ing)?|concentrat(es|ed|ing)|was (conducted|carried out|undertaken)|were conducted|examines?|examined|investigates?|investigated|explores?|explored|is to|was to)\b/i;
const FOCUSES_ON = /\b(focus(es|ed|ing)?|concentrat(es|ed|ing)) on\b/i;

export function statesAims(sentence: string): boolean {
  const s = sentence.trim();
  return AIMS.test(s) || FOCUSES_ON.test(s);
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

/** Short words an acronym's letters skip ("Ministry of New and Renewable Energy (MNRE)"). */
const ACRONYM_SKIPS = new Set(['of', 'and', 'the', 'for', 'in', 'on', 'to', 'a', 'an', 'de']);

/**
 * ADR-0147 round 3: the passage as `words()` tokenises it, each word marked `name` when the words
 * a writer must keep as written: a proper name (capitalised other than at the start of a sentence,
 * or an all-capitals acronym), a figure (any digit), or the words of a term the passage itself
 * defines by an acronym in parentheses whose letters they spell ("sustainable crop residue
 * management practices (SCRMPs)"). Marked by position, so the same word elsewhere in the passage
 * still counts.
 */
export function passageTokens(text: string): Array<{ word: string; name: boolean }> {
  const out: Array<{ word: string; name: boolean }> = [];
  const re = /[\p{L}\p{N}]+/gu;
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const token = m[0];
    const between = text.slice(last, m.index);
    last = m.index + token.length;
    const initial = out.length === 0 || /[.!?:]/.test(between);
    const acronym = /^\p{Lu}{2,}s?$/u.test(token);
    const name =
      /\p{N}/u.test(token) || acronym || (!initial && /^\p{Lu}/u.test(token) && token.length > 1);
    out.push({ word: token.toLowerCase(), name });
    if (acronym && /\(\s*$/.test(between)) {
      const letters = token.replace(/s$/, '').toLowerCase();
      let li = letters.length - 1;
      const marked: number[] = [];
      for (let k = out.length - 2; k >= 0 && li >= 0; k--) {
        const w = out[k] as { word: string; name: boolean };
        if (w.word[0] === letters[li]) {
          marked.push(k);
          li--;
        } else if (!ACRONYM_SKIPS.has(w.word)) break;
      }
      if (li < 0) for (const k of marked) (out[k] as { name: boolean }).name = true;
    }
  }
  return out;
}

/**
 * The shared run with the most words that are not names (`passageTokens`), and that count. Same
 * dynamic programme as `longestCommonRun`; a run's words must still match consecutively.
 */
export function longestRunOutsideNames(
  mine: readonly string[],
  passage: ReadonlyArray<{ word: string; name: boolean }>,
): { count: number; aStart: number; length: number } {
  let prevLen = new Array<number>(passage.length + 1).fill(0);
  let prevCount = new Array<number>(passage.length + 1).fill(0);
  let best = { count: 0, aStart: 0, length: 0 };
  for (let i = 1; i <= mine.length; i++) {
    const curLen = new Array<number>(passage.length + 1).fill(0);
    const curCount = new Array<number>(passage.length + 1).fill(0);
    for (let j = 1; j <= passage.length; j++) {
      const p = passage[j - 1] as { word: string; name: boolean };
      if (mine[i - 1] !== p.word) continue;
      curLen[j] = (prevLen[j - 1] ?? 0) + 1;
      curCount[j] = (prevCount[j - 1] ?? 0) + (p.name ? 0 : 1);
      const count = curCount[j] ?? 0;
      if (count > best.count) {
        const length = curLen[j] ?? 0;
        best = { count, aStart: i - length, length };
      }
    }
    prevLen = curLen;
    prevCount = curCount;
  }
  return best;
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
  let outsideNames = { count: 0, aStart: 0, length: 0 };
  for (const p of passages) {
    const run = longestRunOutsideNames(mine, passageTokens(p.text));
    if (run.count > outsideNames.count) outsideNames = run;
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
    longestRunNames: outsideNames.count,
    runTextNames: mine
      .slice(outsideNames.aStart, outsideNames.aStart + outsideNames.length)
      .join(' '),
    flagged,
    sentences: sentences.length,
    citedSentences: sentences.filter((s) => /\{\{cite:[^}]+\}\}/.test(s)).length,
    citations: (body.match(CITE) ?? []).length,
    intensifiers,
    selfDescribing: sentences.filter(isSelfDescribing).length,
    ownStudy: sentences.filter((s) => callsSourceTheStudy(s)).length,
    aims: sentences.filter((s) => statesAims(s)).length,
    quotedWords: quoted.reduce((n, q) => n + words(q).length, 0),
  };
}

export type MeasureTotals = {
  outputs: number;
  /** Outputs with a shared run of 6+ words with a passage (quotations removed). */
  run6: number;
  /** …of 8+ words, the verbatim bar of ADR-0071. */
  run8: number;
  /**
   * ADR-0147 round 3: outputs with a shared run holding 6+ words that are not proper names,
   * figures or the passage's own acronym-defined terms. The threshold is `run6`'s.
   */
  run6Names: number;
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
  /** ADR-0079: sentences restating a paper's aims, scope or setting. */
  aims: number;
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
    run6Names: nonEmpty.filter((m) => (m.longestRunNames ?? m.longestRun) >= 6).length,
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
    aims: sum((m) => m.aims ?? 0),
    quotedWords: sum((m) => m.quotedWords),
  };
}
