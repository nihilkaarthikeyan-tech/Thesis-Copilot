# ADR-0006 - `User.settings` JSON column

**Status:** accepted (2026-09-05, Phase 2 week 9).

## Context

FR-4.6 requires automatic-suggest to be "opt-in per user", and FR-4.9's chat filters (year range,
minimum citations, exclude preprints) are a preference a student sets once and expects to persist.
PRD section 8's `User` model has neither, and no other table is per-user-and-not-per-document.

## Decision

One nullable `settings JSONB` column on `User` (migration `0008_user_settings`), read and written
only by `GET`/`PUT /settings`. Shape today: `{ automaticSuggest?: boolean, chatFilters?: {...} }`.
Feature flags stay in `FeatureFlag` - they are platform-wide switches, not user preferences; the
`automaticSuggest` flag gates the feature, this column records the student's choice within it.

## Alternatives

- A column per preference: a migration for every new preference, for values nothing queries on.
- `Document.meta`: wrong scope - the setting follows the student, not one thesis.

## Consequences

Nothing queries inside the JSON, so no index is needed. If a preference ever needs filtering or
analytics, it graduates to its own column.
