# ADR-0052 — Snowballing both ways, and chat answers into the chapter

**Status:** accepted · **Date:** 2026-10-04 · **Builds on:** FR-2.8 (Expand), FR-4.9 (chat),
ADR-0050.

## Context

Two gaps against Jenni and against how a literature review is actually built:

1. **Expand only looked forward**, at the ten most-cited works citing each source, plus OpenAlex's
   related works, all in one list sorted by citations. That favours old famous papers and never
   offers the foundational works the student's own sources rest on (backward snowballing), which
   is how most literature reviews find their core.
2. **A chat answer could not reach the chapter** except by retyping it. Jenni's chat has "add to
   document".

## Decision

- Expand returns three groups of up to 20: **Cited by your sources** (`referenced_works`, ranked by
  how many of the student's sources cite each, then citations), **Recent work citing your sources**
  (the last three years, newest first), and **Related to your citations** (as before).
  Retracted works and the wider work types of ADR-0050 apply.
- Chat answers get **Add to document**: new paragraphs after the cursor's paragraph, citations as
  real nodes with the label chat showed, equations as math nodes, marked ASSIST. Only on the
  student's press — flag, don't fix — and the AI-usage count stays truthful.

## Consequences

- Expand makes up to three more OpenAlex requests per source (40 sources at most), all
  in the polite pool at $0.0001–0.001 each; no model call, nothing metered.
- Chat answers in the chapter count as AI-written text in every AI-usage figure.
