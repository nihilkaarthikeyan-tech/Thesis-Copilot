/**
 * Academic punctuation and stock phrasing (ADR-0147, 2026-10-10).
 *
 * The owner read generated thesis text and found it full of em dashes ("—"), which a thesis
 * examiner reads as unprofessional: academic English punctuates with commas, colons, semicolons
 * and parentheses, and uses the en dash only for ranges (2015–2020, pp. 3–9). This is a style
 * rule for a thesis, the same kind of rule as a university's style guide; it is not aimed at any
 * detector (§12.3), and nothing here rewords anything.
 *
 * `academicPunctuation` is the code backstop on every path that puts generated text in front of
 * the student. It changes punctuation only:
 *
 *   - a pair of dashes enclosing an aside → commas, or parentheses when the aside has its own
 *     comma or is a whole clause;
 *   - one dash before a list, or before a short closing phrase → a colon;
 *   - one dash between two whole clauses → a semicolon;
 *   - one dash before "and", "but", "which", "such as", a participle, or a descriptive phrase →
 *     a comma;
 *   - an em dash between two numbers → the en dash of a range.
 *
 * Left exactly as written: ranges with an en dash or hyphen, hyphenated compounds, minus signs,
 * citation and needs-source markers, anything inside quotation marks (a quotation keeps its
 * source's punctuation), code, LaTeX, Markdown tables, rules and list bullets.
 *
 * The function checks its own work: the letters and digits, and the citation markers in order,
 * must be the same before and after, and every citation must stay in its sentence (`splitSentences`,
 * as the quality filters split; the tests also hold every case to `citationMoved`).
 * Anything else and it returns the text unchanged.
 */

import { isAbbreviationStop, splitSentences } from './quality.js';

// ---------------------------------------------------------------------------------------------
// Counting (used by the evaluation and by the rewrite paths' "did the student write dashes" test)
// ---------------------------------------------------------------------------------------------

/**
 * Dashes used as punctuation: every em dash or horizontal bar, a double hyphen between words, and
 * an en dash or hyphen with a space on both sides, unless it stands between two numbers (a range
 * or a subtraction). A bullet at the start of a line is not counted.
 */
export function countDashes(text: string): number {
  let n = 0;
  for (const line of text.split('\n')) {
    const body = line.replace(/^[ \t]*[-–—*+](?=[ \t])/, '');
    for (const m of body.matchAll(DASH_RE)) {
      if (!isNumberRange(body, m.index ?? 0, (m.index ?? 0) + m[0].length)) n++;
    }
  }
  return n;
}

/**
 * Stock phrases a careful thesis writer avoids: vague emphasis and filler that says nothing a
 * plainer word would not ("plays a crucial role", "it is important to note", "delve into").
 * Measured in the evaluation (`eval/style-measure.ts`) and named in the A.1 and A.2 prompts'
 * style rule; never removed in code, because removing a phrase would change the wording.
 */
export const STOCK_PHRASES: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'delve', re: /\bdelv(?:e|es|ed|ing)\b/gi },
  { label: 'crucial', re: /\bcrucial(?:ly)?\b/gi },
  { label: 'pivotal', re: /\bpivotal\b/gi },
  { label: 'a testament to', re: /\b(?:a|is|as) testament to\b/gi },
  { label: "in today's", re: /\bin today['’]s\b/gi },
  {
    label: 'it is important to note',
    re: /\bit is (?:important|worth|crucial|essential|imperative) (?:to note|noting|to mention|mentioning|to highlight|to emphasi[sz]e)\b/gi,
  },
  { label: 'it should be noted', re: /\bit should be noted\b/gi },
  {
    label: 'plays a vital role',
    re: /\bpla(?:y|ys|yed|ying) (?:a|an) (?:vital|crucial|pivotal|key|critical|central|significant|important|instrumental|essential|major) role\b/gi,
  },
  { label: 'navigate the complexities', re: /\bnavigat(?:e|es|ed|ing) the complexit(?:y|ies)\b/gi },
  { label: 'underscores', re: /\bunderscor(?:e|es|ed|ing)\b/gi },
  { label: 'in the realm of', re: /\b(?:in|within) the realm of\b/gi },
  {
    label: 'landscape',
    re: /\b(?:evolving|ever-evolving|changing|ever-changing|dynamic) landscape\b/gi,
  },
  { label: 'tapestry', re: /\btapestry\b/gi },
  { label: 'multifaceted', re: /\bmultifaceted\b/gi },
  { label: 'intricate', re: /\bintricac(?:y|ies)\b|\bintricate\b/gi },
  { label: 'shed light on', re: /\bsh(?:ed|eds|edding) (?:new |some )?light on\b/gi },
  { label: 'pave the way', re: /\bpav(?:e|es|ed|ing) the way\b/gi },
  { label: 'myriad', re: /\bmyriad\b/gi },
  { label: 'plethora', re: /\bplethora\b/gi },
  { label: 'holistic', re: /\bholistic(?:ally)?\b/gi },
  { label: 'seamless', re: /\bseamless(?:ly)?\b/gi },
  { label: 'leverage', re: /\bleverag(?:e|es|ed|ing)\b/gi },
  { label: 'foster', re: /\bfoster(?:s|ed|ing)?\b/gi },
  { label: 'harness', re: /\bharness(?:es|ed|ing)? the (?:power|potential)\b/gi },
  {
    label: 'unlock the potential',
    re: /\bunlock(?:s|ed|ing)? (?:the|its|their) (?:full )?potential\b/gi,
  },
  { label: 'cornerstone', re: /\bcornerstone\b/gi },
  { label: 'showcase', re: /\bshowcas(?:e|es|ed|ing)\b/gi },
  { label: 'embark', re: /\bembark(?:s|ed|ing)?\b/gi },
  { label: 'transformative', re: /\btransformative\b/gi },
  { label: 'groundbreaking', re: /\bground-?breaking\b/gi },
  { label: 'cutting-edge', re: /\bcutting-edge\b/gi },
  { label: 'paramount', re: /\bparamount\b/gi },
  { label: 'nuanced', re: /\bnuanced\b/gi },
  // Openers that pad rather than connect: counted only at the start of a sentence.
  {
    label: 'Furthermore/Moreover/Additionally opener',
    re: /(?:^|[.!?।]["'”’)]*\s+|\}\}\s+)(?:Furthermore|Moreover|Additionally),/gm,
  },
];

/** Each stock phrase found, by label, in order of the list (a label once per occurrence). */
export function stockPhrases(text: string): string[] {
  const found: string[] = [];
  for (const { label, re } of STOCK_PHRASES) {
    for (const _ of text.matchAll(re)) found.push(label);
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// Padded connective openers (ADR-0147 round 2, A.1 Assist only)
// ---------------------------------------------------------------------------------------------

/**
 * A connective that opens a sentence only to pad it. Round 1 of ADR-0147 found the mini opened its
 * second sentence with "Additionally," in 7 of 15 outputs even when the prompt named the word; a
 * rule in code holds where the prompt did not. "Bare" means the word and its comma and nothing
 * else: "In addition to X," and "Notably higher yields…" are not openers and are kept.
 */
const OPENERS = 'Additionally|Furthermore|Moreover|In addition|Notably|Importantly';
/** A sentence end: a terminator, closing quotes or brackets, and any citations that follow it. */
const SENTENCE_END = String.raw`[.!?]["'”’)\]]*(?:\s*\{\{cite:[^}]+\}\})*`;
const INNER_OPENER = new RegExp(String.raw`(${SENTENCE_END}\s+)(?:${OPENERS}),\s+(?=[^\s{])`, 'g');
const LEADING_OPENER = new RegExp(String.raw`^(\s*)(?:${OPENERS}),\s+(?=[^\s{])`);

/** Whether the student's text before the cursor ends a sentence (or a heading, or nothing). */
export function endsSentence(before: string): boolean {
  if (before.trim() === '' || /\n[ \t]*$/.test(before)) return true;
  const trimmed = before.trimEnd();
  const m = new RegExp(`${SENTENCE_END}$`).exec(trimmed);
  if (!m) return false;
  return !isAbbreviationStop(trimmed, m.index);
}

/** Capitalise a lower-case first word, unless it is mixed case ("pH", "mRNA", "eVTOL"). */
function capitaliseFirstWord(text: string): string {
  const word = /^[a-z][\p{L}\p{N}'’-]*/u.exec(text)?.[0];
  if (!word || /\p{Lu}/u.test(word.slice(1))) return text;
  return word.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * A.1 Assist: a bare "Additionally,", "Furthermore,", "Moreover,", "In addition,", "Notably," or
 * "Importantly," that opens a sentence is dropped and the next word capitalised. The suggestion's
 * first sentence counts only when `before` ends a sentence: in a mid-sentence continuation the
 * word joins the student's clause and is kept. An opener followed by a citation marker is left as
 * written, and nothing else in the text changes (Hindi and every other script pass through).
 */
export function dropConnectiveOpeners(text: string, before: string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(INNER_OPENER)) {
    const at = m.index ?? 0;
    const end = m[1] as string;
    // "et al. Moreover," is not a sentence start; leave it.
    if (isAbbreviationStop(text, at + end.search(/[.!?]/))) continue;
    out += text.slice(last, at) + end;
    last = at + m[0].length;
    // The next word takes the capital; it is copied from `last` on.
    const rest = text.slice(last);
    const capped = capitaliseFirstWord(rest);
    if (capped !== rest) {
      out += capped.charAt(0);
      last += 1;
    }
  }
  out += text.slice(last);
  if (endsSentence(before)) {
    const m = LEADING_OPENER.exec(out);
    if (m) out = m[1] + capitaliseFirstWord(out.slice(m[0].length));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The backstop
// ---------------------------------------------------------------------------------------------

/**
 * A dash used as punctuation: an em dash or horizontal bar (any spacing), a double hyphen, or an
 * en dash or hyphen with whitespace on both sides. An unspaced en dash or hyphen is a range or a
 * compound and never matches.
 */
const DASH_RE = /[ \t]*(?:—|―|--)[ \t]*|[ \t]+[–-][ \t]+/g;

/** Text characters that stand for a protected stretch: open, one index character, close. */
const PH_OPEN = '\uE000';
const PH_CLOSE = '\uE001';
const PH_BASE = 0xe100;
const PH_MAX = 0xf8ff - PH_BASE;
const PH_RE = /\uE000([\uE100-\uF8FF])\uE001/g;
/** The same, without the global flag's `lastIndex`, for a yes/no test. */
const PH_ANY = /\uE000[\uE100-\uF8FF]\uE001/;

/** `drop`: left out of the word analysis (citations, markers, bullets); `other`: one word. */
type Kind = 'drop' | 'other';

/** Stretches no punctuation rule may touch, in the order they are taken out. */
const PROTECT: ReadonlyArray<{ re: RegExp; kind: Kind }> = [
  { re: /```[\s\S]*?```/g, kind: 'other' },
  { re: /\$\$[\s\S]*?\$\$/g, kind: 'other' },
  { re: /\\\[[\s\S]*?\\\]/g, kind: 'other' },
  { re: /\\\([\s\S]*?\\\)/g, kind: 'other' },
  // A Markdown table row, a horizontal rule, a list bullet.
  { re: /^[ \t]*\|.*$/gm, kind: 'other' },
  { re: /^[ \t]*(?:[-*_][ \t]*){3,}$/gm, kind: 'other' },
  { re: /^[ \t]*(?:[-–—*+]|\d+[.)])(?=[ \t])/gm, kind: 'drop' },
  { re: /`[^`\n]*`/g, kind: 'other' },
  { re: /\$[^$\n]+\$/g, kind: 'other' },
  { re: /\{\{[^}]*\}\}/g, kind: 'drop' },
  { re: /\[\[[^\]]*\]\]/g, kind: 'drop' },
  { re: /https?:\/\/[^\s)]+/g, kind: 'other' },
  // A quotation keeps its source's punctuation.
  { re: /“[^”\n]*”/g, kind: 'other' },
  { re: /«[^»\n]*»/g, kind: 'other' },
  { re: /"[^"\n]*"/g, kind: 'other' },
];

/** Whether the dash spanning [start, end) of `s` sits between two numbers. */
function isNumberRange(s: string, start: number, end: number): boolean {
  return /\d$/.test(s.slice(0, start)) && /^\d/.test(s.slice(end));
}

/** Words that open a continuation of the same clause: the dash before them becomes a comma. */
const COMMA_STARTERS = new Set(
  (
    'and but yet or nor so while whereas although though which who whom whose where when ' +
    'including such especially particularly notably mainly largely mostly often usually not ' +
    'rather as because since if unless even for e.g i.e eg ie that namely with without from ' +
    'despite like unlike than both either neither only just perhaps possibly probably ' +
    'thereby thus hence therefore however instead also alongside along beyond compared ' +
    'according depending given resulting ' +
    // A prepositional phrase continues the clause: "limits uptake — among rural households".
    'in among at on by under across within over through during after before between ' +
    'towards toward via per except against into onto upon amid'
  ).split(' '),
);

/** A linking phrase followed by its comma, at the start of what follows a dash. */
const TRANSITION_RE =
  /^(?:for example|for instance|that is|in particular|in contrast|by contrast|in turn|as a result|in other words|e\.g\.|i\.e\.|however|therefore|thus|hence|instead|indeed|moreover|furthermore|consequently|similarly|conversely|nevertheless|nonetheless|meanwhile|likewise|in short|in practice|in effect),/i;

/** Words after a closing parenthesis that need the comma the dash pair stood for. */
const COMMA_AFTER_ASIDE = new Set(
  'which who whom whose whereas while although though but yet so'.split(' '),
);

/** Words that start the subject of a clause. */
const SUBJECT_STARTERS = new Set(
  (
    'the this these those that it its they their we our he she his her i you each every ' +
    'most many some all both none one another other such a an few several no neither ' +
    'there here'
  ).split(' '),
);

/**
 * Finite verbs common in thesis prose that cannot be a participle: auxiliaries, present tenses and
 * irregular pasts. A regular "-ed" form is ambiguous ("a pattern reported across India" is a
 * phrase) and is read as a verb only straight after a definite subject (`isClause`).
 */
const FINITE = new Set(
  (
    'is are was were has have had do does did can cannot could may might will would shall ' +
    'should must remains remain shows show suggests suggest indicates indicate found finds find ' +
    'reports report means mean meant makes make made leaves leave left becomes become became ' +
    'appears appear seems seem lies lie lay depends depend rises rise rose falls fall fell grows ' +
    'grow grew increases increase decreases decrease reduces reduce affects affect limits limit ' +
    'explains explain helps help requires require provides provide offers offer differs differ ' +
    'varies vary matters matter exists exist works work takes take took gives give gave needs ' +
    'need lacks lack uses use argues argue notes note observes observe concludes conclude ' +
    'adopt adopts face faces ran runs run began begins begin saw sees see led leads lead held ' +
    'holds hold kept keeps keep met meets meet drew draws draw brought brings bring'
  ).split(' '),
);

/** Subjects after which a regular "-ed" form is a verb ("the panels improved"). */
const DEFINITE_SUBJECTS = new Set(
  'the this these those it they we he she its their our such each both most many some all'.split(
    ' ',
  ),
);

/** Words before a verb that make it part of a relative or subordinate clause, not the main one. */
const SUBORDINATORS = new Set(
  'that which who whom whose where when if because as while although though whereas'.split(' '),
);

/** Lower-case words of a stretch, citation markers left out and other protected stretches as one word. */
function wordsOf(segment: string, kinds: readonly Kind[]): string[] {
  return segment
    .replace(PH_RE, (_m, c: string) => (kinds[c.charCodeAt(0) - PH_BASE] === 'drop' ? ' ' : ' x '))
    .toLowerCase()
    .split(/[^\p{L}\p{N}.'’]+/u)
    .map((w) => w.replace(/^[.'’]+|[.'’]+$/g, ''))
    .filter(Boolean);
}

/** Any finite verb, generously: used for the stretch before a dash, where a clause is the norm. */
function hasFinite(words: readonly string[]): boolean {
  return words.some((w, i) => {
    if (FINITE.has(w)) return true;
    // A past tense after the subject ("the panels improved"), not an adjective after a determiner.
    return i > 0 && /^[a-z]{3,}ed$/.test(w) && !SUBJECT_STARTERS.has(words[i - 1] as string);
  });
}

/**
 * A whole clause: a main verb within the first few words, not inside a relative clause, and not
 * opened by a word that continues the previous clause ("and", "such", a participle).
 */
function isClause(words: readonly string[]): boolean {
  if (words.length < 2) return false;
  const first = words[0] as string;
  if (COMMA_STARTERS.has(first) && !DEFINITE_SUBJECTS.has(first)) return false;
  if (/^[a-z]+ing$/.test(first)) return false;
  for (let i = 1; i < Math.min(words.length, 12); i++) {
    const w = words[i] as string;
    if (SUBORDINATORS.has(w)) return false;
    if (FINITE.has(w)) return true;
    // "the panels improved": a regular past right after a short definite subject.
    if (
      i <= 3 &&
      DEFINITE_SUBJECTS.has(first) &&
      /^[a-z]{3,}ed$/.test(w) &&
      !SUBJECT_STARTERS.has(words[i - 1] as string)
    ) {
      return true;
    }
  }
  return false;
}

/** Only Latin-script words can be read by the English rules; anything else gets the safe comma. */
function isLatin(words: readonly string[]): boolean {
  return words.length > 0 && words.every((w) => /^[\p{Script=Latin}\p{N}.'’-]+$/u.test(w));
}

/** The punctuation a single dash becomes, given what stands on each side of it. */
function singleDash(left: string, right: string, kinds: readonly Kind[]): ',' | ':' | ';' {
  const l = wordsOf(left, kinds);
  const r = wordsOf(right, kinds);
  if (!isLatin(r) || !isLatin(l)) return ',';
  // "Yes — at least one study…": an answer word takes a comma.
  if (l.length === 1 && /^(yes|no|indeed|briefly|overall|together)$/.test(l[0] as string)) {
    return ',';
  }
  const chosen = latinDash(right, l, r, kinds);
  // Never a second colon in one sentence: the dash then joins as a clause or an aside.
  if (chosen === ':' && /:/.test(`${left}${right}`.replace(PH_RE, ''))) {
    return isClause(r) && hasFinite(l) ? ';' : ',';
  }
  return chosen;
}

/** `singleDash` for English text: `l` and `r` are the words on each side. */
function latinDash(
  right: string,
  l: readonly string[],
  r: readonly string[],
  kinds: readonly Kind[],
): ',' | ':' | ';' {
  // "— for example, intercritical tempering is reported…": a linking phrase and its comma, then a
  // whole clause. Two clauses joined by a linking adverb take a semicolon.
  const linked = TRANSITION_RE.exec(right.replace(PH_RE, ' ').trimStart());
  if (linked) {
    const after = wordsOf(right.replace(PH_RE, ' ').trimStart().slice(linked[0].length), kinds);
    if (isClause(after) && hasFinite(l)) return ';';
    return ',';
  }
  const first = r[0] as string;
  if (COMMA_STARTERS.has(first) || /^[a-z]+ing$/.test(first)) return ',';
  if (isClause(r)) return hasFinite(l) ? ';' : ':';
  const isList = /,/.test(right) || (r.length <= 12 && /\b(and|or)\b/.test(r.join(' ')));
  if (isList) return ':';
  if (r.length <= 3) return ':';
  return ',';
}

/** One sentence, its dashes replaced. `kinds` describes the placeholders in it. */
function fixSentence(sentence: string, kinds: readonly Kind[]): string {
  // Ranges first: an em dash between two numbers is the en dash of a range.
  const s = sentence.replace(/(\d)[ \t]*[—―][ \t]*(?=\d)/g, '$1–');
  const dashes = [...s.matchAll(DASH_RE)]
    .map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }))
    .filter((d) => !isNumberRange(s, d.start, d.end));
  if (dashes.length === 0) return s;

  // Pieces between the dashes; the terminator and anything after the last word stays with the end.
  const parts: string[] = [];
  let at = 0;
  for (const d of dashes) {
    parts.push(s.slice(at, d.start));
    at = d.end;
  }
  parts.push(s.slice(at));

  const isEmpty = (p: string) =>
    wordsOf(p, kinds).length === 0 && !/[\p{L}\p{N}]/u.test(p.replace(PH_RE, ''));
  let out = parts[0] as string;
  let i = 1;
  while (i < parts.length) {
    const rest = parts.slice(i).join(' — ');
    const piece = parts[i] as string;
    const remaining = parts.length - i;
    // A dash with nothing before it or nothing after it is simply removed.
    if (isEmpty(out) || isEmpty(rest)) {
      out = joinWith(out, '', piece);
      i++;
      continue;
    }
    if (remaining >= 2 && !isEmpty(parts[i + 1] as string)) {
      // A pair enclosing an aside.
      const aside = piece.trim();
      const after = parts[i + 1] as string;
      const asideWords = wordsOf(aside, kinds);
      // Commas would blur into the sentence's own commas when the aside is a list or a clause, and
      // a long descriptive aside reads more clearly in parentheses. A short one, or one opened by
      // "which", "especially", "as" or a participle, takes commas.
      const opener = asideWords[0] ?? '';
      const commaAside =
        !isLatin(asideWords) ||
        asideWords.length <= 4 ||
        COMMA_STARTERS.has(opener) ||
        /^[a-z]+(ing|ed)$/.test(opener);
      const parenthesise =
        /[,;:]/.test(aside.replace(PH_RE, '')) ||
        asideWords.includes('and') ||
        asideWords.includes('or') ||
        isClause(asideWords) ||
        !commaAside;
      if (parenthesise) {
        const next = wordsOf(after, kinds)[0] ?? '';
        const gap = /^[ \t]*[\p{L}\p{N}\uE000(]/u.test(after)
          ? COMMA_AFTER_ASIDE.has(next) || /^[a-z]+ing$/.test(next)
            ? ', '
            : ' '
          : '';
        out = `${out.trimEnd()} (${aside})${gap}${after.trimStart()}`;
      } else {
        const closed = /^[ \t]*[,.;:!?)\]।]/u.test(after);
        out = `${joinWith(out, ',', aside)}${closed ? '' : ', '}${after.trimStart()}`;
      }
      i += 2;
      continue;
    }
    out = joinWith(out, singleDash(out, rest, kinds), piece);
    i++;
  }
  return out;
}

/** `left` + punctuation + `right`, with one space after and none before. */
function joinWith(left: string, punct: string, right: string): string {
  const l = left.trimEnd();
  const r = right.trimStart();
  // Punctuation already on either side: the dash adds nothing.
  if (/[,;:(]$/.test(l) || /^[,;:.!?)\]।]/.test(r))
    return `${l}${/^[,;:.!?)\]।]/.test(r) ? '' : ' '}${r}`;
  if (r.length === 0) return `${l}${punct}`;
  return `${l}${punct} ${r}`;
}

/** Sentences of one line, each with the whitespace that follows it. */
function sentencesOf(line: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (!/[.!?।]/.test(c) || isAbbreviationStop(line, i)) continue;
    let end = i + 1;
    while (end < line.length && /[.!?"')\]”’]/.test(line[end] as string)) end++;
    if (end < line.length && !/\s/.test(line[end] as string)) continue;
    while (end < line.length && /\s/.test(line[end] as string)) end++;
    out.push(line.slice(start, end));
    start = end;
    i = end - 1;
  }
  if (start < line.length) out.push(line.slice(start));
  return out;
}

/** What may differ between the input and the output: punctuation and spacing, nothing else. */
const letters = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, '');
const markers = (text: string) =>
  [...text.matchAll(/\{\{[^}]*\}\}|\[\[[^\]]*\]\]/g)].map((m) => m[0]);

/**
 * Rewrites dashes used as punctuation into a thesis's punctuation. Wording never changes; see the
 * file header for the rules and what is left alone.
 */
export function academicPunctuation(text: string): string {
  if (!/[—―]|--|[ \t][–-][ \t]/.test(text)) return text;

  // Take out every protected stretch, innermost last, and remember what it was.
  const saved: string[] = [];
  const kinds: Kind[] = [];
  let work = text;
  for (const { re, kind } of PROTECT) {
    work = work.replace(re, (m) => {
      if (saved.length >= PH_MAX) return m;
      saved.push(m);
      kinds.push(kind);
      return `${PH_OPEN}${String.fromCharCode(PH_BASE + saved.length - 1)}${PH_CLOSE}`;
    });
  }

  const fixed = work
    .split('\n')
    .map((line) =>
      sentencesOf(line)
        .map((s) => {
          const trailing = /\s*$/.exec(s)?.[0] ?? '';
          return fixSentence(s.slice(0, s.length - trailing.length), kinds) + trailing;
        })
        .join(''),
    )
    .join('\n');

  // Put the protected stretches back (a quotation may hold a citation: repeat until none is left).
  let restored = fixed;
  for (let pass = 0; pass < 4 && PH_ANY.test(restored); pass++) {
    restored = restored.replace(PH_RE, (_m, c: string) => saved[c.charCodeAt(0) - PH_BASE] ?? '');
  }

  // The self-check: same words and numbers, same markers in the same order, no citation moved.
  if (PH_ANY.test(restored)) return text;
  if (letters(restored) !== letters(text)) return text;
  const before = markers(text);
  const after = markers(restored);
  if (before.join('\u0000') !== after.join('\u0000')) return text;
  // Every citation stays in the sentence it was in (the same splitter the quality filters use).
  if (citationSentences(restored).join(',') !== citationSentences(text).join(',')) return text;
  return restored;
}

/** For each citation marker in order, the index of the sentence that carries it. */
function citationSentences(text: string): number[] {
  const out: number[] = [];
  splitSentences(text).forEach((sentence, i) => {
    for (const _ of sentence.matchAll(/\{\{cite:[^}]+\}\}/g)) out.push(i);
  });
  return out;
}

/**
 * For a rewrite of the student's own text (an edit command, a tone rewrite, a guide's revision):
 * if the student wrote dashes in the original, they are the student's style and the rewrite is
 * left alone; otherwise the model's dashes are corrected.
 */
export function academicPunctuationUnlessStudents(rewrite: string, original: string): string {
  return countDashes(original) > 0 ? rewrite : academicPunctuation(rewrite);
}
