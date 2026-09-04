/**
 * Splits PRD Appendix A into `packages/ai/prompts/*.md`, one file per prompt, verbatim.
 *
 * PRD §0.3 rule 11: "Prompts are content, not code. The prompt texts in Appendix A are used
 * verbatim... The agent may not rewrite them." This script is the only thing allowed to write those
 * files, and `test/prompts.spec.ts` re-runs the same extraction and asserts the files on disk still
 * match the PRD byte for byte. Editing a prompt by hand fails that test.
 *
 *   pnpm --filter @tc/ai run prompts:extract
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const PROMPTS_DIR = join(here, '..', 'prompts');
export const PRD_PATH = join(here, '..', '..', '..', 'docs', 'PRD.md');

/** A prompt section lifted out of Appendix A. */
export type ExtractedPrompt = {
  /** File name taken from the backticked name in the PRD heading, e.g. `assist.md`. */
  readonly filename: string;
  /** The heading itself, e.g. "### A.1 Assist — `assist.md`". */
  readonly heading: string;
  /** Everything from the heading to just before the next heading, verbatim. */
  readonly body: string;
};

/**
 * Appendix A headings come in two shapes:
 *   `### A.1 Assist — \`assist.md\``            (most prompts)
 *   `**A.12.1 TERM_DRIFT — \`coh_term.md\`**`   (the four coherence checks, nested under A.12)
 * Both name their file in backticks. `### A.12 Coherence checks` names none and is a container.
 *
 * The bold form may carry trailing prose after the closing `**`, as A.12.3 does with
 * "(Fast tier is acceptable here)", so the pattern must not anchor to end of line there.
 */
const HEADING = /^(?:### A\.[0-9.]+ .*|\*\*A\.12\.\d .*)$/;
const FILENAME = /`([a-z_]+\.md)`/;

export function extractPrompts(prdText: string): ExtractedPrompt[] {
  const lines = prdText.split('\n');

  const start = lines.findIndex((l) => l.startsWith('## Appendix A'));
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## Appendix B'));
  if (start === -1 || end === -1) {
    throw new Error(`Could not locate Appendix A in ${PRD_PATH}`);
  }

  // Heading lines inside fenced code blocks must not be treated as headings.
  const headingIndexes: number[] = [];
  let inFence = false;
  for (let i = start; i < end; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('```')) inFence = !inFence;
    if (!inFence && HEADING.test(line)) headingIndexes.push(i);
  }

  const prompts: ExtractedPrompt[] = [];
  for (let n = 0; n < headingIndexes.length; n++) {
    const from = headingIndexes[n] ?? 0;
    const to = headingIndexes[n + 1] ?? end;
    const heading = lines[from] ?? '';
    const match = FILENAME.exec(heading);
    if (!match?.[1]) continue; // container heading such as "### A.12 Coherence checks"

    // Trim only trailing blank lines, so the file ends with exactly one newline.
    const body = `${lines.slice(from, to).join('\n').replace(/\n+$/, '')}\n`;
    prompts.push({ filename: match[1], heading, body });
  }

  return prompts;
}

/** Header written above each prompt file. Not part of the prompt text sent to the model. */
function fileHeader(prompt: ExtractedPrompt): string {
  return (
    '<!--\n' +
    '  VERBATIM COPY OF PRD APPENDIX A — DO NOT EDIT BY HAND.\n' +
    '\n' +
    '  PRD §0.3 rule 11: prompts are content, not code. If this prompt performs badly, record\n' +
    '  examples of the bad output in docs/BUILD_LOG.md and propose a change for the human to\n' +
    '  approve. Do not rewrite it here.\n' +
    '\n' +
    '  Source: docs/PRD.md, "' +
    prompt.heading.replace(/\*\*/g, '').trim() +
    '"\n' +
    '  Regenerate: pnpm --filter @tc/ai run prompts:extract\n' +
    '-->\n\n'
  );
}

export function writePrompts(): ExtractedPrompt[] {
  const prd = readFileSync(PRD_PATH, 'utf8');
  const prompts = extractPrompts(prd);
  mkdirSync(PROMPTS_DIR, { recursive: true });

  for (const prompt of prompts) {
    writeFileSync(join(PROMPTS_DIR, prompt.filename), fileHeader(prompt) + prompt.body, 'utf8');
  }
  return prompts;
}

// Run directly (not when imported by the test). Compared as resolved paths: on Windows
// `import.meta.url` percent-encodes spaces, so a string match against argv[1] would never fire.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (invokedDirectly) {
  const written = writePrompts();
  for (const p of written) {
    console.log(p.filename.padEnd(22) + p.heading.replace(/\*\*/g, '').trim());
  }
  console.log(`\n${written.length} prompt files written to packages/ai/prompts/`);
}
