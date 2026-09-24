# CSL styles

Independent CSL 1.0.2 style files, used by `packages/citations` to render citations and
bibliographies (PRD FR-5.2, §7.2).

Every file except the two placeholders comes verbatim from the Citation Style Language project
(https://github.com/citation-style-language/styles), which publishes them under
**CC BY-SA 3.0**. Each file carries its own `<info>` block with its author and licence; nothing
here has been edited.

`in-university-numeric.csl` and `in-university-author-date.csl` are **placeholders**: copies of
IEEE and APA 7th with a new id and title, so the two `IN_UNIVERSITY_*` entries in the style
registry resolve to something real until a university names its actual requirements
(`docs/PENDING.md`). Replace the file, keep the id, and every document on that style re-renders.

Vancouver is the copy bundled with `@citation-js/plugin-csl` (the CSL repository has no
`vancouver.csl` at its root).

To add a style: drop the `.csl` file here, add a row to `src/styles.ts`, and it is available
everywhere — editor labels, the citations panel and the export all read the same registry.


## `catalog.json.gz` — every other style

An index of all 10,863 styles in the [CSL styles repository](https://github.com/citation-style-language/styles)
at commit `8947960dc3c5133a873d77342c77c67300a2bc18` (2026-09-23), built by
`../scripts/build-style-index.mjs`. It holds each style's title, format and — for a journal's
dependent style — the independent parent it borrows; not the XML. The API fetches a style's XML
from that commit when a student chooses it and keeps its own copy (ADR-0018).

Like the files above, every style it names is © its authors, CC BY-SA 3.0.
