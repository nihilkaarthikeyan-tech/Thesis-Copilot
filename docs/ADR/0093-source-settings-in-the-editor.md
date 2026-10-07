# 0093 — Source settings inside the editor

Date: 2026-10-07
Status: accepted (Jenni build plan Round 2, R6)

## Context

Jenni's citation settings (web search, library search, select sources, years, impact/cited-by,
preprints) can be opened from the editor at any time. Ours (ADR-0087) were asked once, when the
thesis was made, and stored on `Document.meta.sourcePrefs`; nothing could change them afterwards.

## Decision

- `PUT /documents/:id/source-prefs` (owner only, free) validates with the same `sourcePrefsSchema`
  and writes only that key (`setMetaKey`, ADR-0092), so the proposal conversation and the plan's
  run mark are never touched.
- The editor's Sources tab opens with a "Source settings" line (what is chosen) and Change, which
  shows the same fields as the start — one component, `SourcePrefsFields`, used by both, so the
  two can never offer different choices.
- The settings govern papers found from now on and whether the student's own papers are cited;
  nothing already in the library is removed. The find-sources job reads them each time it runs.
- **Jenni's "select sources" is our pins** (ADR-0085), per chapter and per section, directly below
  the settings and named there. A thesis-wide selection was built first and taken out: a second
  control that narrows the same thing would leave the student guessing which one wins.

## Evidence

`apps/api/test/source-prefs-edit.spec.ts` (stored, `meta` otherwise untouched; a later change
replaces the earlier; both searches off → 400; another student's thesis → 404). Browser: three
quick changes (last five years, preprints off, PubMed) saved together and survived a reload — the
first version kept only the last of them, because each change was made from the value before the
previous one landed; changes are now applied to the latest value. The start screen, refactored to
the shared fields, still folds to the right summary line.
