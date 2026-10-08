/**
 * Text colours and highlights a student can put on their words (Jenni build plan R28, ADR-0119).
 *
 * A fixed palette, stored by name, never as a CSS colour. The editor draws each name in the
 * theme's own shade (a red that reads on paper is unreadable on the dark ground), and every export
 * prints the same name in one colour chosen for white paper. A pasted web page's colours never
 * come in: only these names parse.
 */

export const TEXT_COLORS = ['grey', 'red', 'orange', 'green', 'blue', 'purple'] as const;
export type TextColor = (typeof TEXT_COLORS)[number];

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/** Each text colour on white paper, as hex without `#`: at least 4.5:1 against white. */
export const TEXT_COLOR_PRINT: Readonly<Record<TextColor, string>> = {
  grey: '535862',
  red: 'B42318',
  orange: 'B54708',
  green: '067647',
  blue: '175CD3',
  purple: '6941C6',
};

/**
 * Each highlight on paper. `word` is Word's own highlight of that hue — what the Text Highlight
 * Colour button applies and removes in Word, and what LibreOffice prints in the PDF. `hex` is the
 * lighter tint the HTML and LaTeX exports use, the same as the editor's light theme.
 */
export const HIGHLIGHT_PRINT: Readonly<
  Record<HighlightColor, { word: 'yellow' | 'green' | 'cyan' | 'magenta'; hex: string }>
> = {
  yellow: { word: 'yellow', hex: 'FEF08A' },
  green: { word: 'green', hex: 'BBF7D0' },
  blue: { word: 'cyan', hex: 'BFDBFE' },
  pink: { word: 'magenta', hex: 'FBCFE8' },
};

export const isTextColor = (value: unknown): value is TextColor =>
  typeof value === 'string' && (TEXT_COLORS as readonly string[]).includes(value);

export const isHighlightColor = (value: unknown): value is HighlightColor =>
  typeof value === 'string' && (HIGHLIGHT_COLORS as readonly string[]).includes(value);

type MarkLike = { type?: string; attrs?: Record<string, unknown> | null };

/** The text colour and highlight on a text node's marks, by name; anything unknown is ignored. */
export function colorsOf(marks: readonly MarkLike[] | null | undefined): {
  color: TextColor | null;
  highlight: HighlightColor | null;
} {
  let color: TextColor | null = null;
  let highlight: HighlightColor | null = null;
  for (const mark of marks ?? []) {
    const value = mark.attrs?.color;
    if (mark.type === 'textColor' && isTextColor(value)) color = value;
    // A highlight with no colour (a plain <mark> pasted in) is the classic yellow.
    if (mark.type === 'highlight') highlight = isHighlightColor(value) ? value : 'yellow';
  }
  return { color, highlight };
}
