# ADR-0034: One look for the whole product

Status: accepted 2026-09-28, at the owner's approval of a before/after PDF of twelve screens.
Supersedes the palette, typeface and radii of `docs/DESIGN.md` (Paper & Ink); its principles stand.

## Context

The landing, sign-in and sign-up pages were redesigned on 2026-09-28 (v0.1.12) with their own
styles scoped under `.mk`: Satoshi, a cobalt accent, 10–14px corners and a navy dark mode. The
product behind them kept Paper & Ink: Source Sans with Spectral headings, a slate accent, 3px
corners and a greenish dark mode. A student crossed from one design to the other at the moment of
signing in, and the owner called it out as a major issue.

## Decision

The product's tokens in `apps/web/src/app/globals.css` become the public pages' palette, and
`components/marketing/marketing.css` aliases them instead of keeping its own copy, so there is one
source of truth and the two halves cannot drift again.

- Satoshi (self-hosted, loaded in `layout.tsx`) for every screen and every heading. Source Sans is
  no longer loaded.
- Spectral stays for the student's own writing only: the editor's page, a guide's reading view,
  a version-history preview, a viva question quoting the thesis.
- The cobalt accent `#2743c4` (dark `#8ea2ff`), cool greys, navy dark ground `#0c111b`.
- Radii 6 / 10 / 14px. Buttons in bold.
- The editor's last hard-coded colours (citation, removed citation, draft block, needs-source
  note, code block, table header, popover, review highlights, provenance) now read the tokens.
  In dark mode the citation had been dark blue on near-black, effectively invisible.

## Consequences

Every screen changes appearance at once; no route, behaviour or test selector changes. The two
Paper & Ink rules hold: nothing competes with the student's text, and `--ghost` is reserved for
unaccepted AI output.
