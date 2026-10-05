/**
 * What the AI writes must read like a thesis, not like a plan for one (2026-09-30).
 *
 * A reviewer compared a Literature Review written with Jenni against one written here and found,
 * in ours: the same sentence twice in a row, the same "this section will…" roadmap restated three
 * or four times, and a "Despite this" with nothing before it to contrast. The causes were
 * mechanical. With no source to cite, A.1 told the model to "write a structural or connective
 * sentence instead (for example, one that introduces what the section will examine)", so every
 * suggestion came back as a roadmap sentence, near-copies of each other, and each was accepted.
 *
 * These filters run in code on everything the model offers, before the student sees it:
 *
 * - **duplicates** — a sentence that nearly matches one already in the chapter (or earlier in the
 *   same answer) is dropped;
 * - **roadmap filler** — a self-describing, future-tense sentence ("This section will
 *   synthesize…", "The following sub-themes will…") that cites nothing is dropped. The proposal is
 *   written elsewhere and is not filtered here;
 * - **dangling connectives** — a sentence opening with "Despite this", "However", "Furthermore"…
 *   is dropped when nothing before it is a claim it could refer to: the start of a paragraph, or
 *   a roadmap sentence.
 *
 * Code, not prompt, because the prompt is the owner's to change (PRD §0.3 rule 6) and because a
 * rule in code holds for every model, every time.
 */

export type QualityDrops = {
  duplicate: number;
  roadmap: number;
  dangling: number;
  /** A claim attributed to research ("recent work shows…") with no citation. */
  unsupported: number;
};

const CITE = /\{\{cite:[^}]+\}\}/;

/**
 * The full stop of an abbreviation, not the end of a sentence (2026-09-30). "et al." ended a
 * sentence as far as the splitters knew, so a suggestion naming a study was cut off mid-sentence
 * ("…while Zhao et al.") — the prompt evaluation (ADR-0038) caught it.
 */
const ABBREVIATIONS = new Set([
  'al',
  'e.g',
  'i.e',
  'eg',
  'ie',
  'cf',
  'vs',
  'ca',
  'approx',
  'fig',
  'figs',
  'eq',
  'eqs',
  'no',
  'nos',
  'vol',
  'pp',
  'dr',
  'prof',
  'resp',
  'viz',
  'wt',
]);

export function isAbbreviationStop(text: string, i: number): boolean {
  if (text[i] !== '.') return false;
  const word = /([A-Za-z]+(?:\.[A-Za-z]+)*)$/.exec(text.slice(Math.max(0, i - 12), i))?.[1];
  if (!word) return false;
  // A single capital is an author's initial ("J. Smith"), not a sentence.
  if (/^[A-Z]$/.test(word)) return true;
  return ABBREVIATIONS.has(word.toLowerCase());
}

/** Sentences, each keeping any `{{cite:…}}` that follows its terminator. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('{{', i)) {
      const end = text.indexOf('}}', i);
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    const char = text[i] as string;
    if (
      (char === '.' || char === '?' || char === '!' || char === '\n') &&
      !isAbbreviationStop(text, i)
    ) {
      let end = i + 1;
      while (end < text.length && /[.!?"')\]”’]/.test(text[end] as string)) end++;
      const rest = text.slice(end);
      if (char === '\n' || rest.length === 0 || /^\s/.test(rest)) {
        const trailing = /^\s*(\{\{cite:[^}]+\}\}\s*)+/.exec(rest);
        const stop = trailing ? end + trailing[0].trimEnd().length : end;
        const sentence = text.slice(start, stop).trim();
        if (sentence) out.push(sentence);
        start = stop;
        i = stop;
        continue;
      }
    }
    i++;
  }
  const last = text.slice(start).trim();
  if (last) out.push(last);
  return out;
}

const STOP = new Set([
  'a',
  'an',
  'the',
  'of',
  'in',
  'on',
  'for',
  'to',
  'and',
  'or',
  'is',
  'are',
  'was',
  'were',
  'be',
  'this',
  'that',
  'these',
  'those',
  'with',
  'by',
  'as',
  'at',
  'it',
  'its',
  'from',
  'which',
]);

function words(sentence: string): string[] {
  return sentence
    .replace(/\{\{cite:[^}]+\}\}/g, ' ')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0 && !STOP.has(w));
}

/**
 * Near-duplicate: most of the shorter sentence's content words appear in the other. Measured on
 * content words so "a gap this thesis seeks to address" and "the gap the thesis seeks to address"
 * count as the same sentence, and short sentences are never compared (four words agree by chance).
 */
export function nearDuplicate(a: string, b: string): boolean {
  const wa = new Set(words(a));
  const wb = new Set(words(b));
  const smaller = Math.min(wa.size, wb.size);
  if (smaller < 5) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  const union = wa.size + wb.size - shared;
  return shared / smaller >= 0.8 || shared / union >= 0.7;
}

const ROADMAP: readonly RegExp[] = [
  // "This section will synthesize…", "The present review will…", "This chapter shall…"
  /\b(this|the present|the following|the next|the current)\s+(section|subsection|chapter|review|synthesis|study|part|discussion|analysis)\s+(will|shall|is going to|aims to|seeks to)\b/i,
  // "The following sub-themes organize the review…", "This section reviews prior work … to map…"
  /^(the following|this section|this chapter|this review|this synthesis)\b.*\b(organi[sz]e|organi[sz]ed|will|map what|delineate)\b/i,
  // "…will be organized by sub-theme…"
  /\bwill be (organi[sz]ed|structured|divided|arranged)\b/i,
  // "The synthesis will identify…", "It will also articulate…"
  /^(the synthesis|the review|it|they)\s+will\s+(also\s+)?(synthesi[sz]e|identify|examine|explore|discuss|review|outline|articulate|describe|summari[sz]e|highlight|address|map|note)\b/i,
];

/** A self-describing roadmap sentence that makes no claim of its own and cites nothing. */
export function isRoadmap(sentence: string): boolean {
  if (CITE.test(sentence)) return false;
  return ROADMAP.some((re) => re.test(sentence.trim()));
}

/**
 * A sentence that credits "research" with a finding. With a citation it is a claim about a
 * source; without one it is a claim about sources nobody can check, which A.1 forbids and which
 * gpt-5-nano wrote anyway on an empty library ("However, recent work shows that optimizing
 * process parameters can mitigate electrode wear…", 2026-09-30).
 */
const ATTRIBUTION: readonly RegExp[] = [
  /\b(studies|research|researchers|work|works|literature|evidence|findings|experiments|investigations|reports|authors|scholars|analyses)\s+(has |have |had )?(also )?(shown|show|shows|found|find|finds|demonstrated|demonstrate|demonstrates|reported|report|reports|indicated|indicate|indicates|suggested|suggest|suggests|revealed|reveal|reveals|established|confirmed|highlighted|noted|observed)\b/i,
  /\bit (has been|is|was) (widely |well |generally |often |frequently )?(shown|reported|established|documented|demonstrated|observed|accepted|recognised|recognized)\b/i,
  /\baccording to (recent |previous |prior |the |existing )?(studies|research|literature|reports)\b/i,
  /\b(prior|previous|earlier|recent|existing|several|numerous|many) (studies|research|work|investigations|reports)\b/i,
];

/** Credits research with a finding and cites nothing. */
export function isUncitedAttribution(sentence: string): boolean {
  if (CITE.test(sentence)) return false;
  return ATTRIBUTION.some((re) => re.test(sentence));
}

const OWN_WORK = /\b(this|the present|the current|our)\s+(study|research|investigation|thesis)\b/i;

/**
 * ADR-0078: "this study" with a citation. In a thesis "this study" is the student's own, and the
 * student's own study is never cited to a paper, so the sentence describes the paper as if it
 * were the thesis ("This study focuses on rural women in Virudhunagar district… (College 2025)",
 * the same-topic run of 2026-10-05). Always wrong, so dropped; uncited, it may be the student's.
 */
export function isCitedOwnStudy(sentence: string): boolean {
  return CITE.test(sentence) && OWN_WORK.test(sentence);
}

const CONNECTIVE =
  /^(despite (this|these|that)|however|furthermore|moreover|additionally|in addition|nevertheless|nonetheless|consequently|therefore|thus|hence|in contrast|conversely|similarly|likewise|as a result|by contrast)\b/i;

export function opensWithConnective(sentence: string): boolean {
  return CONNECTIVE.test(sentence.trim());
}

const CITE_ALL = /\{\{cite:[^}]+\}\}/g;

/**
 * A heading or caption: a whole block of at most fifteen words that does not end a sentence.
 * Markdown `#` marks count too, since a drafted section's text carries them.
 */
export function isHeadingLine(line: string): boolean {
  const text = line.replace(CITE_ALL, '').trim();
  if (text.length === 0) return false;
  if (/^#{1,6}\s/.test(text)) return true;
  return !/[.!?]["'”’)\]]*$/.test(text) && text.split(/\s+/).length <= 15;
}

/**
 * Filters one answer from the model, sentence by sentence, against what is already written.
 *
 * `before` is the text immediately before the cursor (for "is there a claim to contrast with?");
 * `existing` is the rest of the chapter (for duplicates). Both may be empty.
 */
export function filterSentences(input: { text: string; before: string; existing: string }): {
  text: string;
  drops: QualityDrops;
} {
  const drops: QualityDrops = { duplicate: 0, roadmap: 0, dangling: 0, unsupported: 0 };
  const sentences = splitSentences(input.text);
  if (sentences.length === 0) return { text: input.text, drops };

  // ADR-0075: a heading is not a sentence the suggestion could repeat. Under "Barriers to
  // household rooftop solar adoption", an on-topic suggestion shares the heading's words and was
  // dropped as its duplicate, leaving the student with nothing. The block being written (the
  // last line of `before`) is always compared, finished or not.
  const beforeLines = input.before.split('\n');
  const current = beforeLines.pop() ?? '';
  const blocks = [...input.existing.split('\n'), ...beforeLines].filter((l) => !isHeadingLine(l));
  const written = splitSentences(`${blocks.join('\n')}\n${current}`).filter(
    (s) => words(s).length >= 5,
  );
  // The sentence the first suggestion sentence follows: the last one before the cursor, in the
  // same paragraph. A paragraph break means there is none.
  const paragraph = input.before.split(/\n/).pop() ?? '';
  const beforeSentences = splitSentences(paragraph);
  let previous: string | null = beforeSentences[beforeSentences.length - 1] ?? null;

  const kept: string[] = [];
  for (const sentence of sentences) {
    if (isRoadmap(sentence)) {
      drops.roadmap++;
      continue;
    }
    if (isUncitedAttribution(sentence) || isCitedOwnStudy(sentence)) {
      drops.unsupported++;
      continue;
    }
    if (opensWithConnective(sentence) && (previous === null || isRoadmap(previous))) {
      drops.dangling++;
      continue;
    }
    if ([...written, ...kept].some((other) => nearDuplicate(sentence, other))) {
      drops.duplicate++;
      continue;
    }
    kept.push(sentence);
    previous = sentence;
  }

  const removed = drops.duplicate + drops.roadmap + drops.dangling + drops.unsupported;
  return { text: removed === 0 ? input.text : kept.join(' '), drops };
}
