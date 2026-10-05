# 0085 — Source pins per section

Date: 2026-10-05
Status: accepted (agent, under ADR-0059; the partial list, round two)
Follows: row 10 of `docs/research/coverage-map.md`; PRD §10.4 (pins as a retrieval filter);
ADR-0078 (the heading under the cursor as the section).

## Context

Jenni lets a student configure the context per heading: which sources a section draws on, or
none. Ours pinned sources per chapter. A literature review chapter with a section on finance and
a section on trust wanted different papers under each, and the only tool was to re-pin the
chapter every time the cursor moved.

## Decision

- **A pin has a scope**: `ChapterSourcePin.section`, `''` for the whole chapter (every existing
  row) or the heading key of one section of it (`headingKey`, the same normalisation Assist uses
  to find a heading's scope note, so "2.1 Financial Constraints" and "Financial constraints" are
  one section). Migration 0040 widens the primary key.
- **A section's own pins win; otherwise the chapter's apply** (`pinsInScope`, `@tc/retrieval`).
  Retrieval takes `section`, and the two places that know the heading pass it: Assist (the
  heading under the cursor, which it already sends for the scope note) and the section draft
  (its own title). Chat, citation suggestions and section commands keep the chapter's pins: they
  have no heading.
- **The Sources tab sets either.** Under a heading the panel offers "This chapter / This
  section: …"; the checkboxes act on the chosen scope, and the sentence above them says which
  applies ("Under this heading, suggestions draw only on its 2 pinned sources; the chapter's pins
  do not apply here"). `GET /chapters/:id/pins?section=` returns both; `PUT` with `section`
  replaces only that section's.
- **No per-section "web off" switch.** The literature search setting (ADR-0060, "Search beyond
  my library") is one switch for the student; a section that should draw on nothing but its own
  pins has them.

## Tests

`packages/retrieval/test/section-pins.spec.ts` (the precedence; the rows asked for; the heading
key), `apps/api/test/section-pins-api.spec.ts` (kept apart, read together, cleared apart, a
foreign source refused).
