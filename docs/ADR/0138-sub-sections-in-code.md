# ADR-0138 — Sub-sections in code, after A.9 (R5b)

**Status:** accepted · **Date:** 2026-10-09 · **Changes:** the outline's post-processing in
`generate-outline` (worker). A.9 (`packages/ai/prompts/outline.md`) is unchanged; no new model
call, no allowance or cost change.

## Context

Jenni's Smart headings put sub-headings under sections a thesis divides (Research Methodology →
Study design, Data collection, Analytical approach; Adoption barriers → Economic, Institutional,
Technical). Four A.9 candidates tried to make the model write them (ADR-0092 addenda 3 and 4):
h3 and h3b lost, h3c emptied the title-only Literature Review, h3d held the Literature Review but
left one title-only plan of ten with no sub-section. The model is unreliable at sub-sections, and
the title-only path (Start writing now) must keep at least four Literature Review sections.

Three code-side sources were considered:

- **(a) The Methodology blueprint** (`packages/config/src/profiles/blueprints.ts`, ADR-0039). Its
  elements are *sections* of a Methodology chapter, varying by paradigm, which the outline does
  not know. They do not say how to divide one section. Useful only where a whole Methodology is
  a single section.
- **(b) The plan's own titles.** The current prompt's Literature Review and Methodology sections
  very often name their parts: "Financing, incentives and affordability", "Technical and
  infrastructural constraints", "Survey instruments and interview guides".
- **(c) The chapter build's plan** (ADR-0039/0124). Its children come from a later, paid model
  call, after the outline exists; not available when the outline is made.

## Decision

`addSubsections(nodes, template)` (`packages/ai/src/builder/subsections.ts`) runs after
`dropPlaceholderSections` in the worker, so the stored outline, the new chapters' bodies
(`chapterBody`, level-3 headings) and the editor's SectionGuide (already lays H3) all get them.
The eval runner and `scripts/probe-outline-from-title.ts` apply it too, as the worker does.

1. **(b) Split a title into its named parts**, in Literature Review and Methodology chapters only
   (role by `chapterRoleFor`). Parts are joined by "and", "&" or commas; two to four parts of at
   most six words. When the leading parts are single modifier words, the last part's noun is
   shared: "Policy and institutional barriers" → Policy barriers / Institutional barriers.
   Every word of a sub-section title is in its parent's title — nothing is invented.
   Left whole: gap, summary, synthesis, overview sections; a relation ("between", "versus",
   "or"); an "and" after a preposition ("effects of X on Y and Z"); fixed pairs ("research and
   development", "reliability and validity"); a reason rather than a part ("design and
   rationale", "… and justification", "… and plan").
2. **(a) A section titled just "Methodology"/"Methods"**, in any chapter, gets the blueprint's
   own titles for `method.design`, `method.collection`, `method.analysis`.
3. **At most three divided sections per chapter**, those naming the most parts, then the
   earliest. Splitting every "X and Y" gave one Methodology 23 sub-headings.
4. A section the model already divided is left as it is; sections are never removed, merged or
   renamed, so the Literature Review keeps whatever count A.9 gave it (5–7 on title-only plans).
5. A sub-section's scope note is the parent note's sentences that mention it (up to two), else
   empty. Ids are `<parent id>-subN-<slug>`, unique.

## Consequences

- Measured offline on the twenty stored plans of the outline rounds (current prompt; ten
  gap-map, ten title-only): every plan gets sub-sections (6–15 after the cap), none outside the
  Literature Review and Methodology, Literature Review counts unchanged.
- Some splits read flatter than a person would write ("Engagement / Attrition over time",
  "Measurement in mHealth for T2D"). A student edits headings freely; nothing here is text.
- A plan whose titles never name parts gets none (except a "Methodology" section). That is the
  honest limit of a no-model approach.
- Real-model measurement on five new title-only plans was not run in this change (see
  BUILD_LOG); the post-processing is deterministic, so the stored-plan check stands for it until
  then. It was run the same day; see below.

## Real-model check (2026-10-09)

`scripts/probe-outline-from-title.ts` on five new title-only plans (STEM_EMPIRICAL, gpt-5-mini,
the tree as the worker stores it): rooftop solar in rural Karnataka, ML for diabetic retinopathy
in primary care, mobile banking for Kenyan smallholders, nano-silica and HPC durability, teacher
attitudes to inclusive education in Tamil Nadu. ₹3.18 for the five (₹0.55–0.75 a plan, 22–33 s).

| Rule | Result |
|---|---|
| Sub-sections only in Literature Review and Methodology | 5/5 (none elsewhere) |
| At most three divided sections a chapter | 5/5 (LR 3/3/2/2/3, Method 3/3/2/3/3) |
| Literature Review count unchanged (sections never removed) | 5/5 (6, 6, 6, 5, 5 sections) |
| Every plan gets sub-sections | 5/5 (13, 13, 9, 10, 13) |
| No nonsense split | 4/5 before the fix, 5/5 after |

The one wrong split: "Policy and regulatory context for rooftop solar" gave a bare **"Policy"**
and "Regulatory context for rooftop solar", because the shared noun was only passed on when it
was a plural kind-noun (barriers, factors…) and "context" is not one. Fixed in
`subsections.ts`: a small list of setting nouns (context, environment, landscape, framework,
setting) is shared the same way, so it now gives "Policy context for rooftop solar" /
"Regulatory context for rooftop solar". A process noun before any other head is still left
alone ("Sampling and statistical analysis" → Sampling / Statistical analysis, not "Sampling
analysis"). Both are pinned in `packages/ai/test/subsections.spec.ts` (41 pass).

Flat but not wrong, left as they are (a student edits headings freely): "Properties" (from
"Nano-silica materials and properties"), "Rigor considerations", "Technology", "Setting". Every
sub-section of the 58 is words of its parent's title. Scope notes are the parent's sentences;
where the parent has one sentence covering every part, siblings share it.
