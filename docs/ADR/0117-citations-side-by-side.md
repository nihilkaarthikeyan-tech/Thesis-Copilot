# 0117 — Citations side by side are one citation

Date: 2026-10-08
Status: accepted (Jenni build plan, found while building: R40)

## Context

The R1 browser run (2026-10-07) read "(Gadekar et al., 2026)(Raja et al., 2026)": two citation
nodes with nothing between them, drawn as two brackets with no space, in the editor and in the
`.docx`. The AI paths write such pairs on purpose — `collapseSameSourceRuns` (`@tc/ai`) joins a
run of markers into `{{cite:A}}{{cite:B}}` and drops the same paper cited twice — but every
renderer took one node at a time: citeproc was given one citation per node (`render.ts`), and
each exporter printed one label per node.

## Decision

- **A run is a run of nodes.** `citationNodesIn` gives every citation a `run`: citations side by
  side in one paragraph with nothing at all between them share it. A space, a word or a
  footnote ends it. The id starts with the chapter id, so runs never join across chapters.
  Consecutive notes in a note style are one footnote, so a run is one note in `noteOrdinal` and
  `notesIn`.
- **citeproc renders a run as one citation with several cites.** `renderCitations` hands each
  run to `rebuildProcessorState` as one cluster, so the style decides the order, the delimiter
  and the collapsing — nothing is string-joined. Measured on the shipped styles: APA "(Anand et
  al., 2018; Kumar & Raman, 2021)" (sorted), Chicago author-date in the order written, IEEE
  "[2], [3]" (IEEE's own form, not "[2, 3]"), Vancouver "(1–3)", a note style one footnote. The
  result gains `clusters: [{ keys, label }]`; `labels` keeps, for each clustered node, the label
  it would have alone (a second citeproc pass, only when there is a cluster), for the moment
  between an edit that parts a cluster and the next render. Without a run, or with no
  neighbours, the output is exactly what it was.
- **What never joins a bracket:** a citation whose source has left the library (it is drawn red
  on its own, B.5, and citeproc cannot render it), and, in an in-text style, a narrative
  citation — "Kumar (2021)" is part of the sentence.
- **The faults Jenni's citations have, and how this avoids them:**
  - *Doubled citations.* The same paper twice in one bracket is one cite with both pages:
    "(Kumar & Raman, 2021, pp. 3, 7)", "(1)". citeproc alone printed "(Kumar & Raman, 2021,
    2021)" and "(2,2)". A prefix or suffix the student typed keeps the two apart.
  - *A citation moved to another claim.* Only nodes with nothing between them join, so a label
    never travels past a word. The end-of-sentence suggestion (`CiteSuggestions`) used to insert
    at the caret — in the next sentence, if the student had typed on while it loaded. It now
    inserts at the end of the sentence it was asked about, mapped through every edit since
    (`citationPointForSentence`, `@tc/ui`).
  - *A citation after the full stop.* That same insert went after the full stop the student had
    just typed: "…the main barrier.(Rao, 2021)". In an in-text style it now goes before the
    sentence's closing punctuation, with a space, or right beside a citation already there (so
    the two form one bracket). A note style's footnote mark still goes after the full stop.
- **The editor.** The server's clusters go to the editor with the labels
  (`setCitationStyle(…, clusters)`). A plugin decorates each cluster whose nodes are still side
  by side in that order; the first node draws the label, the others draw nothing
  (`citation--member`, `aria-hidden`, no footnote number). An edit that parts them — a word
  typed between, one deleted — drops the decoration in the same transaction, and each node shows
  its own label until the next render (after the next save). The nodes stay separate in the
  document: the cluster is a rendering, never a merged node.
  - **Click** selects the whole bracket, so Delete or typing acts on what the student sees.
  - **Hover** opens one card with a tab per source, in the order written; each tab is the
    single-citation card (passage, Open PDF, Read beside, Open in reader), and **Remove this
    source from the citation** deletes that one node. A read-only chapter has no Remove.
  - A hidden node selected from the keyboard outlines the bracket.
  - The bracket wraps with the line (`white-space: normal`, the tint cloned on both lines); a
    single citation still does not break.
  - **Copy** reads a cluster copied whole as its one label; the HTML still carries every node.
  - **The `@` picker** opens right after a citation, and "(Kumar, 2021) @rao" takes the lone
    space with it, so the new citation joins the bracket.
- **Every export prints a cluster once, at its first node** (`printCitation`, `@tc/export`),
  trusting it only where the nodes really are side by side:
  - `.docx`/PDF, plain: the label. Linked (ADR-0055): one link, to the first source's entry —
    a cluster has one label. Word citations: one `CITATION` field with every source, `\m <tag>`
    adding each (ECMA-376 Part 1 §17.16.5.8), each `\p` after its own tag ("other switches
    affect the previously defined source", MS-OI29500 §2.1.464). A source without a tag means no
    field rather than a field that would drop it on refresh. A note style: one footnote.
  - HTML: one citation, linked to its first source.
  - LaTeX: `\parencite{a,b}`, or `\parencites[3]{a}{b}` when one has a page; `\footcite{a,b}` in
    a note style. biblatex then formats the bracket.

No new prompt, no new allowance, no migration.

## Evidence

- `packages/citations/test/clusters.spec.ts` (12): the walker's runs and note counting; APA,
  IEEE, Vancouver and Chicago author-date clusters (citeproc's output, pasted); the same paper
  twice; narrative and missing sources kept out; a note-style cluster as one note, the next
  note not "Ibid.".
- `packages/export/test/clusters.spec.ts` (9): what a node prints; the chapter and thesis
  `.docx` read "(Kumar, 2021, p. 52; Rao, 2019)." once; linked; the `\m` field; one footnote;
  HTML; LaTeX.
- `packages/ui/test/citation-cluster.spec.ts` (13) and `cite-point.spec.ts` (7): the drawing,
  parting and rejoining on undo, a removed source, a note style, click and keyboard selection,
  the card's tabs, Read beside and Remove, read-only, copy; where a suggested citation goes.
- `apps/web/test/cite-mention.spec.ts` (3): the picker opens after a citation.
- `apps/web/e2e/citation-clusters.spec.ts`, written, **not yet run**: the R1 paragraph in the
  page and the chapter `.docx`, APA then IEEE, the card, Remove, and a 390 px phone.

## Not verified

- Word itself: a "Word citations" file with a multi-source field has not been opened in
  Microsoft Word (no Word on the build machine, as for ADR-0055).
- The browser: the main session checks the page after the merge (the e2e spec above).
- A real note style (Chicago notes) cluster is covered by a test style with the same structure;
  the real one is fetched from the CSL repository and is not reachable from a unit test.
