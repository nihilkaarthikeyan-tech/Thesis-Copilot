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
  return out.trim();
}
