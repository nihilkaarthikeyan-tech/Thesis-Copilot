# 0120 — Paper themes and a font style for the thesis text

Date: 2026-10-08
Status: accepted (Jenni build plan Round 2, R33; inventory §2, §10, §13.9)
Builds on: ADR-0034 (one look), ADR-0090 (warm dark with Inter), the high-contrast switch
(2026-10-04).

## Context

Jenni's Preferences offer System, Light, Dark, Paper Light, Paper Dark and two high-contrast
themes; its Document Defaults offer a default font style, Default or Serif. Ours had light, dark,
system and a high-contrast switch, and the thesis text's typeface followed the theme: Spectral in
light, Inter in dark (ADR-0090). A student who wanted serif text at night, or sans-serif by day,
had no way to say so.

## Decision

- **Two more themes, per browser like the others**: Paper light (cream paper, brown-black ink) and
  Paper dark (deep brown, cream ink), a warm printed page by day and by night. Our Dark is already
  Jenni's warm palette (ADR-0090), so the paper themes are deliberately different from it rather
  than a copy of it. Both keep Satoshi for the screens and Spectral for the thesis text, as light
  does. They are `data-theme="paper-light"` / `"paper-dark"` blocks in `globals.css` defining every
  colour token light has (a test reads the file and checks it, and the contrast: ink 7:1 or more,
  muted, accent and the accent's label 4.5:1 or more, AI text visibly lighter than the student's).
- **The theme stays a choice of this browser** (`localStorage`, applied before first paint by
  `ThemeScript`), for the reason `theme.tsx` gives: a laptop at night and a library machine in the
  morning each keep their own. Settings gains a Theme list with all five; the header button still
  cycles light, dark, system, and shows a paper theme when one is chosen.
- **System dark now means "no theme stamped"**: the media-query blocks were `:not([data-theme=
  "light"])`, which would have painted a paper theme dark on a dark device. They are
  `:not([data-theme])` (globals, editor, marketing). Light and dark behave exactly as before.
- **High contrast wins over paper**: with the switch on, paper light is high-contrast light and
  paper dark is high-contrast dark. Paper dark takes the dark text colours and highlights (R28),
  the dark logo tile and the marketing pages' dark values.
- **Font style is the account's** (`User.settings.fontStyle`, `PUT /settings`), as Jenni's is a
  document default: Default (the theme's own — Spectral in light and paper, Inter in dark),
  Serif (Spectral everywhere) or Sans-serif (Inter everywhere). Jenni offers two; ours has three
  because our light default is already a serif, so a "Serif" choice alone would do nothing there.
  Only the thesis text changes (`data-font-style` on `<html>`, read by `editor.css`); the screens
  keep their typeface. It is cached in `localStorage` so a page opens in it before the settings
  arrive, and the editor and Settings refresh the cache from the account on load. Serif in dark
  keeps the manuscript's size, as Spectral at Inter's 15 px reads small.
- **In export**: the chapter `.docx` (the student's working copy) is written in Times New Roman for
  Serif and Arial for Sans-serif, document-wide; Default writes no font, so Word uses its own. The
  web page export is set in a sans-serif for Sans-serif. **The thesis `.docx`, PDF and LaTeX keep
  the template's font**: the university decides it, and the PAGE_SETUP compliance check reads it.
  The one export dialog (R27, ADR-0121) is where a student overrides it on purpose.

No model, no allowance, no migration (`User.settings` is JSON).

## Evidence

`apps/web/test/themes.spec.ts` (4): both paper blocks define every `--color-*` token of light;
the contrast above; paper dark has the dark word colours and joins high contrast; no
`:not([data-theme="light"])` is left.

`packages/export/test/font-style.spec.ts` (5): Serif and Sans-serif set the chapter `.docx`'s
document default font, Default sets none; an unknown setting reads as Default; the web page takes
a sans-serif only for Sans-serif; the thesis `.docx` keeps the template's font.

`apps/api/test/font-style.spec.ts` (2, real HTTP and storage): the setting is absent, then kept,
leaves the other settings alone, writes the chapter `.docx` in it, and refuses an unknown style.
