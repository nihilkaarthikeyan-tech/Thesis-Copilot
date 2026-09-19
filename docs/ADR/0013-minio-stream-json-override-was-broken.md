# ADR-0013 — the `stream-json` audit fix broke MinIO outright; scoped the override instead

**Date:** 2026-09-19
**Status:** Accepted
**Supersedes:** the blanket `"stream-json": ">=3.5.0"` override recorded in the B4.3 dependency
audit (`docs/BUILD_LOG.md`, 2026-09-07) and `docs/PENDING.md`'s "Dependency advisories" section.

## What the B4.3 audit did

`pnpm audit` flagged `stream-json < 3.5.0` — moderate, "O(depth²) filters on nested input" —
transitive under `minio@8.0.7`. The fix applied was a blanket `pnpm.overrides` entry forcing
`stream-json` to `>=3.5.0` workspace-wide, alongside four other advisories fixed the same way.

**Nobody ran the app against a real MinIO after applying it.** Every test before today's deploy
went through the mock storage or never exercised a code path that imports `minio`'s ESM build at
all. This is the third time in this project that an unverified change to something the mock hides
has broken production the first time it met something real — the Anthropic adapter's message
shape, sixteen of nineteen OpenAI structured calls, and now this.

## What actually happened

`minio@8.0.7` declares `"stream-json": "^1.8.0"` in its own `package.json` and its compiled ESM
build (`dist/esm/notification.mjs`) imports `stream-json/jsonl/Parser.js` — a path that exists in
stream-json's 1.x layout. The blanket override forced pnpm to resolve minio's own dependency to
`3.6.0`, a rewrite that restructured the package's exports. The import path minio's compiled code
asks for does not exist there.

The result was not a runtime warning or a degraded feature — the API and worker containers
**crashed on module load**, before any request could be served, every single time. First observed
2026-09-19 during the first real production deploy: both `api` replicas and both `worker` replicas
crash-looped, and `deploy.sh`'s health check correctly refused for 150 seconds and failed the
release.

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'.../minio@8.0.7/node_modules/stream-json/src/jsonl/Parser.js'
imported from '.../minio@8.0.7/node_modules/minio/dist/esm/notification.mjs'
```

## Why there is no version that satisfies both

Checked against the npm registry directly (§0.3 rule 4 — never guess a version): stream-json's 1.x
line stops at `1.9.1`. The algorithmic-complexity fix landed only in the 3.x rewrite; it was never
backported to 1.x. There is no single version of `stream-json` that is both new enough to carry the
fix and old enough for minio's compiled code to import successfully.

## Decision

**Scope the override to minio's own dependency path, pinned to the newest working 1.x release,
rather than forcing a version workspace-wide.**

```json
"pnpm": {
  "overrides": {
    "minio>stream-json": "1.9.1"
  }
}
```

`minio>stream-json` overrides `stream-json` only where it is resolved as a dependency of `minio`;
it does not touch `stream-json` anywhere else in the tree. Checked first: nothing else in this
workspace depends on `stream-json` at all — `minio` is its only consumer — so this is not a
narrower fix standing in for a broader one; it is the whole fix.

`1.9.1` rather than minio's own requested `^1.8.0` because it is the latest 1.x release, and taking
the newest version inside the range still satisfiable is the same instinct that produced the
original (broken) fix, aimed at a version that actually loads.

## Is this leaving a known vulnerability in place?

Yes, formally: `pnpm audit` will flag `stream-json@1.9.1` as moderate again. Recorded here rather
than hidden, because that is the entire point of writing this ADR instead of quietly reverting.

What makes it acceptable rather than merely convenient: the flagged issue is algorithmic complexity
in parsing deeply nested JSON, and `minio`'s use of `stream-json` is for parsing responses **from
our own MinIO server** (S3 API responses, bucket notifications we do not even subscribe to) — not
for parsing anything a student uploads or types. `apps/api/src/common/storage.service.ts` never
calls `listenBucketNotification`, the one feature that exercises the flagged parser path most
directly. The attacker who could exploit this would need to control what our own storage backend
says back to us, which is a materially different — and much smaller — threat surface than the
advisory's generic description implies.

This is a judgement call about exploitability, not a claim that the advisory is wrong. If a future
`minio` release re-declares its own `stream-json` dependency against the 3.x line, this override
should be deleted the same day.

## What this changes going forward

`docs/PENDING.md`'s dependency-advisory item for `stream-json` is closed by this decision, not left
open — see the entry there for the resolution note. The general lesson, already stated once for the
AI adapters and repeated here because it cost a failed production deploy to relearn: **`pnpm audit
fix` and hand-applied overrides are code changes, not paperwork, and need the same "did the thing I
changed still work" check as anything else** — ideally before merge, not during the first deploy
that actually imports the affected module.
