/**
 * The typeface the student reads and writes their thesis in (Jenni build plan R33, ADR-0120):
 * Jenni's "default font style" document default, kept on the account (`User.settings.fontStyle`).
 *
 *   - `default` — the theme's own: the manuscript serif (Spectral) in light and the paper themes,
 *     Inter in dark (ADR-0090).
 *   - `serif`   — Spectral in every theme.
 *   - `sans`    — Inter in every theme.
 *
 * Only the thesis text changes; the screens keep their own typeface.
 */

export const FONT_STYLES = ['default', 'serif', 'sans'] as const;
export type FontStyle = (typeof FONT_STYLES)[number];

export const isFontStyle = (value: unknown): value is FontStyle =>
  typeof value === 'string' && (FONT_STYLES as readonly string[]).includes(value);

/** A stored value, or the default when there is none (or it is not one of ours). */
export const readFontStyle = (value: unknown): FontStyle =>
  isFontStyle(value) ? value : 'default';

/**
 * The font a working `.docx` (the chapter export) is written in for each style: one every copy of
 * Word and LibreOffice has. `default` writes none, so Word uses its own. The thesis itself is set
 * in the template's font, which the university decides and the compliance check reads.
 */
export const FONT_STYLE_DOCX: Readonly<Record<FontStyle, string | null>> = {
  default: null,
  serif: 'Times New Roman',
  sans: 'Arial',
};
