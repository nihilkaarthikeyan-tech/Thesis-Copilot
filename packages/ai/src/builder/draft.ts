/**
 * Draft mode — PRD A.2 (`draft.md`), FR-4.4, §10.7.3, PHASES 4.2.
 *
 *   FR-4.4: the result "is inserted **as a clearly marked draft block** … that the student must
 *   'Accept draft' or 'Discard' before it becomes normal content."
 *   AC: "every citation mark in a draft resolves to a `Source` in the library; a draft with zero
 *   available sources refuses and explains."
 *
 * The refusal is the important half. Draft mode writes hundreds of words at once, so an ungrounded
 * draft is the single most damaging thing this product could produce: pages of fluent prose citing
 * nothing, in a document that will be examined. A.2 answers that with `[[NEEDS SOURCE: …]]`, and
 * the parsing below turns those markers into something the editor shows in amber rather than
 * silently dropping.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { loadPrompt } from '../prompts.js';
import { renderTemplate } from '../template.js';
import type { LlmRequest, Tier } from '../types.js';
import type { PromptPassage } from './assist.js';
import { displayEquationOf, tokenizeNotation } from './notation.js';
import { nameTheSource } from './own-study.js';
import { collapseSameSourceRuns, stripUnknownCitations } from './postprocess.js';
import { filterSentences } from './quality.js';

/**
 * The quality filters (`quality.ts`) over a draft, one paragraph at a time. A paragraph's
 * "before" is the paragraph ahead of it, so a "However," that opens a paragraph after a real
 * finding stays; headings pass through; a paragraph that loses every sentence is removed.
 */
export function filterDraftParagraphs(markdown: string, existingText: string): string {
  const kept: string[] = [];
  let previous = '';
  for (const block of markdown.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (/^###\s/.test(trimmed)) {
      kept.push(trimmed);
      previous = '';
      continue;
    }
    const { text } = filterSentences({
      text: trimmed,
      before: previous,
      existing: `${existingText}\n${kept.join('\n')}`,
    });
    if (text.trim().length === 0) continue;
    kept.push(text.trim());
    previous = text.trim();
  }
  return kept.join('\n\n').trim();
}

/** A.2's parameters. */
export const DRAFT = {
  maxTokens: 1_200,
  temperature: 0.5,
  /** §10.4 top_k for a draft. */
  topK: 12,
  /** FR-4.4: "target length from the scope note, default 400–600 words". */
  defaultTargetWords: 500,
  /** A.2: "acceptable range: 80% to 130% of target". */
  minRatio: 0.8,
  maxRatio: 1.3,
  /** A.2 post-processing: "if word count < 60% of target, mark the draft SHORT". */
  shortRatio: 0.6,
  /** A.2: "Use each passage at most three times." */
  maxUsesPerPassage: 3,
} as const;

export type DraftSection = {
  outlineNodeId: string;
  title: string;
  scopeNote: string;
  /** Subheadings from the outline; A.2 forbids the model inventing any others. */
  children: ReadonlyArray<{ title: string; scopeNote: string }>;
};

export type DraftBuildInput = {
  memoryBlock: string;
  section: DraftSection;
  passages: readonly PromptPassage[];
  targetWords?: number;
  /** The student's own prior writing on this topic (Path B), if any. */
  paperExcerpt?: string | null;
  tier: Tier;
  userId: string;
  documentId: string;
  signal?: AbortSignal;
};

/** §10.7.3 `DraftResult`. */
export const draftResultSchema = z.object({
  markdown: z.string(),
  citations: z.array(
    z.object({
      key: z.string(),
      sourceId: z.string(),
      chunkId: z.string().optional(),
      /** The label the citation node renders, e.g. "(Kumar 2021)". */
      rendered: z.string().optional(),
    }),
  ),
  needsSource: z.array(z.string()),
  words: z.number().int().min(0),
});

export type DraftResult = z.infer<typeof draftResultSchema>;

export function draftUserMessage(input: DraftBuildInput): string {
  const template = loadPrompt('draft').user;
  if (!template) throw new Error('draft.md has no user message block');

  return renderTemplate(template, {
    outlineNodeId: input.section.outlineNodeId,
    section: {
      title: input.section.title,
      scopeNote: input.section.scopeNote,
      children: input.section.children,
    },
    passages: input.passages.map((passage) => ({
      id: passage.id,
      shortRef: passage.shortRef,
      page: passage.page ?? '',
      // ADR-0078: a paper's "this study" about itself, named, so it never reaches the thesis.
      text: nameTheSource(passage.text, passage.shortRef),
    })),
    paperExcerpt: input.paperExcerpt ?? '',
  });
}

export function buildDraftRequest(input: DraftBuildInput): LlmRequest {
  const preamble = loadPrompt('_preamble').system.trim();
  const task = renderTemplate(loadPrompt('draft').system, {
    target_words: input.targetWords ?? DRAFT.defaultTargetWords,
  }).trim();

  return {
    tier: input.tier,
    // `target_words` sits in the task block, so a document drafted at two different lengths has
    // two cached prefixes. That is correct: the instruction really did change.
    system: { cached: [preamble, input.memoryBlock.trim(), task].join('\n\n') },
    messages: [{ role: 'user', content: draftUserMessage(input) }],
    maxTokens: DRAFT.maxTokens,
    temperature: DRAFT.temperature,
    action: 'DRAFT',
    userId: input.userId,
    documentId: input.documentId,
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// A.2 post-processing
// ---------------------------------------------------------------------------------------------

/** A.2: `[[NEEDS SOURCE: <what is missing, in ten words or fewer>]]`, on its own line. */
export const NEEDS_SOURCE_RE = /^[ \t]*\[\[NEEDS SOURCE:\s*([^\]]*)\]\][ \t]*$/gim;

/**
 * The same marker written inside a sentence, which A.2 forbids and gpt-5-mini did anyway on the
 * first real chapter build (2026-10-01): "(for example [[NEEDS SOURCE: full forms …]])". Taken out
 * of the prose and kept as a note, so it neither reaches the student as text nor confuses the
 * checks (L3 read "NEEDS" and "SOURCE" as undefined abbreviations and the fixer "defined" them).
 */
export const INLINE_NEEDS_SOURCE_RE = /\s*\[\[NEEDS SOURCE:\s*([^\]]*)\]\]/gi;

/**
 * The request's own wrapper, echoed back. The user message wraps the section in
 * `<section …>…</section>`; on the first real build every section came back with those tags in
 * the Markdown. Nothing the model writes is allowed to be a tag of this request.
 */
const ECHOED_TAGS_RE =
  /^[ \t]*<\/?(?:section|passages?|subheadings|scope_note|student_prior_writing)\b[^>\n]*>[ \t]*$/gim;

/**
 * Cleans what the model returned before anything reads it: echoed request tags gone, every
 * heading at A.2's one level (`###`), inline needs-source markers pulled out, headings with no
 * paragraph under them dropped (the model wrote "## Copper" and moved on when it had no source).
 */
export function normaliseDraftMarkdown(markdown: string): { text: string; inlineNotes: string[] } {
  const inlineNotes: string[] = [];
  let text = markdown.replace(ECHOED_TAGS_RE, '');
  text = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, '### ');
  // Inline markers: keep the note, drop the marker; a marker alone on a line stays for NEEDS_SOURCE_RE.
  text = text.replace(
    /^(?![ \t]*\[\[NEEDS SOURCE)(.*?)\[\[NEEDS SOURCE:\s*([^\]]*)\]\](.*)$/gim,
    (_m, before: string, note: string, after: string) => {
      const trimmed = note.trim();
      if (trimmed && !inlineNotes.includes(trimmed)) inlineNotes.push(trimmed);
      return `${before}${after}`
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([.,;:)])/g, '$1')
        .trimEnd();
    },
  );
  // Drop a heading that has nothing but another heading, a marker or the end after it.
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  const kept: string[] = [];
  blocks.forEach((block, i) => {
    if (/^###\s/.test(block)) {
      const next = blocks.slice(i + 1).find((b) => !/^\[\[NEEDS SOURCE/i.test(b));
      if (!next || /^###\s/.test(next)) return;
    }
    kept.push(block);
  });
  return { text: kept.join('\n\n'), inlineNotes };
}

export type DraftPostProcess = {
  result: DraftResult;
  /** Ids the model invented, each one a HALLUCINATED_CITE (§10.6). */
  hallucinated: string[];
  /** A.2: under 60% of target. The editor says the sources did not cover enough. */
  short: boolean;
  /** Passages cited more than A.2's limit of three. Recorded, not rewritten. */
  overused: string[];
};

/** Words, ignoring citation markers and needs-source notes, which are not the student's prose. */
export function countDraftWords(markdown: string): number {
  const prose = markdown
    .replace(NEEDS_SOURCE_RE, ' ')
    .replace(/\{\{cite:[^}]+\}\}/g, ' ')
    .replace(/^###\s+/gm, ' ');
  return prose.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/**
 * Applies A.2's post-processing: whitelist the citations, pull out the needs-source markers, and
 * judge the length. The markdown is returned with the markers removed, because the editor renders
 * them as amber notes from `needsSource` rather than as literal text.
 */
export function postProcessDraft(
  markdown: string,
  passages: readonly PromptPassage[],
  targetWords: number,
  /** The rest of the chapter as text, for the duplicate check (2026-09-30). */
  existingText = '',
): DraftPostProcess {
  const passageIds = passages.map((passage) => passage.id);

  const normalised = normaliseDraftMarkdown(markdown);
  markdown = normalised.text;
  const needsSource: string[] = [...normalised.inlineNotes];
  for (const match of markdown.matchAll(NEEDS_SOURCE_RE)) {
    const note = (match[1] ?? '').trim();
    if (note.length > 0 && !needsSource.includes(note)) needsSource.push(note);
  }

  const unknownStripped = stripUnknownCitations(markdown, passageIds);
  // One paper's passages side by side print as one label repeated (2026-10-04).
  const collapsedText = collapseSameSourceRuns(unknownStripped.text);
  const stripped = {
    ...unknownStripped,
    text: collapsedText,
    cited: unknownStripped.cited.filter((id) => collapsedText.includes(`{{cite:${id}}}`)),
  };

  // Count uses before removing the markers, so the limit is measured on what the model wrote.
  const uses = new Map<string, number>();
  for (const match of stripped.text.matchAll(/\{\{cite:([^}]+)\}\}/g)) {
    const id = (match[1] ?? '').trim();
    uses.set(id, (uses.get(id) ?? 0) + 1);
  }
  const overused = [...uses.entries()]
    .filter(([, count]) => count > DRAFT.maxUsesPerPassage)
    .map(([id]) => id);

  const cleaned = filterDraftParagraphs(
    stripped.text
      .replace(NEEDS_SOURCE_RE, '')
      // A removed marker leaves a blank line where a paragraph break already was.
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    existingText,
  );

  const words = countDraftWords(cleaned);

  return {
    result: {
      markdown: cleaned,
      // Prompt ids only. `sourceId` is filled by the caller, which alone holds the map back to the
      // real ids for this request.
      citations: stripped.cited.map((key) => ({ key, sourceId: '' })),
      needsSource,
      words,
    },
    hallucinated: stripped.hallucinated,
    short: words < targetWords * DRAFT.shortRatio,
    overused,
  };
}

// ---------------------------------------------------------------------------------------------
// Markdown → ProseMirror (A.2: "convert Markdown to ProseMirror nodes with DRAFT provenance")
// ---------------------------------------------------------------------------------------------

type PmNode = Record<string, unknown>;

/** The editor's own key shape (`newCitationKey` in `@tc/ui`): a node key, never a passage id. */
function freshCitationKey(): string {
  return `c_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

/**
 * A.2 constrains the model to `###` headings and blank-line-separated paragraphs, so this handles
 * exactly that and nothing else. A general Markdown parser would accept syntax the prompt forbids
 * and quietly produce nodes the schema (Appendix B.2) does not allow.
 *
 * `{{cite:KEY}}` becomes a citation node with a **fresh key of its own** — the prompt id
 * (`S1#c1`) names a passage in this one request, and before ADR-0045 reusing it as the node key
 * made every draft's first citation collide with the last draft's in the label map. Each node
 * reports the prompt key it came from through `onCitation`, so the caller can seed its label.
 * An equation the model wrote (`$…$`, or `$$…$$` on a line of its own) becomes a math node
 * rather than dollar signs in the prose. Everything else becomes text carrying `DRAFT`
 * provenance, which is what makes the word counts in B.4 and the AI-usage export truthful.
 */
export function draftToProseMirror(
  markdown: string,
  actionId: string,
  resolve: (key: string) => { sourceId: string; chunkId: string | null } | null,
  onCitation?: (nodeKey: string, promptKey: string) => void,
): PmNode[] {
  const provenance = { type: 'provenance', attrs: { kind: 'DRAFT', actionId } };
  const blocks: PmNode[] = [];

  for (const raw of markdown.split(/\n{2,}/)) {
    const block = raw.trim();
    if (block.length === 0) continue;

    const heading = /^###\s+(.*)$/.exec(block);
    if (heading) {
      blocks.push({
        type: 'heading',
        // A.2's "###" is a subheading inside a chapter whose title is the h1.
        attrs: { level: 3 },
        content: [{ type: 'text', text: (heading[1] ?? '').trim(), marks: [provenance] }],
      });
      continue;
    }

    const display = displayEquationOf(block);
    if (display) {
      blocks.push({ type: 'mathBlock', attrs: { latex: display } });
      continue;
    }

    const content: PmNode[] = [];
    const pushText = (text: string) => {
      if (text.length === 0) return;
      const previous = content[content.length - 1];
      if (previous?.type === 'text') previous.text = `${String(previous.text)}${text}`;
      else content.push({ type: 'text', text, marks: [provenance] });
    };
    for (const token of tokenizeNotation(block)) {
      if (token.type === 'text') {
        pushText(token.text);
        continue;
      }
      if (token.type === 'math') {
        if (token.latex.length > 0)
          content.push({ type: 'mathInline', attrs: { latex: token.latex } });
        continue;
      }
      const real = resolve(token.key);
      if (!real) continue; // §10.6: an unresolvable key leaves no dangling marker (same as A.1).
      const key = freshCitationKey();
      content.push({
        type: 'citation',
        attrs: {
          key,
          sourceId: real.sourceId,
          chunkId: real.chunkId,
          role: 'parenthetical',
          locator: null,
          prefix: null,
          suffix: null,
        },
      });
      onCitation?.(key, token.key);
    }
    if (content.length > 0) blocks.push({ type: 'paragraph', content });
  }

  return blocks;
}

/**
 * FR-4.4's refusal: a draft with no usable sources is not attempted. Returning the reason rather
 * than a thin draft is the whole point — the student can pin sources and try again, which is the
 * action that actually fixes it.
 */
export const NO_SOURCES_MESSAGE =
  'Pin at least one source with readable text, or write this section in Assist mode.';

export function canDraft(passages: readonly PromptPassage[]): boolean {
  return passages.length > 0;
}

/**
 * A draft-shaped reply for the mock provider, built from the passages in its own prompt.
 *
 * Without this the mock answers a DRAFT stream with its generic placeholder, and the whole A.2
 * path — headings, citations, needs-source notes, the SHORT check, the ProseMirror conversion —
 * is never exercised before a provider key exists. It invents no facts: every sentence restates
 * the passage it cites, and the subheadings come from the prompt's own `<subheadings>` block.
 */
export function mockDraftFor(req: LlmRequest): string {
  const user = req.messages.find((message) => message.role === 'user')?.content ?? '';

  const passages = [...user.matchAll(/<passage id="([^"]+)"[^>]*>([\s\S]*?)<\/passage>/g)].map(
    (match) => ({ id: match[1] as string, text: (match[2] ?? '').trim() }),
  );
  const subheadings = [...user.matchAll(/^- ([^:\n]+):/gm)].map((match) =>
    (match[1] as string).trim(),
  );

  if (passages.length === 0) return '';

  const blocks: string[] = [];
  const headings = subheadings.length > 0 ? subheadings : [null];

  headings.forEach((heading, index) => {
    if (heading) blocks.push(`### ${heading}`);
    const passage = passages[index % passages.length];
    if (!passage) return;
    // Two sentences per section: one restating the passage, one connective. Padded so the result
    // clears A.2's 60% SHORT threshold at the default target and the happy path is testable.
    blocks.push(
      `${passage.text} {{cite:${passage.id}}}. ` +
        `This bears directly on what this section sets out to establish, and the evidence is ` +
        `reported consistently across the sources pinned for this chapter, which together give ` +
        `the section its factual basis and shape the argument that follows in the next part.`,
    );
  });

  // A.2's marker, so the needs-source path is exercised too.
  blocks.push('[[NEEDS SOURCE: figures for the remaining districts]]');

  return blocks.join('\n\n');
}
