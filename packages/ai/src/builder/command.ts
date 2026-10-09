/**
 * Section commands — PRD FR-4.8, Appendix A.11, PHASES v2 W9.2.
 *
 *   "expand, formalise, simplify, shorten, 'check topic consistency with this section'. Strong
 *    tier. Result shown as a diff; apply or discard."
 *
 * The prompt is cached (A.0 + A.0.1) like Assist, so a command on the same document reuses the
 * memory block. What this file adds: the command list, the whitelist check on the rewrite (a
 * command may not introduce a citation id that was not in `<passages>` or the selection), the
 * "every retained claim keeps its citation" check, and a word-level diff the UI renders.
 */

import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import { renderTemplate } from '../template.js';
import type { LlmRequest } from '../types.js';
import { academicPunctuationUnlessStudents } from './academic-style.js';
import type { PromptPassage } from './assist.js';
import { CITE_RE, collapseSameSourceRuns, normalizeBareCitations } from './postprocess.js';

/**
 * ADR-0066: edit actions with their own prompt (`edit.md`), run through exactly the same path,
 * checks and allowance as the five section commands of A.11.
 */
export const EDIT_ACTIONS = [
  'hedge',
  'direct',
  'active',
  'past',
  'present',
  'counter',
  // Row 49 of the Jenni coverage map (2026-10-05, ADR-0081): the two ADR-0066 left out.
  'translate',
  'table',
  // Jenni build plan R8 (ADR-0095): the presets Jenni's AI Edit has and ours lacked. No general
  // "paraphrase": rewording any selection on request is the §12.3 ban (ParaphrasePanel.tsx).
  'flow',
  'transitions',
  'redundancy',
  'strengthen',
  'precise',
  'future',
  'bullets',
  'numbered',
  'prose',
  // The student's own instruction, in their words (the box at the top of the panel).
  'custom',
] as const;
export type EditAction = (typeof EDIT_ACTIONS)[number];

export const COMMANDS = [
  'expand',
  'formalise',
  'simplify',
  'shorten',
  'consistency',
  ...EDIT_ACTIONS,
] as const;
export type CommandName = (typeof COMMANDS)[number];

export const isEditAction = (command: CommandName): command is EditAction =>
  (EDIT_ACTIONS as readonly string[]).includes(command);

export const COMMAND = {
  tier: 'strong',
  maxTokens: 900,
  temperature: 0.3,
  /**
   * A.11 gives passages only to the commands that can use them. `custom` gets them only when the
   * student leaves "Use my library" on (ADR-0095).
   */
  needsPassages: ['expand', 'consistency', 'counter'] as readonly CommandName[],
  /** The longest instruction the box takes. */
  maxInstructionChars: 500,
  /** §10.4 top_k when passages are sent. */
  topK: 6,
  /** A.11: "reduce to about 60% of the length" / "may grow to 2x". */
  shortenRatio: 0.6,
  expandMaxRatio: 2,
  /** The longest selection worth one call; the UI refuses more. */
  maxSelectionChars: 6_000,
} as const;

export const COMMAND_LABELS: Readonly<Record<CommandName, { label: string; hint: string }>> = {
  expand: { label: 'Expand', hint: 'Add depth and reasoning; no new claims without a source.' },
  formalise: { label: 'Formalise', hint: 'Raise the register; keep the meaning and the length.' },
  simplify: { label: 'Simplify', hint: 'Shorter sentences, plainer words; every citation kept.' },
  shorten: {
    label: 'Shorten',
    hint: 'About 60% of the length, with nothing that changes meaning dropped.',
  },
  consistency: {
    label: 'Check consistency',
    hint: 'Fix only terminology or claims that conflict with the section and glossary.',
  },
  hedge: { label: 'Hedge', hint: 'More cautious claims where the evidence is limited.' },
  direct: { label: 'More direct', hint: 'Fewer needless qualifiers, on cited claims only.' },
  active: { label: 'Active voice', hint: 'Active voice where the doer is named or obvious.' },
  past: { label: 'Past tense', hint: 'For reporting what a study or this research did.' },
  present: { label: 'Present tense', hint: 'For what is known and what the text argues.' },
  counter: {
    label: 'Counter-argument',
    hint: 'Adds a counter-argument from your library, cited; keeps your text.',
  },
  translate: {
    label: 'Translate',
    hint: 'Into the language of this thesis, with every citation and figure kept.',
  },
  table: {
    label: 'As a table',
    hint: 'The facts the text compares, as a table with a header row; nothing added.',
  },
  flow: {
    label: 'Fix the flow',
    hint: 'Each sentence follows from the one before; every point kept.',
  },
  transitions: {
    label: 'Add transitions',
    hint: 'Linking words where the relation between points is clear; nothing else changes.',
  },
  redundancy: {
    label: 'Remove repetition',
    hint: 'Drops what says the same thing twice; every point, figure and citation kept.',
  },
  strengthen: {
    label: 'Strengthen the argument',
    hint: 'Claim, evidence and what follows, made explicit; no new facts, no more certainty.',
  },
  precise: {
    label: 'Technical precision',
    hint: "The field's exact terms and the figures the text gives, in place of vague words.",
  },
  future: { label: 'Future tense', hint: 'For what this research will do, as in a proposal.' },
  bullets: { label: 'Bulleted list', hint: 'One point per item, each a sentence, citations kept.' },
  numbered: { label: 'Numbered list', hint: 'One point per item, in order, citations kept.' },
  prose: { label: 'As prose', hint: 'A list or notes turned into connected paragraphs.' },
  custom: { label: 'Your instruction', hint: 'Edits the selection as you ask, and nothing more.' },
};

export type CommandBuildInput = {
  command: CommandName;
  memoryBlock: string;
  selection: string;
  contextBefore: string;
  contextAfter: string;
  passages: readonly PromptPassage[];
  userId: string;
  documentId: string;
  signal?: AbortSignal;
  /**
   * ADR-0081: the thesis's language (§2.2), the only target `translate` has. A selection drafted
   * in another language is put into the one the thesis is written in; nothing else.
   */
  language?: string;
  /** ADR-0095: the student's own instruction, for `custom` only. */
  instruction?: string;
  /** ADR-0095: for a follow-up, the student's text before the first edit (`<original>`). */
  original?: string;
};

/** Whether the passages go to the model: A.11's commands, and `custom` when it was given some. */
export function sendsPassages(command: CommandName, passages: readonly unknown[]): boolean {
  return COMMAND.needsPassages.includes(command) || (command === 'custom' && passages.length > 0);
}

/** The thesis language's name for the prompt: a BCP-47 tag in, a word out. */
export function languageName(tag: string | undefined): string {
  const names: Record<string, string> = {
    en: 'English',
    hi: 'Hindi',
    ta: 'Tamil',
    te: 'Telugu',
    kn: 'Kannada',
    ml: 'Malayalam',
    mr: 'Marathi',
    bn: 'Bengali',
    gu: 'Gujarati',
    pa: 'Punjabi',
    ur: 'Urdu',
    fr: 'French',
    de: 'German',
    es: 'Spanish',
    pt: 'Portuguese',
    ar: 'Arabic',
    zh: 'Chinese',
    ja: 'Japanese',
  };
  const base = (tag ?? 'en').toLowerCase().split(/[-_]/)[0] ?? 'en';
  return names[base] ?? tag ?? 'English';
}

export function commandUserMessage(input: CommandBuildInput): string {
  const template = loadPrompt('command').user;
  const passages = sendsPassages(input.command, input.passages) ? input.passages : [];
  const rendered = passages
    .map(
      (p) =>
        `<passage id="${p.id}" source="${p.shortRef}"${p.page ? ` page="${p.page}"` : ''}>\n${p.text}\n</passage>`,
    )
    .join('\n');
  // ADR-0081: translate names its one target, the thesis language.
  const target =
    input.command === 'translate'
      ? `\n\n<target_language>${languageName(input.language)}</target_language>`
      : input.command === 'custom'
        ? `\n\n<instruction>\n${(input.instruction ?? '').trim().slice(0, COMMAND.maxInstructionChars)}\n</instruction>${
            // A follow-up: the student's own text before any edit, which the instruction may
            // refer to ("as in my original"). Without it the model could not put a citation back.
            input.original?.trim()
              ? `\n\n<original>\n${input.original.trim().slice(0, COMMAND.maxSelectionChars)}\n</original>`
              : ''
          }`
        : '';
  if (template) {
    return (
      renderTemplate(template, {
        command: input.command,
        selection: input.selection,
        context_before: input.contextBefore,
        context_after: input.contextAfter,
        passages: rendered,
      }) + target
    );
  }
  // The prompt file defines no user template; A.11's own description is the fallback shape.
  return (
    [
      `<command>${input.command}</command>`,
      `<selection>\n${input.selection}\n</selection>`,
      `<context_before>\n${input.contextBefore}\n</context_before>`,
      `<context_after>\n${input.contextAfter}\n</context_after>`,
      ...(rendered ? [`<passages>\n${rendered}\n</passages>`] : []),
    ].join('\n\n') + target
  );
}

export function buildCommandRequest(input: CommandBuildInput): LlmRequest {
  return {
    tier: COMMAND.tier,
    system: {
      cached: `${loadPrompt('_preamble').system}\n\n${input.memoryBlock}\n\n${loadPrompt(isEditAction(input.command) ? 'edit' : 'command').system}`,
    },
    messages: [{ role: 'user', content: commandUserMessage(input) }],
    maxTokens: COMMAND.maxTokens,
    temperature: COMMAND.temperature,
    action: 'COMMAND',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

export const commandResultSchema = z.object({ text: z.string() });

export type CommandPostProcess = {
  text: string;
  /** Citation keys the model introduced that were not allowed; stripped (§10.6). */
  hallucinated: string[];
  /** Keys that were in the selection and are gone from the rewrite (A.11's "never remove"). */
  dropped: string[];
  /**
   * ADR-0095: keys the rewrite wrote more often than the selection had them. The extra copies are
   * removed (Jenni was seen printing "(Jain, 2023)(Jain, 2023)"); reported for the record.
   */
  doubled: string[];
  /**
   * ADR-0095: keys whose claim changed — none of the words before the citation in the selection
   * is before it in the rewrite (Jenni's Hedge was seen moving citations between claims). Not
   * fixable in code, so the student is warned before Replace, as for a dropped one.
   */
  moved: string[];
  /**
   * ADR-0095: keys written more often than the selection had them where the extra copy is part of
   * a sentence ("the findings in …") and could not be taken out without breaking it — a warning.
   */
  repeated: string[];
  words: number;
  originalWords: number;
};

const wordsOf = (text: string) => text.trim().split(/\s+/).filter(Boolean);

/** The selection's text with citation markers taken out, for reading its edges. */
const bare = (text: string) => text.replace(/\{\{cite:[^}]+\}\}/g, '').replace(/\s+$/, '');

/**
 * A rewrite that goes back where part of a sentence was (2026-10-06, seen in the demo video): the
 * model writes a whole sentence, so a selection that stopped at "…socio-cultural norms " came back
 * as "…norms." and the paragraph read "norms.that constrain". The rewrite keeps the selection's
 * own edges: its leading and trailing whitespace, no full stop the selection did not end with, and
 * a lower-case first letter where the selection began mid-sentence.
 */
export function fitToSelection(rewrite: string, selection: string): string {
  let text = rewrite.trim();
  if (!text || /^\|/.test(text)) return rewrite;
  const before = /^\s*/.exec(selection)?.[0] ?? '';
  const after = /\s*$/.exec(selection)?.[0] ?? '';
  const end = bare(selection);
  // "." "!" "?" possibly followed by a closing quote or bracket ends a sentence.
  const endsSentence = /[.!?…]["'’”)\]]*$/.test(end);
  if (!endsSentence && /[^.]\.$/.test(text)) text = text.slice(0, -1);
  const first = /^\s*(\S+)/.exec(selection)?.[1] ?? '';
  const word = /^(\S+)/.exec(text)?.[1] ?? '';
  // Lower-case only an ordinary capitalised word: not "UPI", "FinTech" or "I".
  if (/^[a-z]/.test(first) && /^[A-Z][a-z]+[,;:]?$/.test(word)) {
    text = text.charAt(0).toLowerCase() + text.slice(1);
  }
  return `${before}${text}${after}`;
}

/** Short and common words, which say nothing about which claim a citation sits on. */
const FUNCTION_WORDS = new Set(
  'about above after again against among because before being below between could during every from further have having into itself more most other ought over same should since some such than that their them then there these they this those through under until very were what when where which while with within would your also however although therefore thus whereas'.split(
    ' ',
  ),
);

/**
 * A citation written after a sentence's full stop (". {{cite:k1}} The data…", seen from the
 * strong model on Strengthen, 2026-10-07) goes back before it, where the thesis styles put it.
 */
export function citationsBeforeStop(text: string): string {
  return text.replace(
    /([.!?])[ \t]+((?:\{\{cite:[^}]+\}\}[ \t]*)+)(?=\s|$)/g,
    (_m, stop: string, cites: string) => ` ${cites.trim()}${stop}`,
  );
}

/** The content words of the stretch of sentence before the first `{{cite:key}}`, cut to a stem. */
export function claimWords(text: string, key: string): Set<string> {
  const marker = `{{cite:${key}}}`;
  const at = text.indexOf(marker);
  if (at < 0) return new Set();
  // The sentence the citation closes: back to the previous full stop, or a list item's start.
  // A citation straight after a full stop belongs to the sentence that stop ended.
  const parts = text
    .slice(0, at)
    .replace(/\{\{cite:[^}]+\}\}/g, ' ')
    .split(/[.!?](?=\s)|\n/);
  const before = [...parts].reverse().find((p) => p.trim().length > 0) ?? '';
  return new Set(
    before
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 5 && !FUNCTION_WORDS.has(w))
      .map((w) => w.slice(0, 5)),
  );
}

/** The content-word stems of a stretch of text, as `claimWords` cuts them. */
function stemsOf(text: string): Set<string> {
  return new Set(
    text
      .replace(/\{\{cite:[^}]+\}\}/g, ' ')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 5 && !FUNCTION_WORDS.has(w))
      .map((w) => w.slice(0, 5)),
  );
}

/**
 * Whether the citation `key` sits on a different claim in `rewrite` than in `selection`. Its claim
 * is the words before it in the selection; it has moved when its sentence in the rewrite shares
 * none of them, or when another sentence of the rewrite matches them clearly better (2026-10-07,
 * real model: "Fix the flow" put a closing sentence's three citations on the sentence before it,
 * which shared one word with the claim — one shared word is nothing inside a paragraph on one
 * topic).
 */
export function citationMoved(selection: string, rewrite: string, key: string): boolean {
  const claim = claimWords(selection, key);
  if (claim.size === 0) return false;
  const marker = `{{cite:${key}}}`;
  const sentences = rewrite.split(/(?<=[.!?])\s+|\n/).filter((s) => s.trim().length > 0);
  const home = sentences.findIndex((s) => s.includes(marker));
  if (home < 0) return false;
  const overlap = (s: string) => [...stemsOf(s)].filter((w) => claim.has(w)).length;
  const scores = sentences.map(overlap);
  const atHome = scores[home] ?? 0;
  if (atHome === 0) return true;
  const best = Math.max(...scores);
  return best >= atHome + 2 && best >= 2 * atHome;
}

/**
 * Removes the copies of `key` after the first `keep` — but only a copy at the end of a clause
 * ("… claim {{cite:k1}}."), where taking it out leaves a whole sentence. A copy the sentence uses
 * as a noun ("the findings in {{cite:k1}}") stays, and the student is warned instead: removing it
 * left "the findings in." on the real model (2026-10-07). Returns the text and whether any copy
 * had to stay.
 */
function keepFirst(text: string, key: string, keep: number): { text: string; stayed: boolean } {
  let seen = 0;
  let stayed = false;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out = text.replace(
    new RegExp(`\\s*\\{\\{cite:${escaped}\\}\\}`, 'g'),
    (m: string, offset: number, whole: string) => {
      seen += 1;
      if (seen <= keep) return m;
      // Closes a clause: only other citations, then punctuation or the end, come after it.
      const rest = whole.slice(offset + m.length);
      if (/^(\s*\{\{cite:[^}]+\}\})*\s*([.,;:!?)]|$)/.test(rest)) {
        // The space it stood after goes too, unless the next citation needs it.
        return rest.startsWith('{{') && /^\s/.test(m) ? ' ' : '';
      }
      stayed = true;
      return m;
    },
  );
  return { text: out, stayed };
}

/**
 * §10.6 applied to a rewrite: a citation may only be one that was already in the selection or is
 * one of the passages sent with the request. Anything else is stripped. Citations the model
 * dropped are reported rather than restored — where they belonged is not knowable — so the UI can
 * warn before the student applies it.
 */
export function postProcessCommand(
  raw: string,
  selection: string,
  allowedPassageIds: readonly string[],
  command?: CommandName,
): CommandPostProcess {
  const keysIn = (text: string): string[] =>
    [...text.matchAll(CITE_RE)].map((m) => (m[1] ?? '').trim()).filter(Boolean);
  const inSelection = new Set(keysIn(selection));
  const allowed = new Set([...inSelection, ...allowedPassageIds]);

  const hallucinated: string[] = [];
  // One paper's passages side by side print as one label repeated (2026-10-04). The selection's
  // own citations carry editor keys with no `#`, so they never merge with each other here.
  const text = collapseSameSourceRuns(
    citationsBeforeStop(normalizeBareCitations(raw))
      .replace(CITE_RE, (match, id: string) => {
        const key = id.trim();
        if (allowed.has(key)) return match;
        hallucinated.push(key);
        return '';
      })
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([.,;:])/g, '$1')
      .trim(),
  );

  // ADR-0095: a citation of the selection written more often than it was there keeps its first
  // copies only.
  const countIn = (t: string, key: string) => keysIn(t).filter((k) => k === key).length;
  const doubled: string[] = [];
  const repeated: string[] = [];
  let deduped = text;
  for (const key of inSelection) {
    const want = countIn(selection, key);
    if (countIn(deduped, key) > want) {
      doubled.push(key);
      const fixed = keepFirst(deduped, key, want);
      deduped = fixed.text;
      if (fixed.stayed) repeated.push(key);
    }
  }
  // ADR-0147: the model's dashes become a thesis's punctuation, unless the student's own
  // selection used dashes (then they are the student's style, and the rewrite keeps them).
  const punctuated = academicPunctuationUnlessStudents(deduped, selection);
  const kept = new Set(keysIn(punctuated));
  const dropped = [...inSelection].filter((k) => !kept.has(k));
  // A translation has no words in common with its source; a table puts a citation in a column.
  const moved =
    command === 'translate' || command === 'table'
      ? []
      : [...inSelection].filter(
          (key) => kept.has(key) && citationMoved(selection, punctuated, key),
        );
  const fitted = fitToSelection(punctuated, selection);

  return {
    text: fitted,
    hallucinated,
    dropped,
    doubled,
    moved,
    repeated,
    words: wordsOf(text).length,
    originalWords: wordsOf(selection).length,
  };
}

// ---------------------------------------------------------------------------------------------
// Word-level diff (FR-4.8: "Result shown as a diff")
// ---------------------------------------------------------------------------------------------

export type DiffOp = { type: 'same' | 'add' | 'remove'; text: string };

/**
 * A word-level diff by longest common subsequence. Small selections only (A.11 caps the output at
 * 900 tokens), so the O(n·m) table is fine and a dependency is not warranted.
 */
export function diffWords(before: string, after: string): DiffOp[] {
  const a = before.split(/(\s+)/).filter((t) => t !== '');
  const b = after.split(/(\s+)/).filter((t) => t !== '');
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const row = table[i] as number[];
      row[j] =
        a[i] === b[j]
          ? (table[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(table[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const ops: DiffOp[] = [];
  const push = (type: DiffOp['type'], text: string) => {
    const last = ops.at(-1);
    if (last && last.type === type) last.text += text;
    else ops.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i] as string);
      i++;
      j++;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      push('remove', a[i] as string);
      i++;
    } else {
      push('add', b[j] as string);
      j++;
    }
  }
  while (i < n) push('remove', a[i++] as string);
  while (j < m) push('add', b[j++] as string);
  return ops;
}

// ---------------------------------------------------------------------------------------------
// Mock (AI_PROVIDER=mock)
// ---------------------------------------------------------------------------------------------

const FORMAL: Array<[RegExp, string]> = [
  [/\bdon't\b/gi, 'do not'],
  [/\bdoesn't\b/gi, 'does not'],
  [/\bisn't\b/gi, 'is not'],
  [/\bcan't\b/gi, 'cannot'],
  [/\bit's\b/gi, 'it is'],
  [/\bwon't\b/gi, 'will not'],
  [/\ba lot of\b/gi, 'considerable'],
  [/\bbig\b/gi, 'substantial'],
  [/\bgot\b/gi, 'obtained'],
  [/\bshow\b/gi, 'demonstrate'],
];

const SIMPLE: Array<[RegExp, string]> = [
  [/\butilise\b/gi, 'use'],
  [/\butilize\b/gi, 'use'],
  [/\bdemonstrate\b/gi, 'show'],
  [/\bsubsequently\b/gi, 'then'],
  [/\bapproximately\b/gi, 'about'],
  [/\bcommence\b/gi, 'start'],
  [/\bin order to\b/gi, 'to'],
  [/\bnevertheless\b/gi, 'even so'],
];

/**
 * A mechanical rewrite of the selection: substitutions for formalise and simplify, sentence
 * dropping for shorten, one connective sentence per paragraph for expand, and the selection
 * unchanged for consistency. Every citation in the selection is preserved, which is A.11's
 * strictest rule, so the whitelist and diff paths are exercisable without a provider.
 */
export function mockCommandFor(req: { messages: ReadonlyArray<{ content: string }> }): string {
  const content = req.messages.at(-1)?.content ?? '';
  const command = (
    /<command>(.*?)<\/command>/s.exec(content)?.[1] ?? 'formalise'
  ).trim() as CommandName;
  const selection = (/<selection>\n?([\s\S]*?)\n?<\/selection>/.exec(content)?.[1] ?? '').trim();
  if (!selection) return '';

  const sentences = selection.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [selection];
  switch (command) {
    case 'formalise':
      return FORMAL.reduce((text, [re, to]) => text.replace(re, to), selection);
    case 'simplify':
      return SIMPLE.reduce((text, [re, to]) => text.replace(re, to), selection);
    case 'shorten': {
      // Keep sentences until about 60% of the words, and never drop one carrying a citation.
      const target = Math.max(1, Math.round(wordsOf(selection).length * COMMAND.shortenRatio));
      const kept: string[] = [];
      let count = 0;
      for (const sentence of sentences) {
        const hasCite = CITE_RE.test(sentence);
        CITE_RE.lastIndex = 0;
        if (count >= target && !hasCite) continue;
        kept.push(sentence);
        count += wordsOf(sentence).length;
      }
      return kept.join('').trim();
    }
    case 'expand': {
      const last = sentences.at(-1)?.trim() ?? '';
      return `${selection} This follows from the evidence stated above, and the paragraphs that follow take it further.${
        last.endsWith('.') ? '' : '.'
      }`;
    }
    case 'hedge':
      // ADR-0066: the mechanical half of hedging, enough to see a change on the screen.
      return selection.replace(/\bshows\b/g, 'suggests').replace(/\bproves\b/g, 'indicates');
    case 'direct':
      return selection.replace(/\bit could (perhaps )?be argued that\s*/gi, '');
    case 'translate':
      // ADR-0081: the mock knows no language; the selection comes back as it is, citations kept.
      return selection;
    case 'table': {
      // ADR-0081: one row per sentence, the sentence's citation markers in their own column, so
      // the whitelist, the diff and the table insertion are exercisable without a provider.
      const rows = sentences.map((sentence) => {
        const cites = sentence.match(CITE_RE) ?? [];
        CITE_RE.lastIndex = 0;
        const text = sentence
          .replace(CITE_RE, '')
          .replace(/\s+/g, ' ')
          .replace(/\s+([.!?,;])/g, '$1')
          .trim();
        CITE_RE.lastIndex = 0;
        return `| ${text.replace(/\|/g, '/')} | ${cites.join(' ')} |`;
      });
      return ['| Finding | Source |', '| --- | --- |', ...rows].join('\n');
    }
    case 'bullets':
    case 'numbered':
      // ADR-0095: one sentence per item, so the list insertion is exercisable without a provider.
      return sentences
        .map((sentence, i) => `${command === 'numbered' ? `${i + 1}.` : '-'} ${sentence.trim()}`)
        .join('\n');
    case 'custom':
      // The mock cannot follow an instruction; it makes the formalise changes, so there is a diff.
      return FORMAL.reduce((text, [re, to]) => text.replace(re, to), selection);
    default:
      // consistency: A.11 says output the selection unchanged when nothing conflicts. The other
      // edit actions are left as they are by the mock: their changes are the model's to make.
      return selection;
  }
}

export const mockCommandResponse = {
  match: (req: { action: string }) => req.action === 'COMMAND',
  respond: (req: { messages: ReadonlyArray<{ content: string }> }) => ({
    text: mockCommandFor(req),
  }),
};

// ---------------------------------------------------------------------------------------------
// "What changed and why" (ADR-0095, Jenni build plan R8)
// ---------------------------------------------------------------------------------------------

export const EDIT_REASONS = {
  tier: 'fast',
  maxTokens: 300,
  temperature: 0.2,
  /** Points shown at most. */
  maxReasons: 4,
  /** Characters of each side sent; a selection is capped at 6,000 already. */
  maxChars: 6_000,
} as const;

/** No `.max()`: OpenAI's strict mode refuses it (CLAUDE.md); the cap is applied in code. */
export const editReasonsSchema = z.object({ reasons: z.array(z.string()) });

export function editReasonsUserMessage(input: {
  command: CommandName;
  instruction?: string;
  before: string;
  after: string;
}): string {
  const edit =
    input.command === 'custom' && input.instruction?.trim()
      ? `custom: ${input.instruction.trim().slice(0, COMMAND.maxInstructionChars)}`
      : `${input.command} (${COMMAND_LABELS[input.command].label})`;
  return [
    `<edit>${edit}</edit>`,
    `<before>\n${input.before.trim().slice(0, EDIT_REASONS.maxChars)}\n</before>`,
    `<after>\n${input.after.trim().slice(0, EDIT_REASONS.maxChars)}\n</after>`,
  ].join('\n\n');
}

export function buildEditReasonsRequest(input: {
  command: CommandName;
  instruction?: string;
  before: string;
  after: string;
  userId: string;
  documentId: string;
  signal?: AbortSignal;
}): Omit<LlmRequest, 'schema'> {
  return {
    tier: EDIT_REASONS.tier,
    system: { cached: `${loadPrompt('_preamble').system}\n\n${loadPrompt('edit_reasons').system}` },
    messages: [{ role: 'user', content: editReasonsUserMessage(input) }],
    maxTokens: EDIT_REASONS.maxTokens,
    temperature: EDIT_REASONS.temperature,
    // Inside the edit's own unit: logged against COMMAND, never a second unit.
    action: 'COMMAND',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

/**
 * A point that only says something stayed as it was ("The citation remains unchanged", "No facts
 * were added or removed"). The fast model wrote one under most edits in the 2026-10-07 rounds,
 * often as a "Check:", which reads as a warning about nothing.
 */
export function saysNothingChanged(reason: string): boolean {
  const stays =
    /\b(remain(s|ed)?|unchanged|kept|keeps|maintain(s|ed|ing)?|preserv(e|es|ed|ing)|intact|no (facts?|citations?|information|content|details?)\b[^.]*\b(were|was) (added|removed|changed|introduced|lost))\b/i;
  const changes =
    /\b(was|were|is|been) (removed|dropped|lost|deleted|weakened|softened|missing|not added)\b|\bnot (present|in the|supported)|\bmissing\b|\badds?\b|\badded\b|\bnew\b/i;
  return (
    stays.test(reason) &&
    !changes.test(reason.replace(/no [^.]*\b(were|was) (added|removed|introduced)/i, ''))
  );
}

/** At most four points, each trimmed; empty ones and "nothing changed" ones dropped. */
export function cleanEditReasons(reasons: readonly string[]): string[] {
  return (
    reasons
      // A list marker the model added ("- ", "• ", "2. "), not a point that starts with a figure.
      .map((r) => r.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, '').trim())
      .filter((r) => r.length > 0 && !saysNothingChanged(r))
      .slice(0, EDIT_REASONS.maxReasons)
  );
}

/** The mock's "What changed and why": what a diff can say without a model. */
export const mockEditReasonsResponse = {
  match: (req: { messages: ReadonlyArray<{ content: unknown }> }) =>
    req.messages.some((m) => typeof m.content === 'string' && m.content.startsWith('<edit>')),
  respond: (req: { messages: ReadonlyArray<{ content: unknown }> }) => {
    const content = String(req.messages.at(-1)?.content ?? '');
    const before = /<before>\n([\s\S]*?)\n<\/before>/.exec(content)?.[1] ?? '';
    const after = /<after>\n([\s\S]*?)\n<\/after>/.exec(content)?.[1] ?? '';
    const ops = diffWords(before, after);
    const added = ops.filter((o) => o.type === 'add').length;
    const removed = ops.filter((o) => o.type === 'remove').length;
    return {
      reasons:
        added + removed === 0
          ? ['Almost nothing changed.']
          : [`Changed ${added + removed} places in the wording; the points and citations stay.`],
    };
  },
};
