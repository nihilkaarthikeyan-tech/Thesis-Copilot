# ADR-0007 — `CoherenceFlag.fingerprint` and `ignoreReason`

**Status:** accepted (2026-09-07, Phase 3 block 1).

## Context

Appendix D.1.1 defines how a coherence run reconciles its flags with the previous run's:

> delete previous `OPEN` flags whose fingerprint (`type + chapterId + normalised text of the
> flagged range`) is not reproduced; keep `RESOLVED`/`IGNORED` flags and skip re-creating a flag
> whose fingerprint matches an `IGNORED` one.

PRD §8's `CoherenceFlag` has no column for that fingerprint, and it cannot be recomputed later: it
is taken over the flagged text *as it was when the flag was raised*, and by the next run the
student has usually edited it — which is the whole point of running again. D.1.3 also gives Ignore
an optional reason, which has nowhere to live either.

## Decision

Two columns (migration `0009_coherence_flag_fingerprint`): `fingerprint TEXT NOT NULL DEFAULT ''`
and `ignoreReason TEXT`, plus an index on `(documentId, fingerprint)` because the suppression check
runs once per candidate flag.

## Alternatives

- Recompute from `type + chapterId + description`: the description is model-written prose, so the
  same problem phrased differently would evade suppression — an ignored flag would come back.
- A separate `IgnoredFingerprint` table: one row per suppression, a join on every run, and nothing
  gained; the flag row already has to exist for the sidebar's history.

## Consequences

`docs/PRD.md` §8 is unchanged; this is an addition, recorded here per §0.3 rule 3. Existing rows
get `''`, which matches nothing, so the first run after the migration raises its flags fresh — the
correct behaviour for a column that did not exist when they were written.
