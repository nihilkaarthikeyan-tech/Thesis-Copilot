/**
 * Prompt loader — PRD §10.5.
 *
 * Reads `packages/ai/prompts/*.md`. Since ADR-0038 (2026-09-30) these files are the product's own
 * and change when a new version wins the side-by-side evaluation in `packages/ai/eval`; they began
 * as copies of PRD Appendix A. The fenced code blocks inside each file are the prompt text and the
 * prose around them is the explanation.
 *
 * Block order inside a prompt file follows Appendix A:
 *   block 0 = the system block
 *   block 1 = the user message template, where the prompt has one (A.1, A.2, ...)
 * Prompts with extra fenced blocks (worked examples) keep them in `blocks` but they are not sent.
 *
 * `test/prompts.spec.ts` checks that every prompt parses and keeps the rules the code relies on.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path of the prompts directory.
 *
 * Resolved by walking up until a `prompts` folder is found, because this file runs from `src/`
 * during tests and from `dist/` in the built image, and the prompts sit beside both.
 */
function findPromptsDir(from: string): string {
  let dir = from;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'prompts');
    if (existsSync(candidate)) return candidate;
    dir = join(dir, '..');
  }
  throw new Error(`Could not locate packages/ai/prompts starting from ${from}`);
}

export const PROMPTS_DIR = findPromptsDir(here);

/** The 21 prompt files of Appendix A (PRD §10.5), and eight it lacks (ADR-0010, -0023, -0026, -0030, -0039). */
export const PROMPT_NAMES = [
  '_preamble',
  '_memory',
  'assist',
  'draft',
  'cite',
  'chat',
  'extract',
  'proposal',
  'queries',
  'themes',
  'outline',
  'style',
  'command',
  'coh_term',
  'coh_claim',
  'coh_unsupported',
  'coh_outline',
  'comment_classify',
  'revise',
  'cite_parse',
  'xpaper',
  // FR-5.6. Not a verbatim copy of an Appendix A section, because Appendix A has none for it —
  // see docs/ADR/0010-fr-5-6-prompt.md.
  'cite_role',
  // The citation-support check, likewise with no Appendix A section — docs/ADR/0023.
  'coh_support',
  // Proofreading, likewise — docs/ADR/0026.
  'proofread',
  // Viva preparation, likewise — docs/ADR/0030.
  'viva_questions',
  'viva_feedback',
  // Chapter build, likewise — docs/ADR/0039.
  'entities',
  'examiner',
  'fix_flagged',
  // An equation described in words — docs/ADR/0063.
  'equation',
  // An equation read from a photo — docs/ADR/0064.
  'equation_image',
  // Edit actions beyond A.11's section commands — docs/ADR/0066.
  'edit',
] as const;

export type PromptName = (typeof PROMPT_NAMES)[number];

export type LoadedPrompt = {
  readonly name: PromptName;
  /** Every fenced block in the file, in order. */
  readonly blocks: readonly string[];
  /** Block 0 — the system block. */
  readonly system: string;
  /** Block 1 — the user message template, when the prompt defines one. */
  readonly user?: string;
  /** The whole file, including the PRD prose. Kept for tests and documentation. */
  readonly raw: string;
};

/** Pulls the contents of every ``` fenced block out of a markdown document, in order. */
export function extractFencedBlocks(markdown: string): string[] {
  const lines = markdown.split('\n');
  const blocks: string[] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (current === null) {
        current = [];
      } else {
        blocks.push(current.join('\n'));
        current = null;
      }
      continue;
    }
    current?.push(line);
  }

  if (current !== null) {
    throw new Error('Unclosed code fence in prompt file');
  }
  return blocks;
}

const cache = new Map<PromptName, LoadedPrompt>();

/**
 * A prompt swapped in for one run of the evaluation (ADR-0038): `packages/ai/eval` compares a
 * candidate with the prompt on disk by building the same request both ways. Never set in the
 * app; `null` removes the override.
 */
const overrides = new Map<PromptName, LoadedPrompt>();

export function overridePrompt(name: PromptName, raw: string | null): void {
  if (raw === null) {
    overrides.delete(name);
    return;
  }
  const blocks = extractFencedBlocks(raw);
  if (blocks.length === 0) throw new Error(`Override for ${name} contains no fenced block`);
  overrides.set(name, {
    name,
    blocks,
    system: blocks[0] ?? '',
    ...(blocks.length > 1 ? { user: blocks[1] } : {}),
    raw,
  });
}

/** Loads one prompt by name. Cached — prompt files never change at runtime. */
export function loadPrompt(name: PromptName, dir: string = PROMPTS_DIR): LoadedPrompt {
  const override = dir === PROMPTS_DIR ? overrides.get(name) : undefined;
  if (override) return override;
  const cached = dir === PROMPTS_DIR ? cache.get(name) : undefined;
  if (cached) return cached;

  const raw = readFileSync(join(dir, `${name}.md`), 'utf8');
  const blocks = extractFencedBlocks(raw);

  if (blocks.length === 0) {
    throw new Error(`Prompt file ${name}.md contains no fenced block`);
  }

  const prompt: LoadedPrompt = {
    name,
    blocks,
    system: blocks[0] ?? '',
    ...(blocks.length > 1 ? { user: blocks[1] } : {}),
    raw,
  };

  if (dir === PROMPTS_DIR) cache.set(name, prompt);
  return prompt;
}

/** Loads all 21 prompts. Called at boot so a missing or malformed file fails fast. */
export function loadAllPrompts(dir: string = PROMPTS_DIR): Map<PromptName, LoadedPrompt> {
  const loaded = new Map<PromptName, LoadedPrompt>();
  for (const name of PROMPT_NAMES) {
    loaded.set(name, loadPrompt(name, dir));
  }
  return loaded;
}

/** File names actually present on disk, without the `.md`. */
export function listPromptFiles(dir: string = PROMPTS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}
