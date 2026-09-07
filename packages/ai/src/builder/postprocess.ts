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
};

/** Step (1). */
export function stripUnknownCitations(
  output: string,
  passageIds: readonly string[],
): { text: string; hallucinated: string[]; cited: string[] } {
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
    if (char === '.' || char === '?' || char === '!') {
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

export function postProcessAssist(input: PostProcessInput): PostProcessResult {
  // With auto-cite off the allowed set is empty, but a removed marker is the student's choice
  // rather than the model's fault, so `suppressed` keeps it out of the hallucination count.
  const suppressed = input.autoCite === false;
  const stripped = suppressed
    ? { ...stripUnknownCitations(input.output, []), hallucinated: [], cited: [] }
    : stripUnknownCitations(input.output, input.passageIds);
  const overlap = removeLeadingOverlap(stripped.text, input.before);
  const cut = cutAfterSecondSentence(overlap.text);

  // A.1: "Do not add a leading space or newline; the editor handles spacing." Trailing whitespace
  // is likewise noise. Interior spacing is the model's and is kept.
  const text = cut.text.trim();
  const empty = text.length === 0;

  return {
    text,
    hallucinated: stripped.hallucinated,
    cited: empty ? [] : stripped.cited.filter((id) => text.includes(`{{cite:${id}}}`)),
    empty,
    overlapRemoved: overlap.removed,
    truncated: cut.truncated,
  };
}
