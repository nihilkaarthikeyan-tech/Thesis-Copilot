# ADR-0040 — Journal matching, grounded and deterministic

**Date:** 2026-10-03
**Status:** Accepted (the owner: "build this one by one", from the Rademics Copilot / PublishMate
technical review)

## Context

Two sibling Rademics products (PublishMate and Rademics Copilot) help a researcher pick a journal
to submit to. Thesis Copilot stops at the thesis; it has no "where could this be published" step.
The owner asked to bring that capability in, taking PublishMate's engineering but keeping our
rules. PublishMate's `journal_matching_engine.py` is the model: a **deterministic, explainable**
scorer — topic-hierarchy alignment, a scope score, article-type compatibility, and an eligibility
gate that disqualifies "orthogonal" journals. It is not machine learning and not an LLM call; it is
weighted signals plus hard gates, which is cheap, reproducible and auditable.

## Decision

Build journal matching as a **pure scoring function** in `packages/retrieval/src/journals/`,
grounded only on data we already fetch or can fetch from OpenAlex. No fabricated metrics.

- **Candidate journals** come from two grounded sources: the venues the thesis's own cited sources
  were published in (we already store `Source.venueOpenalexId`), and an OpenAlex `/sources` search
  on the thesis's field and key terms. (Data-gathering is a later commit; this one is the engine.)
- **Signals**, each explainable and shown to the student:
  - **Scope alignment (0–55).** Overlap of the journal's OpenAlex concepts with the thesis's key
    terms and field, weighted by concept level, mapped to `subfield | field | domain | none`.
  - **Publishes work you cite (0–25).** How many of the thesis's own cited sources this journal
    published. This is the strongest *grounded* fit signal: the journal already carries the
    literature the thesis builds on.
  - **Impact (0–15).** From OpenAlex's 2-year **mean citedness** (`venueCitedness`, ADR-0022),
    bucketed into `high | medium | emerging`. This is **not** a Journal Impact Factor and is never
    presented as one; when OpenAlex has no figure it is `unknown` and scores 0, never guessed.
  - **Access (0–5).** A small nudge for open access, and a filter (not a gate) on APC cost.
- **Eligibility gate.** A journal is `ineligible` (PublishMate's "orthogonal") when its scope
  alignment is `none` *and* it has published none of the thesis's cited sources, or when it is not
  a journal (a repository or conference-only venue). Ineligible journals are shown separately with
  the reason, never silently dropped.
- **No LLM in the ranking.** The scorer is a pure function over typed input; it is unit-tested and
  costs nothing. An optional one-call LLM "why this journal fits your thesis" note may be added
  later behind a cap, but the ranking itself never depends on a model.

## What it is not

- Not a submission service, not an impact-factor database, not a prediction of acceptance. It ranks
  journals by fit and says why, and the student decides.
- No fabricated impact factor, APC or acceptance rate. Every number shown is one OpenAlex reported,
  or it is marked unknown. (PublishMate's own code carries the same rule — "do NOT fabricate".)

## Consequences

- A new metered action is **not** needed for the ranking (it is pure code). If the optional LLM fit
  note ships, it reuses an existing cap.
- Journal data for the catalogue is OpenAlex, which we already depend on; no new vendor.
- This is the first of the integrity-safe features taken from the Rademics Copilot / PublishMate
  review (`docs/PENDING.md` → "From the sibling products"). Blue/green deploy, the humanize engine
  and model-invented results/figures are deliberately excluded.
