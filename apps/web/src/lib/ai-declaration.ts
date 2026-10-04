/**
 * The "AI declaration" the "/" menu inserts (2026-10-04, JENNI-FIX-LIST item 24).
 *
 * Our AI-usage report (`packages/export/src/ai-usage.ts`) lived only in the export; universities
 * increasingly ask for a statement *in* the thesis. This is a starting text, not a model call: it
 * goes in as ordinary text the student is expected to edit, and it claims only what is true of
 * the product — suggestions drawn from the student's own library, nothing entering the text
 * without the student's action, a word-level record of what came from accepted suggestions
 * (the provenance marks the usage report counts). What the student did with it, they must say.
 */

import type { JSONContent } from '@tiptap/react';

export const AI_DECLARATION_HEADING = 'Declaration of AI use';

export const AI_DECLARATION_PARAGRAPHS = [
  'In preparing this thesis I used Thesis Copilot, a writing tool with AI features. I used it to find and organise sources, to suggest wording for sentences and passages, to draft text from the papers in my own library, to rewrite passages on request, and to check spelling, grammar and citations. Its suggestions were drawn from the papers I had added to my library, and each citation it suggested pointed to a passage in one of those papers.',
  'No suggestion entered this thesis without my action: I read each one and accepted, edited or rejected it. Thesis Copilot keeps a record of which words came from suggestions I accepted, and I can provide that record on request. The research, the arguments and the conclusions are my own, and I take full responsibility for the content of this thesis, including the accuracy of every citation.',
] as const;

export const AI_DECLARATION_NOTE =
  "[Edit this statement so it describes only what you actually used, and check it against your university's policy on AI use. Delete this note before you submit.]";

/** The heading, the statement and the note to delete, as editor content. */
export function aiDeclarationContent(): JSONContent[] {
  return [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: AI_DECLARATION_HEADING }],
    },
    ...AI_DECLARATION_PARAGRAPHS.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
    {
      type: 'paragraph',
      content: [{ type: 'text', text: AI_DECLARATION_NOTE, marks: [{ type: 'italic' }] }],
    },
  ];
}
