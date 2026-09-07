/**
 * Citation role rewrite — PRD FR-5.6: "Narrative ↔ parenthetical rewrite on request (strong tier;
 * language task)."
 *
 * The citation node has carried `role: 'parenthetical' | 'narrative'` since FR-5.1 and the
 * renderer has always honoured it. What was missing is the half that makes changing it useful: the
 * *sentence* has to change too. "Upfront cost was the main barrier (Kumar, 2021)" and "Kumar
 * (2021) found that upfront cost was the main barrier" are the same claim in two grammars, and
 * flipping the attribute alone leaves the reader with a sentence that no longer parses.
 *
 * Two rules the prompt states and the post-processing enforces, because a model will break both:
 *
 *   1. **The citation id survives byte-for-byte.** A rewrite that dropped or altered it would
 *      silently detach the claim from its source — the exact failure §10.6 exists to prevent.
 *   2. **No author name is written into the prose.** The id renders itself in whatever style the
 *      document is set to; a name typed as words would not follow a style switch, and FR-5.2
 *      promises that switching APA→IEEE needs no body edits.
 *
 * Metered against `COMMAND` for the reason ADR-0008 gives: it is the same kind of act as a section
 * command — a Strong-tier rewrite of one piece of the student's own text, on request — and the
 * ₹100 ceiling has no room for a cap of its own.
 */

import { loadPrompt } from '../prompts.js';
import { renderTemplate } from '../template.js';
import type { LlmRequest } from '../types.js';

export const CITE_ROLE = {
  tier: 'strong',
  maxTokens: 400,
  temperature: 0.2,
} as const;

export const CITATION_ROLES = ['parenthetical', 'narrative'] as const;
export type CitationRole = (typeof CITATION_ROLES)[number];

export type CiteRoleInput = {
  /** The sentence the citation sits in, as it currently reads. */
  sentence: string;
  /** The `{{cite:ID}}` id being moved — the one in `<target>`. */
  citationId: string;
  targetRole: CitationRole;
  memoryBlock: string;
  userId: string;
  documentId: string;
  signal?: AbortSignal;
};

export function citeRoleCachedBlock(memoryBlock: string): string {
  const preamble = loadPrompt('_preamble').system.trim();
  const task = loadPrompt('cite_role').system.trim();
  return [preamble, memoryBlock.trim(), task].join('\n\n');
}

export function citeRoleUserMessage(input: CiteRoleInput): string {
  const template = loadPrompt('cite_role').user;
  if (!template) throw new Error('cite_role.md has no user message block');
  return renderTemplate(template, {
    citationId: input.citationId,
    targetRole: input.targetRole,
    sentence: input.sentence.trim(),
  });
}

export function buildCiteRoleRequest(input: CiteRoleInput): LlmRequest {
  return {
    tier: CITE_ROLE.tier,
    system: { cached: citeRoleCachedBlock(input.memoryBlock) },
    messages: [{ role: 'user', content: citeRoleUserMessage(input) }],
    maxTokens: CITE_ROLE.maxTokens,
    temperature: CITE_ROLE.temperature,
    action: 'COMMAND',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

const CITE_RE = /\{\{cite:([^}]+)\}\}/g;

export type CiteRolePostProcess = {
  sentence: string;
  /** True when the rewrite is usable; false means the original is kept and the reason is given. */
  ok: boolean;
  /** Why it was refused, in the words the student reads. */
  refusal: string | null;
  /** True when the model returned the sentence unchanged — a legitimate answer, not a failure. */
  unchanged: boolean;
};

/** Citation ids in a string, in order, duplicates kept. */
function citeIds(text: string): string[] {
  CITE_RE.lastIndex = 0;
  const out: string[] = [];
  let match: RegExpExecArray | null = CITE_RE.exec(text);
  while (match) {
    if (match[1]) out.push(match[1].trim());
    match = CITE_RE.exec(text);
  }
  return out;
}

/**
 * Checks the rewrite against the two rules, and refuses rather than repairing.
 *
 * Repairing is tempting and wrong: a rewrite that lost its citation cannot be patched by putting
 * one back, because the claim may have moved. The student keeps their sentence and is told what
 * happened, which is "flag, don't fix" applied to a feature whose whole job is a rewrite.
 */
export function postProcessCiteRole(
  raw: string,
  original: string,
  citationId: string,
): CiteRolePostProcess {
  // Models like to wrap a single-sentence answer in quotes; that is formatting, not content.
  const sentence = raw
    .trim()
    .replace(/^["'“”]\s*/, '')
    .replace(/\s*["'“”]$/, '')
    .trim();

  if (!sentence) {
    return {
      sentence: original,
      ok: false,
      refusal: 'The rewrite came back empty, so nothing was changed.',
      unchanged: false,
    };
  }

  const before = citeIds(original);
  const after = citeIds(sentence);

  if (!after.includes(citationId)) {
    return {
      sentence: original,
      ok: false,
      refusal:
        'The rewrite dropped the citation, so it was not applied. Your sentence is unchanged.',
      unchanged: false,
    };
  }
  // Every other citation in the sentence has to stay too — the prompt says leave them where they
  // are, and a rewrite that quietly removed one would detach a second claim from its source.
  const lost = before.filter((id) => id !== citationId && !after.includes(id));
  if (lost.length > 0) {
    return {
      sentence: original,
      ok: false,
      refusal: `The rewrite lost ${lost.length} other citation${lost.length === 1 ? '' : 's'} in the sentence, so it was not applied.`,
      unchanged: false,
    };
  }
  if (after.length > before.length) {
    return {
      sentence: original,
      ok: false,
      refusal: 'The rewrite added a citation that was not there, so it was not applied.',
      unchanged: false,
    };
  }

  return {
    sentence,
    ok: true,
    refusal: null,
    unchanged: sentence.trim() === original.trim(),
  };
}

// ---------------------------------------------------------------------------------------------
// Mock (AI_PROVIDER=mock)
// ---------------------------------------------------------------------------------------------

/**
 * Moves the citation from the end of the sentence to the front, or back, using only the words
 * already there. It invents no author and no year — it has none, and nor does the real model:
 * the id is what renders the name.
 */
export const mockCiteRoleResponse = {
  match: (req: { action: string; messages: ReadonlyArray<{ content: string }> }) =>
    req.action === 'COMMAND' && (req.messages.at(-1)?.content ?? '').includes('<target citation='),
  respond: (req: { messages: ReadonlyArray<{ content: string }> }): { text: string } => {
    const text = req.messages.at(-1)?.content ?? '';
    const to = /to="([a-z]+)"/.exec(text)?.[1] ?? 'parenthetical';
    const sentence = (/<sentence>\s*([\s\S]*?)\s*<\/sentence>/.exec(text)?.[1] ?? '').trim();
    const id = /citation="([^"]+)"/.exec(text)?.[1] ?? '';
    const marker = `{{cite:${id}}}`;
    if (!sentence.includes(marker)) return { text: sentence };

    const bare = sentence
      .replace(marker, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (to === 'narrative') {
      // "<claim>." → "<marker> found that <claim>."
      const claim = bare.replace(/\s*\.$/, '');
      const lowered = claim.charAt(0).toLowerCase() + claim.slice(1);
      return { text: `${marker} found that ${lowered}.` };
    }
    // Back the other way: strip a leading "… found that" and put the marker at the end.
    const claim = bare
      .replace(/^\s*(found|report(?:ed)?|show(?:ed)?|argue[ds]?)\s+that\s+/i, '')
      .replace(/\s*\.$/, '')
      .trim();
    const raised = claim.charAt(0).toUpperCase() + claim.slice(1);
    return { text: `${raised} ${marker}.` };
  },
};
