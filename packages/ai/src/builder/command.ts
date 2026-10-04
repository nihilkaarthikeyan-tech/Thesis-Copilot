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
import type { PromptPassage } from './assist.js';
import { CITE_RE, collapseSameSourceRuns, normalizeBareCitations } from './postprocess.js';

/**
 * ADR-0066: edit actions with their own prompt (`edit.md`), run through exactly the same path,
 * checks and allowance as the five section commands of A.11.
 */
export const EDIT_ACTIONS = ['hedge', 'direct', 'active', 'past', 'present', 'counter'] as const;
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
  /** A.11 gives passages only to the commands that can use them. */
  needsPassages: ['expand', 'consistency', 'counter'] as readonly CommandName[],
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
};

export function commandUserMessage(input: CommandBuildInput): string {
  const template = loadPrompt('command').user;
  const passages = COMMAND.needsPassages.includes(input.command) ? input.passages : [];
  const rendered = passages
    .map(
      (p) =>
        `<passage id="${p.id}" source="${p.shortRef}"${p.page ? ` page="${p.page}"` : ''}>\n${p.text}\n</passage>`,
    )
    .join('\n');
  if (template) {
    return renderTemplate(template, {
      command: input.command,
      selection: input.selection,
      context_before: input.contextBefore,
      context_after: input.contextAfter,
      passages: rendered,
    });
  }
  // The prompt file defines no user template; A.11's own description is the fallback shape.
  return [
    `<command>${input.command}</command>`,
    `<selection>\n${input.selection}\n</selection>`,
    `<context_before>\n${input.contextBefore}\n</context_before>`,
    `<context_after>\n${input.contextAfter}\n</context_after>`,
    ...(rendered ? [`<passages>\n${rendered}\n</passages>`] : []),
  ].join('\n\n');
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
  words: number;
  originalWords: number;
};

const wordsOf = (text: string) => text.trim().split(/\s+/).filter(Boolean);

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
): CommandPostProcess {
  const keysIn = (text: string): string[] =>
    [...text.matchAll(CITE_RE)].map((m) => (m[1] ?? '').trim()).filter(Boolean);
  const inSelection = new Set(keysIn(selection));
  const allowed = new Set([...inSelection, ...allowedPassageIds]);

  const hallucinated: string[] = [];
  // One paper's passages side by side print as one label repeated (2026-10-04). The selection's
  // own citations carry editor keys with no `#`, so they never merge with each other here.
  const text = collapseSameSourceRuns(
    normalizeBareCitations(raw)
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

  const kept = new Set(keysIn(text));
  const dropped = [...inSelection].filter((k) => !kept.has(k));

  return {
    text,
    hallucinated,
    dropped,
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
