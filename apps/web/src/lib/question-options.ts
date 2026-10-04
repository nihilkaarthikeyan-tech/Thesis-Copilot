/**
 * The options in a proposal question, so the student can tap one instead of typing its number
 * (docs/JENNI-FIX-LIST.md item 14).
 *
 * The model writes them in prose — "Choose one: 1) restored stands 2) natural stands 3) both
 * 4) Something else" — in whichever marker style it picks: `1)`, `1.`, `(1)`, `(a)` or `a)`. Only
 * a run that starts at 1 (or a) and counts up without a gap is read as options, and only when it
 * has two to six of them; anything else is left as plain text, because a wrong button is worse
 * than none.
 */

export type QuestionOption = {
  /** The option's own words, sent as the student's answer so the conversation reads well. */
  text: string;
  /** "Something else": the answer is the student's to type, so this one opens the text box. */
  other: boolean;
};

type Marker = { start: number; end: number; kind: 'digit' | 'letter'; ordinal: number };

// A marker follows the start of the text, a space or a list punctuation mark, and is followed by
// a space: `1)`, `1.`, `(1)`, `(a)`, `a)`. Letters only in lower case and only with a bracket, so
// "e.g." and a sentence-initial "A." are never markers.
const MARKER = /(^|[\s:;,])(\(([1-9])\)|([1-9])[.)]|\(([a-f])\)|([a-f])\))(?=\s)/g;

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

function markersOf(text: string): Marker[] {
  const out: Marker[] = [];
  for (const match of text.matchAll(MARKER)) {
    const lead = match[1] ?? '';
    const marker = match[2] ?? '';
    const digit = match[3] ?? match[4];
    const letter = match[5] ?? match[6];
    const start = (match.index ?? 0) + lead.length;
    out.push({
      start,
      end: start + marker.length,
      kind: digit ? 'digit' : 'letter',
      ordinal: digit ? Number(digit) : (letter ?? 'a').charCodeAt(0) - 96,
    });
  }
  return out;
}

/** The longest run 1, 2, 3 … (or a, b, c …) among the markers; the first such run on a tie. */
function longestRun(markers: Marker[]): Marker[] {
  let best: Marker[] = [];
  let current: Marker[] = [];
  for (const marker of markers) {
    const last = current.at(-1);
    if (marker.ordinal === 1) {
      current = [marker];
    } else if (last && marker.kind === last.kind && marker.ordinal === last.ordinal + 1) {
      current.push(marker);
    } else {
      continue;
    }
    if (current.length > best.length) best = [...current];
  }
  return best;
}

const TRAILING_OTHER = /,?\s+or\s+something else\b[\s\S]*$/i;

function clean(raw: string): string {
  return raw
    .replace(/\*\*/g, '')
    .trim()
    .replace(/[\s,;:.?]+$/, '')
    .replace(/,?\s+(?:or|and)$/i, '')
    .replace(/[\s,;:.?]+$/, '')
    .trim();
}

/** The tappable options in a question, or none when it does not offer a clear list of 2–6. */
export function questionOptions(text: string): QuestionOption[] {
  const run = longestRun(markersOf(text));
  if (run.length < MIN_OPTIONS || run.length > MAX_OPTIONS) return [];
  const options: QuestionOption[] = [];
  for (const [i, marker] of run.entries()) {
    const next = run[i + 1];
    let raw = text.slice(marker.end, next ? next.start : undefined);
    // The last option ends at its line: anything after a line break is the question's coda.
    if (!next) raw = raw.split('\n')[0] ?? '';
    // "… (c) economic impact, or something else?": the open choice rides on the last option.
    const tail = next ? null : TRAILING_OTHER.exec(raw);
    const option = clean(tail ? raw.slice(0, tail.index) : raw);
    if (!option) return [];
    options.push({ text: option, other: /^(?:something else|other)\b/i.test(option) });
    if (tail) options.push({ text: 'Something else', other: true });
  }
  return options;
}
