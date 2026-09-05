/**
 * The document memory block — PRD A.0.1 (`_memory.md`) and §10.3.
 *
 *   "Rendered by the prompt builder from `DocumentMemory`. Trimmed in this order until
 *    ≤ 3,200 tokens: (1) other chapters' scope notes → titles only, (2) glossary entries not
 *    appearing in the current chapter's text, (3) style profile samples."
 *
 *   §10.3: "The cached system block is byte-stable per document until memory changes … the
 *    builder trims outline/glossary to fit and logs when it trims."
 *
 * Byte-stability is the property everything here serves. The same memory must render to the same
 * bytes on every call, or the provider's cache never hits and Assist costs six times what §11.2
 * budgets. So: no timestamps, no ids that change per request, glossary in a fixed order, and
 * trimming decided only by inputs that are themselves part of the memory.
 */

import type { OutlineNode } from '@tc/types';
import { loadPrompt } from '../prompts.js';
import { renderTemplate } from '../template.js';
import { approxTokens } from './tokens.js';

/** A.0.1's own ceiling for this block. The whole cached block (§10.3) is 4,000. */
export const MEMORY_BUDGET_TOKENS = 3_200;

export type MemoryScope = {
  workingTitle: string;
  problemStatement: string;
  objectives: readonly string[];
  whyOpen: string;
};

export type GlossaryEntry = { definition: string; usageNote?: string; sourceChapterId?: string };

/** A.10's output, stored on `DocumentMemory.styleProfile` (FR-4.7). */
export type StyleProfile = {
  avgSentenceLen: number;
  register: string;
  voice: string;
  transitions: readonly string[];
  voiceNote: string;
  hedging?: string;
  sample?: readonly string[];
};

export type MemoryInput = {
  scope: MemoryScope;
  outline: readonly OutlineNode[];
  glossary: Readonly<Record<string, GlossaryEntry>>;
  styleProfile: StyleProfile | null;
  chapter: {
    outlineNodeId: string;
    /** The chapter's current plain text; decides which glossary entries survive trimming. */
    text: string;
  };
  budgetTokens?: number;
};

export type MemoryTrim =
  | 'outline-titles-only'
  | 'glossary-unused-entries'
  | 'style-profile-samples';

export type MemoryBlock = {
  text: string;
  tokens: number;
  /** Which of A.0.1's three steps were applied, in order. Empty when the block fit untouched. */
  trimmed: MemoryTrim[];
  /** True when every step was applied and the block is still over budget. */
  overBudget: boolean;
};

/** Depth-first, with the position of each node among its siblings for the "N. Title" form. */
type Flat = { node: OutlineNode; depth: number; number: string };

function flatten(nodes: readonly OutlineNode[], depth = 0, prefix = ''): Flat[] {
  const out: Flat[] = [];
  nodes.forEach((node, index) => {
    const number = prefix ? `${prefix}.${index + 1}` : String(index + 1);
    out.push({ node, depth, number });
    out.push(...flatten(node.children, depth + 1, number));
  });
  return out;
}

/**
 * A.0.1: "current chapter and its neighbours in full (title + scope note + subheadings); all other
 * chapters as 'N. Title' only". Neighbours are the previous and next top-level chapters.
 *
 * With `titlesOnly` every chapter is rendered in the short form: A.0.1's trimming step (1).
 */
export function renderOutline(
  outline: readonly OutlineNode[],
  currentId: string,
  titlesOnly = false,
): string {
  if (outline.length === 0) return '(no outline yet)';

  const currentIndex = outline.findIndex(
    (chapter) =>
      chapter.id === currentId || flatten([chapter]).some((f) => f.node.id === currentId),
  );
  const inFull = new Set<number>();
  if (currentIndex >= 0) {
    for (const index of [currentIndex - 1, currentIndex, currentIndex + 1]) {
      if (index >= 0 && index < outline.length) inFull.add(index);
    }
  }

  const lines: string[] = [];
  outline.forEach((chapter, index) => {
    const number = String(index + 1);
    if (titlesOnly || !inFull.has(index)) {
      lines.push(`${number}. ${chapter.title}`);
      return;
    }
    const marker = index === currentIndex ? ' (current)' : '';
    lines.push(`${number}. ${chapter.title}${marker}`);
    if (chapter.scopeNote.trim()) lines.push(`   Scope: ${chapter.scopeNote.trim()}`);
    for (const child of flatten(chapter.children, 1, number)) {
      const indent = '   '.repeat(child.depth);
      lines.push(`${indent}${child.number}. ${child.node.title}`);
    }
  });
  return lines.join('\n');
}

/** Case-insensitive whole-word presence, so "Adoption" in the glossary matches "adoption rates". */
function mentions(text: string, term: string): boolean {
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(text);
}

function glossaryRows(
  glossary: Readonly<Record<string, GlossaryEntry>>,
  keep: (term: string) => boolean,
): Array<{ term: string; definition: string; usageNote?: string }> {
  // Sorted, so the same glossary always renders in the same order (byte-stability).
  return Object.keys(glossary)
    .sort((a, b) => a.localeCompare(b, 'en'))
    .filter(keep)
    .map((term) => {
      const entry = glossary[term] as GlossaryEntry;
      return {
        term,
        definition: entry.definition,
        ...(entry.usageNote ? { usageNote: entry.usageNote } : {}),
      };
    });
}

function render(
  input: MemoryInput,
  options: { titlesOnly: boolean; glossaryUsedOnly: boolean; dropSamples: boolean },
): string {
  const template = loadPrompt('_memory').system;

  const glossary = glossaryRows(input.glossary, (term) =>
    options.glossaryUsedOnly ? mentions(input.chapter.text, term) : true,
  );

  const styleProfile = input.styleProfile
    ? {
        ...input.styleProfile,
        transitions: [...input.styleProfile.transitions].join(', '),
        ...(options.dropSamples ? { sample: undefined } : {}),
      }
    : null;

  return renderTemplate(template, {
    scope: input.scope,
    chapter: { outlineNodeId: input.chapter.outlineNodeId },
    outline_rendered: renderOutline(input.outline, input.chapter.outlineNodeId, options.titlesOnly),
    glossary,
    styleProfile,
  }).trim();
}

/**
 * Renders A.0.1 and applies its trimming steps, in its order, only as far as needed. Each step is
 * a function of the memory and the chapter text alone, so two calls with the same inputs produce
 * the same bytes.
 */
export function buildMemoryBlock(input: MemoryInput): MemoryBlock {
  const budget = input.budgetTokens ?? MEMORY_BUDGET_TOKENS;
  const trimmed: MemoryTrim[] = [];
  const options = { titlesOnly: false, glossaryUsedOnly: false, dropSamples: false };

  let text = render(input, options);
  let tokens = approxTokens(text);
  if (tokens <= budget) return { text, tokens, trimmed, overBudget: false };

  const steps: Array<[MemoryTrim, keyof typeof options]> = [
    ['outline-titles-only', 'titlesOnly'],
    ['glossary-unused-entries', 'glossaryUsedOnly'],
    // The template renders no samples, so this step changes nothing today; it is kept so the
    // order of A.0.1 is visible in code and the log says the step ran.
    ['style-profile-samples', 'dropSamples'],
  ];

  for (const [name, flag] of steps) {
    options[flag] = true;
    trimmed.push(name);
    text = render(input, options);
    tokens = approxTokens(text);
    if (tokens <= budget) return { text, tokens, trimmed, overBudget: false };
  }

  return { text, tokens, trimmed, overBudget: true };
}
