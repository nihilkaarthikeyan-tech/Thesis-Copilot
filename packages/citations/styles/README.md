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
