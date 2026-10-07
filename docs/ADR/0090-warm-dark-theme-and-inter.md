# 0090 — A warm dark theme with Inter, like Jenni's (light unchanged)

Date: 2026-10-07
Status: accepted (owner, 2026-10-07: chose "Proposed B" for dark mode and "Now" for light, from
`demo/Thesis-Copilot-look-round-1.pdf`)
Changes: ADR-0034 ("one look for the whole product") for the dark theme only.

## Context

The owner: "the dark mode I don't like that much, it looks like AI generated… the typography… can
you copy from Jenni? It looks good." The navy ground with a periwinkle accent read as generated.
Measured on Jenni's editor the same day: Inter everywhere; body 15 px on a 24 px line; headings
30 px and 20 px bold with −0.6 / −0.2 px tracking; a warm near-black ground `#100F0F` and warm
off-white text `#CECDC3` — the open-source Flexoki palette (MIT licence). Round 1 showed our real
editor with three variants; the owner chose B (Jenni's palette and type, our own blue accent so we
are not a Jenni copy) for dark, and to keep light as it is.

## Decision

- **Dark** (`globals.css`, both the system-preference and the explicit `data-theme="dark"`
  blocks): Flexoki's dark neutrals (paper `#100F0F`, panels `#1C1B1A`, lines `#282726`, text
  `#CECDC3`, muted `#878580`), Flexoki's blue `#4385BE` as the accent, its green, yellow and red for
  ok/warn/danger; the logo tile follows. `--font-sans` and `--font-serif` become Inter (with
  Noto Sans Devanagari behind it for the Hindi interface), so every screen and the thesis text use
  Inter in dark.
- **Editor type in dark** (`editor.css`): 15/24 body, 12 px between blocks, h1 30 px bold −0.6 px,
  h2 20 px bold −0.2 px, h3 17 px semibold.
- **Light is unchanged**: cool grey-blue paper, Satoshi for screens, Spectral for the thesis text.
- **High contrast** keeps its own colours (more specific blocks, unchanged).
- Inter is loaded by `next/font` (self-hosted, so the CSP is untouched) and not preloaded, so a
  light page does not download it.
- Jenni's logo, name and purple stay theirs.

## Evidence

Browser, local stack: dark editor — paragraph Inter 15 px / 24 px, h1 30 px, ground
`rgb(16, 15, 15)`; the thesis list and the public home page follow; light editor — Spectral 17 px
on `rgb(245, 247, 250)`, Satoshi for the interface.
