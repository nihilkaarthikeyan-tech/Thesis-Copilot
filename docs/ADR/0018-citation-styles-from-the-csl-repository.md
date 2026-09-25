# ADR-0018 — ten thousand citation styles, fetched once from the CSL repository

**Date:** 2026-09-24
**Status:** Accepted — footnote styles made selectable by ADR-0029
**Extends:** FR-5.2 (citation styles), which the build met with twenty shipped styles.

## What prompted it

A competitor advertises "10,000+ citation styles"; we offered twenty. The number is not a
marketing flourish — it is the Citation Style Language repository, which every reference manager
draws on, and a student whose supervisor says "use the *Journal of Cleaner Production* style" either
finds it or does not.

## The decision

- **An index of every style is committed** — `packages/citations/styles/catalog.json.gz`, built by
  `scripts/build-style-index.mjs` from the CSL repository at one pinned commit
  (`8947960dc3c5133a873d77342c77c67300a2bc18`, 2026-09-23). 10,863 styles, 233 KB. Search runs
  against it, so searching never touches the network.
- **A style's XML is fetched when a student chooses it**, from the same pinned commit, checked to be
  CSL, and **stored in our own object storage** (`csl-styles/<commit>/<id>.csl`). Every later render
  — the editor, the chapter export, the whole-thesis export — reads that copy.
- **The twenty shipped styles stay shipped**, with their golden tests. Hundreds of journal styles
  are "dependents" that borrow one of them (Elsevier Harvard, APA, Vancouver…), and need nothing
  fetched at all.
- **Footnote styles (720) are listed but cannot be chosen.** The editor has no footnotes; a note
  style rendered inline prints a full reference mid-sentence. Selectable: 10,143.

## Why this shape

The network is needed at exactly one moment — choosing — where a failure is visible and harmless:
the switch is refused, the thesis keeps its style, and the student is told to try again. It is never
needed at export time, which is when a failure would matter. A GitHub outage the night before a
deadline costs nothing.

A pinned commit, not a branch, so the rules a thesis was written in cannot change underneath it.

Rejected:

- **Vendoring every style.** 2,862 independent styles are 58 MB of XML; a student uses one.
- **Fetching at render time.** Puts GitHub's availability on the export path.
- **A single compressed bundle of all XML.** 6.5 MB in git per refresh, and decompressing all of it
  to read one style.

## Consequences

- The switch route now makes an outbound request the first time a given style is used anywhere.
- Updating the catalogue means re-running the script against a newer commit and committing the new
  index; styles already stored under the old commit keep rendering from their stored copies.
- CSL styles are CC BY-SA 3.0. The picker credits the project; nothing is modified.
- Footnote support is its own project (footnotes in the editor, in both exporters); `docs/ROADMAP.md`
  carries it.
