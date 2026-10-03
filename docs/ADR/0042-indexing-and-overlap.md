# ADR-0042 — Indexing verification and a read-only overlap check

**Status:** accepted · **Date:** 2026-10-03 · **Builds on:** ADR-0040 (journal matching),
PRD §12.3 (no humanise / detector-evasion features, ever).

## Context

The competitor review (PublishMate, Rademics Copilot) surfaced two things students ask for that we
did not have, both of which can be built as integrity aids rather than integrity risks:

1. **Indexing.** "Is this journal actually indexed?" is the question a predatory publisher lies
   about. The journal matcher (ADR-0040) ranked fit but said nothing about indexing.
2. **Similarity.** Rademics ships a "humanize … bypass all AI detectors" feature. That is
   forbidden here. But the honest inverse — a read-only check that shows a student where their draft
   copies a source so they can quote or rewrite it — is a standard, legitimate anti-plagiarism aid.

The owner asked to build the integrity-safe improvements one at a time; this is the third, and the
one that most needed a clear line drawn. Detector evasion is excluded by design.

## Decision

**Indexing verification.** An `IndexingProvider` interface in
`packages/retrieval/src/indexing/provider.ts`, with a grounded default (`OpenAlexIndexing` /
`indexingOf`) that reports only verifiable facts from data the journal match already fetches: DOAJ
membership (OpenAlex `is_in_doaj`) and whether the venue has a registered ISSN. Scopus and Web of
Science are reported `unknown` — never `not-listed` — because their catalogues are licensed; a real
provider can implement the same interface when a key arrives (docs/PENDING.md). The journals screen
shows an "In DOAJ" badge from the verified field.

**Overlap check.** An `overlapReport` function and `SimilarityProvider` interface in
`packages/retrieval/src/similarity/overlap.ts`: plain word-shingling that flags runs of a draft
passage that appear near-verbatim in the text of a source the thesis holds, attributes each run to
its source, and returns a ratio and a verdict. The API exposes it read-only at
`POST /documents/:id/overlap`; the web shows it at `/app/d/:id/originality`, linked from Submit.

Both are pure code: no model, no network beyond what journal matching already does, no metered
unit.

## The §12.3 line

This is the rule that could be violated here, so it is stated explicitly:

- The overlap check **reports copied text and never rewrites it.** It has no "fix", no "paraphrase",
  no "humanize" action, and no concept of a detector to defeat. Its output is a report the student
  reads and acts on themselves. This is the same stance as proofreading (ADR-0026), where code — not
  only the prompt — refuses any correction that swaps in a different word.
- It compares against the thesis's **own cited sources**, to catch accidental plagiarism and
  under-quoted lifts. It is not a general web plagiarism scanner and makes no claim to be one.
- The indexing check **never asserts an absence it cannot verify.** A venue we cannot confirm in
  Scopus is `unknown`, so the feature cannot be read as "this journal is not indexed" and used to
  disparage a venue on no evidence.

## Alternatives considered

- **A model-based similarity or "originality" score.** Rejected: opaque, costs money, invents a
  number, and sits one prompt away from the forbidden feature. Word-shingling is transparent and
  grounded.
- **Inferring Scopus/WoS from citedness or OA status.** Rejected: that is fabricating an indexing
  claim. Unknown is the honest value.
- **Wiring the overlap check inline into the editor now.** Deferred to a nice-to-have: it needs a
  TipTap extension and the read-only page already delivers the capability.
