# ADR-0003 — `Chapter.version`, `wordCounts`, `snapshotAt`

**Status:** Proposed, implemented in Phase 1 week 1. **Date:** 2026-09-04.

## Problem
Appendix B.7 (autosave) requires `PUT /chapters/:id { content, baseVersion }` with the server
incrementing `version` and answering 409 when `baseVersion` is stale, and a snapshot "when ≥ 10
minutes have passed since the last snapshot". Appendix B.4 says word counts by provenance are
"stored on `Chapter` as a JSON breakdown". PRD §8's `Chapter` model has none of these columns.

## Decision
Migration `0003_chapter_version` adds `version Int @default(1)`, `wordCounts Json?` and
`snapshotAt DateTime?`. Every §8 column is unchanged. Additive and reversible.

## Alternatives
Use `updatedAt` as the concurrency token — fragile across clock skew and identical-millisecond
saves. Rejected.

## Owner action
Acknowledge, and add the columns to PRD §8 in the next revision. Logged as item 13 in
`docs/CONSISTENCY_REVIEW.md`.
