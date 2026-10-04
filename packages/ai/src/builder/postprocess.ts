/**
 * A.1 post-processing — PRD Appendix A.1, "Post-processing (in code, in this order)":
 *
 *   (1) strip any `{{cite:ID}}` whose ID is not in `passages` and count it as HALLUCINATED_CITE;
 *   (2) if the output starts with the last 6+ words of `before`, remove that overlap;
 *   (3) cut after the second sentence terminator (`.`, `?`, `!` followed by space/end) — never
 *       mid-citation;
 *   (4) if the output is only whitespace, return empty and do not count against the cap
 *       (log as EMPTY_SUGGESTION).
 *
 * And §10.6 guardrail 1: the whitelist is the retrieved set, nothing else. The order matters:
 * stripping a hallucinated citation can leave a sentence ending that step (3) then counts, and an
 * output that was nothing but a bad citation must end up EMPTY, not charged.
 */

import { filterSentences, isAbbreviationStop, type QualityDrops } from './quality.js';

export const CITE_RE = /\{\{cite:([^}]+)\}\}/g;

export type PostProcessInput = {
  output: string;
  /** Ids of the passages that were actually in the prompt (§10.6). */
  passageIds: readonly string[];
  /** The text before the cursor, for the overlap check. */
  before: string;
  /**
   * §2.2: "Auto-cite from library can be toggled independently of autocomplete." When the student
   * has turned citations off, every marker is removed — including the legitimate ones — and none
   * of them counts as a hallucination. Grounding is unchanged: the passages still go to the model
   * and still constrain what it may claim. Only the visible markers go.
   */
  autoCite?: boolean;
  /**
   * The rest of the chapter as text, so a sentence it already contains is not offered again
   * (`quality.ts`). Empty or absent: only the answer itself and `before` are checked.
   */
  existingText?: string;
};

export type PostProcessResult = {
  text: string;
  /** Citation ids the model produced that were not in the prompt. Each is one HALLUCINATED_CITE. */
  hallucinated: string[];
  /** Citation ids kept, in order of first appearance. */
  cited: string[];
  /** Step (4): nothing usable came back. Not charged against the cap. */
  empty: boolean;
  /** Step (2) removed a repeated run of words. */
  overlapRemoved: boolean;
  /** Step (3) cut the output at the second sentence. */
  truncated: boolean;
  /** Sentences the quality filters removed (duplicates, roadmap filler, dangling connectives). */
  drops: QualityDrops;
  /** What the model said is missing when no passage supports the next sentence (A.1). */
  needsSource: string | null;
};

const PASSAGE_ID = 'S[A-Za-z0-9-]+#c[A-Za-z0-9-]+';
const BARE_IDS = new RegExp(
  `[([]?[ \\t]*${PASSAGE_ID}(?:[ \\t]*[;,][ \\t]*${PASSAGE_ID})*[ \\t]*[)\\]]?`,
  'g',
);

/**
 * Before step (1), 2026-09-30: the model sometimes cites a passage by writing its id the way the
 * passage list shows it — "(S3#c1; S1#c1)", "[S6#c1]" — instead of `{{cite:S3#c1}}`. Left alone,
 * the student would read the raw code in their thesis (the prompt evaluation, ADR-0038, found it
 * in a third of one model's answers). Each such id becomes a marker, so step (1) then judges it
 * like any other: kept if it was in the request, stripped and counted if it was not.
 */
export function normalizeBareCitations(output: string): string {
  return output
    .split(/(\{\{cite:[^}]+\}\})/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(BARE_IDS, (group) =>
            [...group.matchAll(new RegExp(PASSAGE_ID, 'g'))]
              .map((m) => `{{cite:${m[0]}}}`)
              .join(''),
          ),
    )
    .join('');
}

/** Step (1). */
export function stripUnknownCitations(
  rawOutput: string,
  passageIds: readonly string[],
): { text: string; hallucinated: string[]; cited: string[] } {
  const output = normalizeBareCitations(rawOutput);
  const allowed = new Set(passageIds);
  const hallucinated: string[] = [];
  const cited: string[] = [];

  const text = output.replace(CITE_RE, (whole, id: string) => {
    const key = id.trim();
    if (allowed.has(key)) {
      if (!cited.includes(key)) cited.push(key);
      return whole;
    }
    hallucinated.push(key);
    return '';
  });

  // A stripped citation usually leaves "sentence . " behind; tidy the space before punctuation.
  return {
    text: text.replace(/[ \t]+([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' '),
    hallucinated,
    cited,
  };
}

/** The source part of a passage id: `S3` in `S3#c2`. */
function sourceOf(passageId: string): string {
  return passageId.split('#')[0] ?? passageId;
}

const ADJACENT_MARKERS = /\{\{cite:[^}]+\}\}(?:[ \t]*[;,]?[ \t]*\{\{cite:[^}]+\}\})+/g;

/**
 * After step (1), 2026-10-04: three passages of one paper cited side by side printed as
 * "(Jimenez 2021) (Jimenez 2021) (Jimenez 2021)" — the same fault the Jenni study found in Jenni's
 * generated text. In a run of adjacent markers only the first for each source is kept; markers for
 * different sources in the same run all stay.
 */
export function collapseSameSourceRuns(output: string): string {
  return output.replace(ADJACENT_MARKERS, (run) => {
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const match of run.matchAll(CITE_RE)) {
      const id = (match[1] ?? '').trim();
      const source = sourceOf(id);
      if (seen.has(source)) continue;
      seen.add(source);
      kept.push(match[0]);
    }
    return kept.join('');
  });
}

const MIN_OVERLAP_WORDS = 6;

/**
 * Step (2). The model sometimes restarts the student's last clause; A.1 says to drop that when it
 * is six or more words long. Shorter matches are left alone: repeating "the" is not an overlap.
 */
export function removeLeadingOverlap(
  output: string,
  before: string,
): { text: string; removed: boolean } {
  const beforeWords = before.trim().split(/\s+/).filter(Boolean);
  const outputWords = output.trimStart().split(/\s+/).filter(Boolean);
  if (beforeWords.length < MIN_OVERLAP_WORDS || outputWords.length < MIN_OVERLAP_WORDS) {
    return { text: output, removed: false };
  }

  const fold = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

  // Longest suffix of `before` that is a prefix of `output`, at least MIN_OVERLAP_WORDS long.
  const maxLength = Math.min(beforeWords.length, outputWords.length);
  for (let length = maxLength; length >= MIN_OVERLAP_WORDS; length--) {
    const suffix = beforeWords.slice(-length).map(fold);
    const prefix = outputWords.slice(0, length).map(fold);
    if (suffix.every((word, i) => word === prefix[i])) {
      // Re-find the cut point in the original string so spacing inside the output is untouched.
      let remaining = output.trimStart();
      for (let i = 0; i < length; i++) remaining = remaining.replace(/^\S+\s*/, '');
      return { text: remaining, removed: true };
    }
  }
  return { text: output, removed: false };
}

/**
 * Step (3). A sentence terminator is `.`, `?` or `!` followed by whitespace or the end. A citation
 * placed after a sentence (`sentence. {{cite:X}}` or `sentence {{cite:X}}.`) belongs to that
 * sentence and is kept with it; the cut is never inside `{{ … }}`.
 */
export function cutAfterSecondSentence(output: string): { text: string; truncated: boolean } {
  let sentences = 0;
  let i = 0;
  while (i < output.length) {
    if (output.startsWith('{{', i)) {
      const end = output.indexOf('}}', i);
      i = end === -1 ? output.length : end + 2;
      continue;
    }
    const char = output[i] as string;
    if ((char === '.' || char === '?' || char === '!') && !isAbbreviationStop(output, i)) {
      // Consume a run of terminators and closing quotes/brackets.
      let end = i + 1;
      while (end < output.length && /[.!?"')\]]/.test(output[end] as string)) end++;
      const rest = output.slice(end);
      if (rest.length === 0 || /^\s/.test(rest)) {
        // A citation immediately after the terminator still belongs to this sentence.
        const trailing = /^\s*(\{\{cite:[^}]+\}\}\s*)+/.exec(rest);
        const sentenceEnd = trailing ? end + trailing[0].trimEnd().length : end;
        sentences++;
        if (sentences === 2) {
          const kept = output.slice(0, sentenceEnd);
          return { text: kept, truncated: kept.trim().length < output.trim().length };
        }
        i = sentenceEnd;
        continue;
      }
    }
    i++;
  }
  return { text: output, truncated: false };
}

/**
 * A.1 (2026-09-30): "If no passage supports what the text needs next… output only
 * [[NEEDS SOURCE: <what is missing>]]". Anywhere in the answer, one or more times: the first
 * names the gap, and every marker is removed from the text the student is offered.
 */
const NEEDS_SOURCE = /\[\[NEEDS SOURCE:\s*([^\]]*)\]\]/gi;

export function postProcessAssist(input: PostProcessInput): PostProcessResult {
  let needsSource: string | null = null;
  for (const match of input.output.matchAll(NEEDS_SOURCE)) {
    const note = (match[1] ?? '').trim();
    if (note && needsSource === null) needsSource = note.slice(0, 120);
  }
  const output = input.output.replace(NEEDS_SOURCE, ' ');

  // With auto-cite off the allowed set is empty, but a removed marker is the student's choice
  // rather than the model's fault, so `suppressed` keeps it out of the hallucination count.
  const suppressed = input.autoCite === false;
  const stripped = suppressed
    ? { ...stripUnknownCitations(output, []), hallucinated: [], cited: [] }
    : stripUnknownCitations(output, input.passageIds);
  const overlap = removeLeadingOverlap(collapseSameSourceRuns(stripped.text), input.before);
  const cut = cutAfterSecondSentence(overlap.text);
  const filtered = filterSentences({
    text: cut.text,
    before: input.before,
    existing: input.existingText ?? '',
  });

  // A.1: "Do not add a leading space or newline; the editor handles spacing." Trailing whitespace
  // is likewise noise, and the editor adds the joining space (`spaceBefore`, ghost-text.ts).
  // An answer that only repeated `before` loses its words to step (2) but keeps its markers, and
  // a row of citations with no sentence is not a suggestion (prompt evaluation, 2026-09-30).
  const hasWords = /[\p{L}\p{N}]/u.test(filtered.text.replace(CITE_RE, ''));
  const text = hasWords ? filtered.text.trim() : '';
  const empty = text.length === 0;

  return {
    text,
    hallucinated: stripped.hallucinated,
    cited: empty ? [] : stripped.cited.filter((id) => text.includes(`{{cite:${id}}}`)),
    empty,
    overlapRemoved: overlap.removed,
    truncated: cut.truncated,
    drops: filtered.drops,
    needsSource,
  };
}
