/**
 * A chat answer as plain text for the clipboard (coverage map: Jenni's chat has Copy).
 *
 * The answer arrives as model text with `{{cite:KEY}}` markers and `$…$` / `$$…$$` maths. A
 * student pasting it into an email or a notes app wants what they read on screen: each citation as
 * its label — "(Kumar et al., 2021)" — and each equation as its LaTeX, kept in its delimiters so it
 * still typesets when pasted into a LaTeX document. A marker with no matching citation is dropped,
 * exactly as the panel drops it; the copy never shows a key the student never saw.
 */

import { tokenizeAiText } from '@tc/ui';

export type CopyCitation = { key: string; label: string };

export function answerPlainText(text: string, citations: readonly CopyCitation[]): string {
  const labels = new Map(citations.map((c) => [c.key, c.label]));
  let out = '';
  // Set when a marker was dropped, so "claim {{cite:gone}}." does not copy as "claim .".
  let dropped = false;
  for (const token of tokenizeAiText(text)) {
    if (token.type === 'text') {
      out =
        dropped && /^[.,;:!?)]/.test(token.text) ? out.trimEnd() + token.text : out + token.text;
      dropped = false;
      continue;
    }
    dropped = false;
    if (token.type === 'cite') {
      const label = labels.get(token.key);
      if (!label) {
        dropped = true;
        continue;
      }
      // On screen a margin sets the label apart from its word; in the copy, a space does.
      out += out.length === 0 || /\s$/.test(out) ? label : ` ${label}`;
    } else {
      out += token.display ? `$$${token.latex}$$` : `$${token.latex}$`;
    }
  }
  // ADR-0074: a heading reads as its words; "### " is markup the student never saw.
  return out.replace(/^#{1,4}\s+/gm, '').trim();
}

/**
 * How every scripted reply that is not an answer begins: A.4's own two (`NOT_ENOUGH_PREFIX`,
 * `WRITING_REDIRECT_PREFIX` in `@tc/ai`), the server's refusals before the model
 * (`OFF_TOPIC_REPLY`, `FILTERED_OUT_REPLY`, `NAMED_EMPTY_REPLY`, the collection's two in
 * `chat-threads.ts`, the empty-document one) and the search's (`BEYOND_EMPTY_REPLY`,
 * `BEYOND_NOT_ENOUGH_REPLY`, `DEEP_EMPTY_REPLY`). Read from the text as well as the outcome
 * because a turn stored before the outcome was kept with it has only its text.
 */
const REFUSAL_PREFIXES = [
  'Your library does not contain enough on this.',
  'Use Assist or Draft mode in the editor for writing',
  'This chat only answers questions about the sources in your library.',
  'This chat answers only from the papers in the collection',
  'The papers in the collection “',
  'Your filters left nothing to answer from.',
  'The papers you named have no readable text yet',
  'There is nothing written in this thesis yet',
  'The search found no papers with an abstract to read on this',
  'The abstracts the search found do not answer this.',
  'Neither your library nor a search of the literature had anything on this.',
] as const;

/**
 * QA 2026-10-08: a refusal is not thesis text. "Add to document" under one put "Your library does
 * not contain enough on this…" into the chapter; Copy may stay. An answer with no outcome (a stored
 * one) or `answered` is an answer unless its text is one of the scripted replies.
 */
export function isRefusalAnswer(turn: { outcome?: string | undefined; text: string }): boolean {
  if (turn.outcome !== undefined && turn.outcome !== 'answered') return true;
  const text = turn.text.trimStart();
  return REFUSAL_PREFIXES.some((prefix) => text.startsWith(prefix));
}
