# ADR-0141 — CI spends minutes where they buy safety: quick on main, full before a release

**Status:** accepted · **Date:** 2026-10-09 · **Files:** `.github/workflows/ci.yml`,
`.github/workflows/release.yml`

## Context

The repository is public for now and will be private again, where every Actions minute is paid.
Every push to main ran the whole of `ci.yml`: the checks job (lint, typecheck, migrate-diff,
audit and every vitest suite) and then the Playwright smoke on the mock stack. Measured from
`gh run view --json jobs` on 2026-10-08/09:

| Green main run | checks | playwright smoke |
|---|---|---|
| 37949643247 | 10.7 min | 9.2 min |
| 37912022444 | 19.5 min | 14.6 min |
| 37907450113 | 17.7 min | 12.6 min |
| 37821954621 | 20.8 min | 12.0 min |

About 29 runner-minutes per green push (≈17 + ≈12). Inside checks, vitest is most of it (8.9 of
10.7 min in the first run); apps/api's 112 files take 514 s of that, every other package under
1.5 min. On 2026-10-09 alone there were 26 ci runs on main, 13 of them cancelled by the next push.

A release (`v*.*.*`) built four images (≈5.3 + 5.3 + 1.2 + 0.6 min) and deployed (1.9–4.6 min),
≈15–17 runner-minutes, and **did not look at CI at all**: a tag on a red commit deployed.

## Decision

1. **Two depths in `ci.yml`.** `FULL` is true for everything except an ordinary push to main.
   - **Quick (push to main):** lint, typecheck, migrate-diff, audit, and the vitest suites of the
     packages changed since the **last green ci run on main**, plus every package that depends on
     them: `turbo run test --filter=...[<sha>]` (Turborepo 2.10.12; the selector was checked with
     `--dry=json`, and an empty selection exits 0). No Playwright.
   - **Full:** every vitest suite and the Playwright smoke. On a pull request, on
     `workflow_dispatch`, and whenever `release.yml` calls it.
2. **The diff base is the last green run, not the previous push.** `cancel-in-progress` stays on,
   and diffing against `github.event.before` would have let a cancelled push's changes never be
   tested. Against the last green run, a cancelled or red push's changes stay in the next diff
   until something passes with them. Any doubt runs every suite: no green run found, its commit
   missing or not an ancestor of HEAD (a rewritten history), or any change outside `apps/` and
   `packages/` — the lockfile, root config, `turbo.json`, `fixtures/`, `.github/` — that Turborepo
   cannot pin to one package. `docs/i18n/` adds `@tc/web`, whose `i18n-review.spec.ts` reads it.
3. **A release runs the full CI on the tagged commit and deploys only if it passes.**
   `release.yml` has a `ci` job, `uses: ./.github/workflows/ci.yml` with `full: true`; `images`
   needs it, and `deploy` needs both. Chosen over checking the commit's check runs with `gh api`:
   a lookup can only find a Playwright result if someone produced one for that exact commit (which
   ordinary pushes no longer do), so it would either block every release or need a manual dispatch
   remembered first, plus code to interpret pending, cancelled and re-run results. The call
   produces the result itself and a red one stops the release through `needs:`. The cost is a
   full CI per release, and the release takes ≈30 min longer from tag to deploy. `images` waits
   for `ci` too, because the images are also tagged `latest` and a failed release must not move it.
4. **Path filters.** `push` and `pull_request` skip `docs/**` (except `docs/i18n/**`), root
   `*.md` and any `README.md`. Not `**/*.md`: `packages/ai/prompts/*.md` and
   `packages/ai/eval/candidates/*.md` are product content that tests read. A tag never passes
   through these filters: tags trigger `release.yml` only, and a `workflow_call` has no path filter.
5. **Caches.** The pnpm store was already cached (`actions/setup-node` `cache: pnpm`). The
   Playwright browsers are now cached by Playwright version (`~/.cache/ms-playwright`); on a hit
   only `install-deps` runs. The saving is small (the download was ≈15 s of a 23 s install) but free.

No test is removed or skipped (§0.3 rule 7). The Playwright smoke and the suites a quick push
leaves out move to the pull request, the manual run and the release, all of which run them whole.

## Estimate

Per push to main, from the 272 first-parent commits on main since 2026-10-01 classified by the
same rules: 17% touch only docs, 21% only `apps/web` or `apps/extension`, 47% a package apps/api
depends on (or apps/api itself), 14% something at the root.

| Push | Before | After |
|---|---|---|
| docs only | ≈29 min | 0 (not run) |
| apps/web or apps/extension only | ≈29 min | ≈4 min (checks, web + extension suites) |
| touches apps/api or a package it uses | ≈29 min | ≈17 min (checks, every affected suite) |
| root files (lockfile, config, fixtures) | ≈29 min | ≈17 min (checks, every suite) |
| **weighted average** | **≈29 min** | **≈11 min** |

| Release | Before | After |
|---|---|---|
| runner-minutes | ≈15–17 | ≈45 (full CI ≈29 + images and deploy ≈16) |
| tag to deployed | ≈10 min | ≈40 min |

At the 2026-10-09 rate (13 main runs that finished, 3 releases) that is ≈13 × 29 + 3 × 16 ≈ 425
→ ≈13 × 11 + 3 × 45 ≈ 280 runner-minutes a day, not counting the 13 cancelled runs (each now
also cheaper, since none of them reaches Playwright). Billing rounds each job up to the minute, so the real
figures are a little higher on both sides. The release is dearer on purpose: it is now the only
place the browser suite must pass, and the only place it used to be possible to skip.

## Consequences

- A push to main can be green while a Playwright spec is broken; the release (or a pull request,
  or "Run workflow") is where that shows. Before a release the owner may run the workflow by hand
  to find out early, rather than at tag time.
- A red release CI leaves the tag in place and deploys nothing. Fix on main, then tag the next
  patch version (or delete and re-push the tag); re-running the failed release run also works.
- If branch protection ever requires the `ci` checks on pull requests, a docs-only pull request
  will wait forever for checks that never start (the path filter). Today nothing is required.
- `ci.yml` asks for `actions: read` (to find the last green run); the release's `ci` job grants it.
