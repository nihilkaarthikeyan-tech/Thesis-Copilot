# ADR-0039 — Chapter build: the planned, checked chapter, delivered as drafts the student accepts

**Date:** 2026-10-01
**Status:** Accepted (the owner, 2026-10-01: "regarding the decisions just do what is best")
**Adds:** a metered action (`CHAPTER_BUILD`), two tables (`ChapterBuild`, `Pitfall`), discipline
and university profiles as data (`packages/config/src/profiles/`), a validator suite
(`packages/ai/src/checks/`), three prompts not from Appendix A (`entities.md`, `examiner.md`,
`fix_flagged.md`), a worker job (`chapter-build`), and the QA report.

## What prompted it

Ranjith's "Developer Specification v1.0" (30 September 2026) asks for an agent that writes whole
thesis chapters for every department: collect the thesis details and extract its key terms
(entities); plan the chapter so every term is introduced before the objectives use it; gather
verified sources; write one section at a time from those sources only; join the sections in
code; run about thirty checks, an "examiner" review and a fix loop; deliver the chapter with a QA
report. Everything that differs between departments and universities lives in profiles, not
code, and a "pitfall bank" holds known technical errors.

Most of its "Phase 0" already shipped in v0.1.20–v0.1.22. Two things in it conflicted with rules
the product holds today, and this ADR settles both.

## Decision 1 — the product stance stays "flag, don't fix"

The spec says "an agent that writes thesis chapters". The PRD says no AI output enters the
thesis without an explicit student action (§1.3, §12.3), and that is part of the academic
integrity position the product is sold on.

**Resolution: the chapter build produces the whole chapter as pending draft blocks, one per
section, with the QA report beside them.** Nothing becomes thesis text until the student presses
Accept on each block, exactly as a single Draft-mode section does today (FR-4.4, Appendix B.6).
Every word carries `DRAFT` provenance, so the AI-usage export and the word counts stay truthful.
The student sees the QA report before accepting anything, and the report names every open issue
and every place a source is missing. This gives the spec's pipeline in full and changes nothing
about who decides what the thesis says.

A consequence the spec's own data model already allows (`ValidationIssue.status:
accepted_by_user`): an issue the student disagrees with is theirs to dismiss, with the reason
kept.

## Decision 2 — it fits under ₹100 by design, not by price

Running a strong model as writer and examiner on every section, with three fix loops, would cost
several times what a fully active student costs today (₹25.60). The spec left the model choice
open (§14). The design here:

- **Deterministic checks are free and run first.** Structure (entity coverage, required sections,
  generic-background share), evidence (uncited paragraphs, uncited figures, recency, twelve-word
  overlap with a source, numbers in a Results chapter that trace to no data), language
  (duplicates, spacing, abbreviations at first use, terminology, dangling connectives,
  meta-narration, extraction artefacts) and correctness (pitfall bank by pattern, chemical
  formulae, equation balance, SI units, property plausibility) are code in
  `packages/ai/src/checks/`. They are the spec's S1–S3, E1–E2, E7–E9, L1–L4, L7–L9, T2 and the
  D-ENG checks.
- **The strong model writes each section once** through the existing draft path (A.2 and its
  post-processing, unchanged), and **reviews each section once** as the examiner (`examiner.md`,
  strong tier, structured output). The examiner is also where the pitfall bank's *semantic*
  entries and the spec's T1/T3 (contradiction, definition consistency) are judged: the bank goes
  into the request as data.
- **One fix loop, not three,** and only for sections with at least one blocking issue
  (`fix_flagged.md`: fix the listed sentences, keep everything else identical). After it the
  deterministic checks run again; an examiner issue counts as fixed when its sentence is gone,
  and the examiner is not called a second time. Whatever is still open goes in the report. The spec's rule "never hide a
  failure" is kept; its third loop is not, because on measured token counts each loop is worth
  about a third of the writing cost and the second and third loops mostly re-touch the same
  sentences.
- **Entity extraction runs on the fast tier** (`entities.md`), once per build.
- **One `CHAPTER_BUILD` unit is one chapter,** capped at 14 sections (the Introduction blueprint
  has eleven fixed elements plus up to three key-term groups), priced in `ACTION_PROFILES` for the
  worst case: 14 drafts + 14 examiner passes + 7 fixes. At the production models that is ₹8.69 a
  build. Caps: **3 a month on STUDENT and INSTITUTION_SEAT, 1 on FREE_TRIAL.** The fully active
  student goes from ₹25.60 to **₹51.68**, still inside the ceiling; `pnpm ai:verify` and `packages/config/test/cost-model.spec.ts` check it. Every
  provider call the build makes is logged under `CHAPTER_BUILD`, so the runtime stop at ₹100 of
  real spend sees it too.
- The build **refunds its unit** if no section could be written (no sources anywhere for the
  chapter), and refuses before taking a unit when the chapter has no outline node or the
  document has a live co-author (the build writes the chapter row directly; ADR-0028's Yjs room
  would overwrite it).

## What "profiles" are here

- **Discipline profiles** (`packages/config/src/profiles/disciplines.ts`): the spec's nine
  families as typed data — entity types, default paradigms, default citation style, the
  generic-background cap, minimum citations per factual paragraph, recency window, the special
  checks each enables, and a terminology sheet. Adding a department is adding a row.
- **Chapter blueprints** (`profiles/blueprints.ts`): the spec's §5 elements per chapter role, with
  the paradigm variants for Methodology, and which are required.
- **University profiles** (`profiles/universities.ts`): citation and formatting rules the
  existing `InstitutionTemplate` spec does not carry (in-text form, spelling variant, `et al.`
  threshold, chapter summary required). The one shipped is `example_university_v1`, marked
  unconfirmed — the spec itself says every value must be checked against the university's manual
  before release (`docs/PENDING.md`).
- **The pitfall bank** (`profiles/pitfalls.ts` seeds the `Pitfall` table): the spec's fifteen
  engineering entries, each with the wrong pattern, the correct statement and the source, status
  `APPROVED` because they come from Ranjith's evaluation; new entries arrive as `PENDING` from a
  student's or supervisor's report and go live when an admin approves them
  (Admin → Pitfall bank). Hit counts are kept.

The student chooses a discipline, a paradigm and a university on the build screen; the
discipline is suggested from the document's field. The choice is kept on
`Document.meta.chapterProfile` and used by every later build.

## What the lines it holds

- **Grounding (§10.6).** Sections are written by the same draft path, so a citation is a passage
  in the request or it is stripped and counted. The examiner may only quote sentences of the
  section; a quotation that is not in the section word for word is dropped (the viva's
  `verbatimQuote` test). The fixer's output goes through the same whitelist as the draft.
- **No invented data.** In a Results chapter the build writes no numbers that are not in the
  passages or the student's uploaded data; a number with no source is flagged `E9` and named in
  the report, and the drafting prompt for a Results section is asked for structure with
  placeholders rather than figures. The examiner and the checks never fabricate a correction:
  the pitfall bank's correct statement is the only text a check ever offers.
- **No humanise, no detector evasion (§12.3).** The fix step is bounded to the flagged sentences
  and re-checked; it is not a rewrite.

## Closed the same day (second round, after the owner asked for "the other things")

- **Stage 1 intake and stage 2 confirmation.** The build is now two steps. `POST …/chapter-build`
  plans: one fast-tier extraction, the clarifying questions written in code (an abbreviation with
  no expansion; a one-word term the profile could not type; no objectives at all — at most five),
  a `PLANNED` row and no unit. The student edits the terms and answers on the screen;
  `POST …/:buildId/start` takes the unit. The worker uses the confirmed terms as they are and puts
  the answers into the scope notes of the sections that introduce the term.
- **Stage 4 external evidence.** Before drafting, each section that needs evidence is retrieved;
  where the library has nothing, ADR-0037's search is started (under its flag, allowance and
  cooldown), and the build waits — up to four minutes, or 75 seconds if nothing is added — for the
  found papers to be resolved and indexed, then drafts with them.
- **The QA report as a file** (spec §11): `…/report.pdf` through Gotenberg's Chromium route,
  `…/report.html` always.
- **L6 in the build.** The proofreader runs over every written section on the fast tier, and only
  what `correctionSize` allows is applied (ADR-0026's line); counted as corrected. Priced into
  the profile (≈₹0.35 a build); one build is now ₹9.04, the fully active student ₹52.72.
- **E6, S5, D-MED2, D-MGT2, D-LAW1 in code.** E6 counts the invented citation markers the
  whitelist removed; S5 traces each objective in a review, results, discussion or conclusion
  chapter; D-MED2 flags doses no formulary allows; D-MGT2 wants reliability and validity evidence
  in a management methodology; D-LAW1 wants a year or reporter on every case and a comparative
  framing when two jurisdictions appear. The examiner still judges the rest of each.
- **Language settings** (`profiles/languages.ts`): the thesis's language is chosen on the build
  screen and kept on the profile; the Latin-only checks (L3, spelling pairs) stand down for a
  non-Latin script; every prompt already writes in the language. Terminology sheets in Tamil and
  Hindi are for the departments to fill.
- **The benchmark's machine half** (`pnpm ai:benchmark`, `fixtures/benchmark/README.md`): the
  check suite over matched `ours.md` / `jenni.md` pairs, a table per case and totals. The blind
  expert rating stays a person's.
- **The gold-test runner** (`apps/worker/test/gold-aa7050.spec.ts`): BLOCKED until
  `fixtures/thesis/aa7050-chapter1.docx` exists; then asserts 90% recall of the spec's
  code-checkable list and prints what was missed.

## Not done, and where it is recorded

- The AA7050 gold test (spec §13.2) needs the original chapter, which we do not have; the runner
  is written and skips until the file exists (`fixtures/thesis/README.md`).
- Expert approval of the pitfall bank, university manuals, the monthly benchmark against Jenni,
  native-speaker review for Tamil: `docs/PENDING.md`.
- The three new prompts have not yet been through the ADR-0038 evaluation, because it needs real
  built chapters to judge; `pnpm ai:shakedown` exercises their structured paths against the
  real models, and the first real builds are the evaluation's material.
- Similarity against the web (E8 with an external API) and NLI claim support are not built; the
  in-house twelve-word overlap and the existing citation-support check (ADR-0023) stand in.
