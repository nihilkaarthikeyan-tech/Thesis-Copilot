# ADR-0045 — Citations and equations that hold: one key per node, one converter for AI text

**Status:** accepted · **Date:** 2026-10-03 · **Builds on:** B.3/B.5 (citation nodes and labels),
FR-5.2 (rendering), FR-5.6 (citation role, ADR-0010), Appendix B.1 (KaTeX nodes), ADR-0029
(note styles).

## Context

The owner reported complaints from students: citations "not properly working", and formulas in
AI-written text "not understandable". A read of the whole citation and equation pipeline
(2026-10-03) found the causes, none of them visible to the unit tests because each lived between
two components that were each correct on their own:

1. **Every AI path used the request-local passage id as the citation node's key.** Retrieval
   numbers passages `S1#c1, S1#c2…` per request. The Assist accept, the end-of-sentence cite
   suggestion, draft blocks and the chapter build all created the node with `key: 'S1#c1'`. The
   label map the renderer returns is keyed by node key across the whole document, so the second
   suggestion that cited *its* first passage overwrote the first node's label: two different
   sources shown with one label, numeric styles numbered wrong, "Ibid." wrong, and the
   `Citation` row (which carries the page number) kept only for the first of the twins.
2. **The command toolbar deleted citations and equations.** `textBetween` rendered an atom as
   nothing, so the selection the model saw had no citations, `droppedCitations` was always empty,
   and Apply replaced the range with a plain string — every citation and equation in the
   selection was gone, and any `{{cite:…}}` the model wrote for *expand* arrived as literal text.
3. **Labels were refreshed only when some node had none**, so a suggestion's seeded
   "(Kumar, 2021)" never became the "[7]" an IEEE thesis wanted, and deleting a citation never
   renumbered the rest. The `@` picker went further: it rendered each candidate as its own
   cluster, so in a numeric style it seeded "[1]", "[2]" — the candidate's place in the list.
4. **The renderer ignored the citation role.** FR-5.6's narrative rewrite set `role: 'narrative'`
   for a year; the label was still "(Kumar, 2021)". Prefix, suffix and (after a role rewrite) the
   locator were lost too.
5. **The export changed the thesis's style for good** (it wrote the template style to the
   document and never restored it), and it counted citations inside pending draft blocks that it
   then stripped from the file, so the bibliography listed sources the thesis did not cite.
6. **A cited source could not be deleted**: the foreign key was RESTRICT, so the "nodes go red,
   never deleted" rule of B.5 could not happen; the request failed instead.
7. **Chat history lost its citations** on reload, and sent stale passage ids back to the model.
8. **Equations the model wrote stayed as dollar text.** No prompt said how to write an equation;
   the converters made text nodes only, so `$\sigma = E\varepsilon$` reached the editor, the
   `.docx` and the PDF as those characters. The AI could not see the student's own equations
   either (`blockText` skipped the math atoms), and the LaTeX export escaped Unicode subscripts
   into a failed compile. The abbreviation check flagged `CO₂` as the undefined abbreviation "CO".
   An equation could not be edited once inserted, and bad LaTeX was red text with no message.

## Decision

**A citation node's key is its own, always.** `newCitationKey()` at creation, in every path. The
prompt id is used only to resolve the source and chunk and to carry the label across. Chapters
written before this carry duplicates; the editor re-keys every twin after the first once, when
the chapter opens (`dedupeCitationKeys`), and the next save gives each its own row. `@tc/citations`
exports the same repair as a pure function (`rekeyDuplicateCitations`) for a one-off script.

**One converter for AI text** (`aiTextToNodes` in `@tc/ui`, mirrored by `draftToProseMirror` in
`@tc/ai` for the worker): `{{cite:KEY}}` becomes a citation node — reused with its attributes when
the key is already in the document, fresh when the server resolved it for this request, dropped
otherwise (§10.6) — and `$…$` / `$$…$$` become `mathInline` / `mathBlock`. The Assist accept, the
command apply, draft blocks and the chapter build all go through it. Citation and math atoms
declare `leafText`, so `textBetween` (the command toolbar's selection) and the prompt context show
them as `{{cite:KEY}}` and `$latex$` — the same forms the model is told to write.

**The preamble gains rule 7**: equations in LaTeX between `$…$` or `$$…$$`, chemical formulas
named in prose with Unicode sub/superscripts. This is a *format* rule, added outside the ADR-0038
evaluation harness because it does not change what the model says, only how an equation is
written down; it should still be in the next evaluation round (`docs/PENDING.md`).

**Labels are re-fetched after every save**, and the picker in a numeric style shows the short
reference and seeds nothing — the real number arrives with the first render of the saved node.
The renderer honours `role` (citeproc's composite mode: "Kumar (2021)"), prefix, suffix and the
node's locator; the walker carries the node attributes and counts every leaf as one position.
The export renders in the template style through an option, never by writing the document, and
leaves pending drafts out. `Citation.source` is `ON DELETE CASCADE` (migration 0029). Chat turns
keep their citations, and history goes to the model with each marker replaced by its label.

**Equations can be edited** by clicking them; the field validates with KaTeX and says what is
wrong before anything is inserted. Admin's read-only view and the co-author editor typeset them.
The LaTeX export writes Unicode sub/superscripts as `\textsubscript{}` / `\textsuperscript{}`.
The checks normalise superscript digits and charges, so `CO₂` and `SO₄²⁻` are formulas, not
abbreviations.

## Consequences

- Existing theses: labels become right on the first open of each chapter (re-key, save,
  re-render). Nothing is changed server-side without the student's editor in the loop, so no
  version conflicts. A thesis never opened again keeps its duplicate keys; the export of such a
  thesis renders the first twin's label for all — the same as before, not worse.
- `GET /documents/:id/citations` gains `missingSourceIds`; `citations/pick` gains `numeric`;
  `POST /commands/run` gains `citations`. All additive.
- One more label fetch per save (one citeproc pass over the document). Measured at well under
  100 ms for a 60-citation thesis; acceptable against labels that were wrong.
- Rule 7 means prompts now ask for LaTeX. The mock provider and the evaluation harness are
  unchanged; `pnpm ai:shakedown` should get a case that writes an equation.

## Not done

- A one-off production script to re-key duplicates in theses nobody reopens. The editor repair
  covers every thesis a student still works on; the script is a few lines on
  `rekeyDuplicateCitations` if the owner wants it run (`docs/PENDING.md`).
- Citeproc locale from the document language. The styles' own locale (`en-US` by default) is
  used; a Tamil or Hindi thesis cites in English forms today.
- Matrices and `\ce{}` in the `.docx`: still the LaTeX source in a monospace run.
