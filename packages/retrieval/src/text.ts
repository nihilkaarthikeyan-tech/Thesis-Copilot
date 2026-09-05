/**
 * Text normalisation and similarity — PRD Appendix C.3 (extraction scoring) and FR-2.1
 * (reference resolution picks a candidate by "normalised similarity ≥ 0.85 on title/authors/year").
 *
 * Kept dependency-free and pure so the scoring test and the resolver share exactly one definition
 * of "the same string" (§0.3 rule 6).
 */

/** ~4 characters per token, the same approximation PRD §11.1 uses for the cost model. */
export const CHARS_PER_TOKEN = 4;

export function approxTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * C.3 `title` rule: "Equal after Unicode NFKC normalisation, whitespace collapse, case-fold".
 * Also folds the typographic quotes and dashes PDF extractors emit, which would otherwise make
 * two visually identical titles compare unequal.
 */
export function normalise(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Strips leading reference numbering: `[12] `, `12. `, `(3) ` (C.3 references rule). */
export function stripReferenceNumbering(reference: string): string {
  return reference.replace(/^\s*(?:\[\d+\]|\(\d+\)|\d+[.)])\s*/, '');
}

/** Normalised reference string: numbering removed, then the C.3 normalisation. */
export function normaliseReference(reference: string): string {
  return normalise(stripReferenceNumbering(reference));
}

/** Words of a normalised string, punctuation dropped. */
export function tokenSet(text: string): Set<string> {
  return new Set(
    normalise(text)
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

/** C.3 `abstract` rule: token-set overlap (Jaccard). 1 for two empty strings. */
export function jaccard(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const word of left) if (right.has(word)) intersection++;
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Levenshtein distance, two-row dynamic programming so memory is O(min(a,b)) rather than O(a*b);
 * reference strings run to a few hundred characters and the scoring test compares every captured
 * string against every expected one.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Index the shorter string so the row arrays stay small.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let previous = Array.from({ length: short.length + 1 }, (_, i) => i);
  let current = new Array<number>(short.length + 1);

  for (let i = 1; i <= long.length; i++) {
    current[0] = i;
    const longChar = long.charCodeAt(i - 1);
    for (let j = 1; j <= short.length; j++) {
      const cost = short.charCodeAt(j - 1) === longChar ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[short.length] ?? 0;
}

/** 1 − (distance / longest length). 1 for two empty strings. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

/** Similarity of two reference strings after C.3 normalisation. */
export function referenceSimilarity(a: string, b: string): number {
  return similarity(normaliseReference(a), normaliseReference(b));
}

/**
 * Sentence boundaries with their offsets into `text`.
 *
 * Deliberately conservative: a terminator followed by whitespace and something that starts a new
 * sentence. Common abbreviations and initials do not end a sentence, because the chunker must
 * never split mid-sentence (FR-2.4) and a false boundary would do exactly that.
 */
const ABBREVIATIONS = new Set([
  'al',
  'e.g',
  'i.e',
  'etc',
  'cf',
  'vs',
  'fig',
  'eq',
  'no',
  'pp',
  'ed',
  'eds',
  'vol',
  'dr',
  'prof',
  'mr',
  'mrs',
  'ms',
  'st',
  'approx',
  'ca',
  'ref',
  'refs',
  'sec',
  'ch',
]);

export type Sentence = { text: string; start: number; end: number };

export function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char !== '.' && char !== '!' && char !== '?') continue;

    // Consume a run of terminators and closing quotes/brackets.
    let end = i + 1;
    while (end < text.length && /[.!?"')\]]/.test(text[end] ?? '')) end++;

    const after = text.slice(end);
    // The boundary must be followed by whitespace (or be the end of the text).
    if (after.length > 0 && !/^\s/.test(after)) continue;

    if (char === '.') {
      const before = text.slice(start, i);
      const lastWord = /(\S+)$/.exec(before)?.[1] ?? '';
      // "et al." / "e.g." / a bare initial like "J." do not end a sentence.
      if (ABBREVIATIONS.has(lastWord.toLowerCase().replace(/^[^\p{L}]+/u, ''))) continue;
      if (/^\p{Lu}$/u.test(lastWord)) continue;
      // A decimal point inside a number: "3.5".
      if (/\d$/.test(before) && /^\s*\d/.test(after)) continue;
    }

    // The next non-space character should start something new, not continue mid-sentence.
    const next = after.replace(/^\s+/, '');
    if (next.length > 0 && !/^[\p{Lu}\p{N}“"'([\-•]/u.test(next)) continue;

    const slice = text.slice(start, end);
    if (slice.trim().length > 0) sentences.push({ text: slice, start, end });
    start = end;
    i = end - 1;
  }

  if (start < text.length && text.slice(start).trim().length > 0) {
    sentences.push({ text: text.slice(start), start, end: text.length });
  }
  return sentences;
}
