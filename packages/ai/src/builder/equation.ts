/**
 * An equation described in words (2026-10-04, ADR-0063; the Jenni study, coverage-map row 70).
 *
 * The original complaint from students who cannot write LaTeX: the equation field takes only
 * LaTeX, and the cheat sheet helps only someone who already half knows it. Here the student types
 * "beta one times x plus epsilon, all over n" and gets LaTeX they see rendered, read back in plain
 * words, and can edit before pressing Insert. Nothing reaches the thesis without that press.
 *
 * Checked in code, not trusted to the prompt:
 *   - the answer must render (KaTeX, the same engine the editor and the export use), or it is
 *     refused rather than offered half-broken;
 *   - stray `$ … $`, `\[ … \]` or an equation environment around it is stripped, since the field
 *     wants bare math mode.
 *
 * Metered as COMMAND, like the other small rewrites on request (ADR-0008, ADR-0010).
 */

import katex from 'katex';
import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import type { LlmRequest } from '../types.js';

export const EQUATION = {
  tier: 'strong',
  maxTokens: 300,
  temperature: 0,
  /** The longest description worth one call; the UI holds the box to this. */
  maxDescriptionChars: 600,
} as const;

export const equationResultSchema = z.object({
  latex: z.string(),
  reading: z.string(),
});
export type EquationResult = z.infer<typeof equationResultSchema>;

export type EquationInput = {
  description: string;
  /** The LaTeX already in the field, when the student is changing it. */
  current?: string | null;
  userId: string;
  documentId: string;
  signal?: AbortSignal;
};

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function equationUserMessage(input: EquationInput): string {
  const parts = [`<description>${escapeXml(input.description.trim())}</description>`];
  if (input.current?.trim()) parts.push(`<current>${escapeXml(input.current.trim())}</current>`);
  return parts.join('\n');
}

export function buildEquationRequest(input: EquationInput): LlmRequest {
  return {
    tier: EQUATION.tier,
    system: { cached: loadPrompt('equation').system.trim() },
    messages: [{ role: 'user', content: equationUserMessage(input) }],
    maxTokens: EQUATION.maxTokens,
    temperature: EQUATION.temperature,
    action: 'COMMAND',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

/**
 * An equation read from a photo (ADR-0064). The same answer shape and the same checks as the
 * words version; the picture travels as an image part on the user turn.
 */
export const EQUATION_IMAGE = {
  tier: 'strong',
  maxTokens: 400,
  temperature: 0,
  /** The largest picture accepted, after the browser has shrunk it. */
  maxBytes: 4 * 1024 * 1024,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp'] as readonly string[],
} as const;

export type EquationImageInput = {
  image: Uint8Array;
  mediaType: string;
  userId: string;
  documentId: string;
  signal?: AbortSignal;
};

/** The text that goes with the picture; the mock looks for it. */
export const EQUATION_IMAGE_CUE = 'Transcribe the equation in this picture.';

export function buildEquationImageRequest(input: EquationImageInput): LlmRequest {
  return {
    tier: EQUATION_IMAGE.tier,
    system: { cached: loadPrompt('equation_image').system.trim() },
    messages: [
      {
        role: 'user',
        content: EQUATION_IMAGE_CUE,
        images: [{ data: input.image, mediaType: input.mediaType }],
      },
    ],
    maxTokens: EQUATION_IMAGE.maxTokens,
    temperature: EQUATION_IMAGE.temperature,
    action: 'COMMAND',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

/** The mock cannot see; it answers with a fixed, renderable equation so the path runs. */
export const mockEquationImageResponse = {
  match: (req: { action: string; messages: ReadonlyArray<{ content: string }> }) =>
    req.action === 'COMMAND' && (req.messages.at(-1)?.content ?? '') === EQUATION_IMAGE_CUE,
  respond: (): EquationResult => ({ latex: 'E = mc^{2}', reading: 'E equals m c squared' }),
};

/** Strips the wrappers a model adds around math mode even when told not to. */
export function bareMath(latex: string): string {
  let out = latex.trim();
  out = out.replace(/^\$\$([\s\S]*)\$\$$/, '$1').replace(/^\$([\s\S]*)\$$/, '$1');
  out = out.replace(/^\\\[([\s\S]*)\\\]$/, '$1').replace(/^\\\(([\s\S]*)\\\)$/, '$1');
  out = out.replace(/^\\begin\{(equation|align|displaymath)\*?\}([\s\S]*)\\end\{\1\*?\}$/, '$2');
  return out.trim();
}

export type EquationPostProcess =
  | { ok: true; latex: string; reading: string }
  | { ok: false; refusal: string; reading: string };

/** Renders with KaTeX to prove the LaTeX is usable; refuses rather than repairs. */
export function postProcessEquation(result: EquationResult): EquationPostProcess {
  const reading = result.reading.trim();
  const latex = bareMath(result.latex);
  if (!latex) {
    return {
      ok: false,
      refusal: reading || 'That does not read as an equation. Try describing it differently.',
      reading,
    };
  }
  try {
    katex.renderToString(latex, { throwOnError: true, displayMode: true });
  } catch {
    return {
      ok: false,
      refusal: 'The equation came back in a form that does not render. Try describing it again.',
      reading,
    };
  }
  return { ok: true, latex, reading };
}

// ---------------------------------------------------------------------------------------------
// Mock (AI_PROVIDER=mock)
// ---------------------------------------------------------------------------------------------

const MOCK_WORDS: Array<[RegExp, string]> = [
  [/\bsquare root of ([a-z])\b/gi, '\\sqrt{$1}'],
  [/\b([a-z]) squared\b/gi, '$1^{2}'],
  [/\b([a-z]) cubed\b/gi, '$1^{3}'],
  [/\balpha\b/gi, '\\alpha'],
  [/\bbeta\b/gi, '\\beta'],
  [/\bsigma\b/gi, '\\sigma'],
  [/\bepsilon\b/gi, '\\epsilon'],
  [/\bplus\b/gi, '+'],
  [/\bminus\b/gi, '-'],
  [/\btimes\b/gi, '\\times'],
  [/\bequals\b/gi, '='],
];

/**
 * A mechanical reading of a few spoken forms ("y equals x squared plus one", "a over b") so the
 * path is exercisable without a provider. Unknown words pass through as text.
 */
export function mockEquationFor(req: {
  messages: ReadonlyArray<{ content: string }>;
}): EquationResult {
  const content = req.messages.at(-1)?.content ?? '';
  const description = (/<description>([\s\S]*?)<\/description>/.exec(content)?.[1] ?? '').trim();
  if (!description) return { latex: '', reading: 'Nothing was described.' };
  const words = (text: string) =>
    MOCK_WORDS.reduce((t, [re, to]) => t.replace(re, to), text.trim());
  const over = /^(.+?) over (.+)$/i.exec(description);
  let latex = over
    ? `\\frac{${words(over[1] ?? '')}}{${words(over[2] ?? '')}}`
    : words(description);
  latex = latex.replace(/\s+/g, ' ').trim();
  return { latex, reading: description };
}

export const mockEquationResponse = {
  match: (req: { action: string; messages: ReadonlyArray<{ content: string }> }) =>
    req.action === 'COMMAND' && (req.messages.at(-1)?.content ?? '').includes('<description>'),
  respond: (req: { messages: ReadonlyArray<{ content: string }> }): EquationResult =>
    mockEquationFor(req),
};
