# Thesis fixtures

Real chapters the check suite is measured against. The agent never writes these (PRD §0.3 rule 2).

## `aa7050-chapter1.docx` — the specification's engineering gold test (spec §13.2)

The original Chapter 1 of the AA7050 hybrid composite thesis that Ranjith's evaluation was made
on. Put the `.docx` here under exactly this name and `pnpm --filter @tc/worker test` runs
`test/gold-aa7050.spec.ts`, which prints, for every item in the spec's list, whether the
deterministic checks caught it and asserts 90% recall on the code-checkable part:

- S1: AA7050, hybrid rationale, Ti interface, SSCC not introduced before the objectives
- D-ENG2: K₂Br; D-ENG3: graphite hardness, Ti₃Al hardness, Al₂O₃ density
- T2: ENG-TRIB-001, ENG-EDM-001/002, ENG-SCC-001, ENG-COMP-001/002, ENG-PROC-001/002,
  ENG-WEAR-001/002, ENG-CORR-002
- L3: AMC and FRM undefined; L4: "Electric" vs "Electrical" discharge machining; L9: proper-ties

The examiner's part of the list (S4 summary fidelity, T1 contradiction, T3 definition
consistency, the semantic pitfalls) needs the real model: run a chapter build on the chapter and
read the QA report.

Until the file exists the suite reports `BLOCKED` and skips, like the other fixture suites.

## `coherence/` — Appendix C.6

A fixture thesis with planted inconsistencies for the coherence engine (PRD Appendix C.6). Not
written yet; `docs/PENDING.md` has the item.
