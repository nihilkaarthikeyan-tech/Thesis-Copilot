# ADR-0047 — Research-type writing guidance, and a simulation paradigm

**Status:** accepted · **Date:** 2026-10-03 · **Builds on:** ADR-0039 (discipline profiles,
blueprints, paradigms).

## Context

From the Rademics Copilot comparison: its methodology writer branches by research type —
engineering, qualitative, law (statutory corpus, case law), humanities (hermeneutic validity),
simulation. Our chapter build already branched the *shape* of a Methodology by paradigm (ADR-0039's
blueprint elements), but nothing told the writer what counts as evidence or which validity
vocabulary an examiner expects in that kind of research, and ordinary Draft mode passed the writer
no discipline at all. There was no simulation paradigm: a CFD or FEM thesis had to pretend to be
"computational" (datasets, baselines) or "experimental" (materials, equipment).

## Decision

- **`PARADIGM_GUIDANCE`** in `packages/config/src/profiles/guidance.ts`: per paradigm, what counts
  as evidence and how it is cited, the validity vocabulary, register, and what reads as a mistake.
  Law: statutes by section and year, cases by citation and court, holding versus obiter, binding
  versus persuasive. Humanities: interpretive (hermeneutic) validity, the critic's reading kept
  apart from the student's. Qualitative: trustworthiness, never statistical generalisation.
  Simulation: verification, validation, mesh independence. And the rest.
- **`writingGuidance(discipline, paradigm, sectionTitle)`** — a method-type section gets all of
  it; any other section the evidence line and the mistakes. Every block ends "Write only what the
  passages support; this guidance is about form, not content." It travels in the section's scope
  note: the chapter build adds it in `scopeNoteFor` (not to summaries), Draft mode adds it from
  the saved build profile or, failing that, the discipline suggested from the thesis's field. No
  prompt file changes (§0.3 rule 6).
- **A `simulation` paradigm** with five Method elements: model and governing equations; domain,
  boundary and initial conditions; numerical method and independence study; verification and
  validation; simulation plan. It shares implementation environment and analysis with the others.
  Offered by default to engineering and the pure sciences.

## Consequences

- The scope note grows by about 80–120 tokens per section; against a draft request of several
  thousand input tokens this is inside the noise of `docs/COSTING.md` and changes no cap.
- A thesis with no field and no saved profile gets no guidance rather than a guessed discipline.
- The guidance is content the owner may want to word differently; it is data, so changing it is
  editing one file, and it should be in the next prompt-evaluation round (`docs/PENDING.md`).
