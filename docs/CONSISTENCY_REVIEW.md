# PRD_1.md ↔ PHASES.md consistency review (2026-09-04)

PHASES.md states that the PRD is the source of truth and that any discrepancy is logged. This file is that log. Thirteen clear-cut contradictions were already corrected in PHASES.md on 2026-09-04 (prompt-file count, cap concurrency test, rate-limit scope, Playwright smoke in CI, per-plan upload limits, proposal Continue writing `Document`, `EDITED` outcome, hallucinated-cite alert, week-4 fallback wording, weekly restore test, living-gap-map citation, G2 wording and two G2 checklist items). Everything below still needs a human decision.

## 1. PRD contradicts itself (PHASES had to pick a side)

| # | Topic | PRD says (A) | PRD also says (B) | PHASES follows |
|---|---|---|---|---|
| 1 | Phase 3 week range | §4 table: weeks 12–20 | §16: weeks 14–22, slack 23–25; §16 totals table: 20 weeks target | B (14–22) |
| 2 | `§10.7.1` | FR-1.2 and `SeedPaper.extraction` cite §10.7.1 | §10.7 has no numbered subsections | cites §10.7.1 too |
| 3 | `InstitutionTemplate.spec` shape | §9.4 JSON: `margins`, `size`, `h1`, string captions | D.3.1: `marginsMm`, `sizePt`, `chapter`, object captions, `appendices`, `headerFooter`; model comment says "§9.4" | D.3.1 |
| 4 | `Document.meta` | D.3.2 reads `Document.meta` | §8 `model Document` has no `meta` field | uses `Document.meta` (proposalChat, thesis details) |
| 5 | `SourceChunk.subTheme` | FR-2.4: chunks tagged with `subTheme` | §8 `SourceChunk` has only `section` | FR-2.4 |
| 6 | `Comment.needsHumanRewrite` | A.13 output includes `needsHumanRewrite` | §8 `Comment` has only `class` | A.13 |
| 7 | Coherence trigger field | D.1.1: `now − lastRunAt ≥ 15 min` | FR-6.3 / D.1.1.2: `Chapter.lastCheckedAt`; `lastRunAt` exists in no model | `lastCheckedAt` |
| 8 | Phase 1 `.docx` bibliography | FR-8.1 (P1): "bibliography appended" | §4 table: Phase 1 = "Plain .docx", bibliography in Phase 2 | FR-8.1 (simple bibliography in week 4) |
| 9 | Guided input `Shift+→` | §16 week 1: "implement Appendix B fully" and B.3 lists `Shift+→` | §16 week 3 "If late: defer guided input" implies week 3 | week 3 (task 3.7) |
| 10 | Cap completeness (E.2) | E.2: every `AiAction` must have a cap in every plan | §11.3 lists no cap for `EXTRACT`, `OUTLINE`, `STYLE_PROFILE`, … | adds an `unmetered` list so the test can pass |
| 11 | Required env vars in Phase 0 | §13.3: `GOOGLE_*` and `RAZORPAY_*` are not marked optional; §0.2: refuse to start if missing | Razorpay is Phase 2 (week 11); Google keys may not exist in Phase 0 | stubs Google, defers Razorpay |
| 12 | Auth tables | §7.2: Better Auth is the auth layer | §8 (canonical schema, "copy verbatim") has no `Session`/`Account`/`Verification` tables and `User` lacks `emailVerified`/`image`/`updatedAt`, all of which Better Auth requires | adds them in migration 0002 — see `docs/ADR/0002-better-auth-tables.md` |
| 13 | Chapter concurrency + word counts | Appendix B.7 needs `Chapter.version` (409 on stale `baseVersion`) and a snapshot timestamp; B.4 stores word counts on `Chapter` | §8 `Chapter` has none of these columns | adds them in migration 0003 — see `docs/ADR/0003-chapter-version-columns.md` |

Recommended: fix the PRD in each row (pick A or B) so the two files agree by construction.

## 2. PHASES is stricter or softer than the PRD gate

- G2: PHASES adds pass/fail thresholds (acceptance ≥ 30%, p95 ≤ 600 ms, cost ≤ ₹100 AI-only) and a four-number pilot report. PRD G2 only requires the report to state three numbers.
- G3: PHASES requires both Path A **and** Path B; PRD says "topic **or** paper". PHASES allows "test mode with a dated plan to go live"; PRD requires billing live. PHASES adds cache hit ≥ 70%, hallucinated-cite < 1%, and "acceptance not lower than pilot".
- G4: PHASES adds "(or its formatting office)", cost/caps holding, RUNBOOK + one rollback rehearsal. PRD G4 has four items only.
- Phase 0 "If late": PHASES defers `release.yml` rollback logic and the restore drill to week 5. PRD gives Phase 0 no cut list and DoD G0 requires "restore tested once".
- Week 1 day-10 fallback: PHASES offers (a) more time, (b) decorations ADR, (c) drop tables/math to Phase 2. PRD offers only (b).

## 3. PHASES adds things the PRD never defines (not contradictions; confirm or remove)

- Feature flag `costModelVerified` (PRD ties the `UNVERIFIED` banner to Appendix E.3 being filled, not to a flag). FR-9.7 lists exactly four flags.
- Env var `SEED_ADMIN_EMAIL`; file `packages/config/templates.ts`; folders `docs/evidence/`; files `docs/PILOT-1.md`, `docs/PILOT-2.md` (PRD defines no second pilot).
- Job/queue names: `resolve-reference`, `export-docx`, queue `draft` (90 s timeout), queue `noop`; SSE progress events `queued/retrieving/writing/done`. PRD names only `extract-paper`, `index-source`, `search-literature`, `draft-section` and says "one queue" in Phase 0.
- Pricing helper names (`inputPerM`, `cacheReadMult`, `computeCallCost`, …); worker retry "3 attempts, exponential backoff".
- Numbers: start event < 100 ms; 50 mock suggestions / 350 ms overhead; per-week "Maximum: 7 days" for weeks 2–5; extraction within first 2,000 chars; retry once on invalid JSON; resolution similarity ≥ 0.85; ≤ 5 req/s; embed batches of 64; k6 for 5 minutes, error rate < 0.5%; pilot ≥ 10 days; search filters (type, year ≥ now−15, top 60); cited-by top 10; .bib fixture 20 entries / ≥ 80%; outline "≤ 5 edits"; 5 style golden tests on a 10-source fixture; coherence run cost ≤ ₹12 as a test criterion.
- Deliverables: 90-second "how suggestions work" onboarding panel; admin "reset caps" button, per-user admin page, feedback link with last 5 suggestion events; pilot users on `STUDENT_MONTHLY` via admin override (PRD has no override path); glossary editor (week 8); `.docx` chapter import route (week 10); cancellation email and per-charge invoice PDF (week 11); Razorpay webhook event names; guide digest / student notification emails (Block 2); Block 4 hardening rerun; two `IN_UNIVERSITY_*` placeholder CSL styles derived from IEEE/APA (style count reads as 22 vs "top 20").
- Retrieval function built in week 2 (task 2.7) and wired in week 3 (task 3.3); PRD lists retrieval only in week 3.
- Authz test asserts 404 not 403 (PRD gives no status code).

## 4. PRD items missing from PHASES

- FR-4.10 (P2): Path B chapters include the original paper excerpt as extra grounding (`{{paperExcerpt}}` in A.2). Not in any week.
- FR-1.7 / §17 #8: GROBID quality review behind the flag in Phase 2. Not mentioned.
- §4 Phase 3 items: "Path-B excerpt grounding refinements", "Full CSL library; narrative↔parenthetical rewrite" (FR-5.6), "feature flags per institution". Not in Blocks 1–4 (also absent from §16's Phase 3 paragraph).
- Week 3 DoD "whitelist test": PHASES implements the whitelist (3.4) but has no dedicated unit test item (§15 requires one).
- `Ctrl/Cmd+Shift+C` "suggest citation for this sentence" (§6.3) is never mentioned in task 3.6.
- BUILD_LOG granularity: PHASES = one entry per task; PRD §0 = one entry per work session.

## 5. Housekeeping

- PHASES.md refers to `docs/PRD.md` and `docs/PHASES.md`; the files currently live at the repo root as `PRD_1.md` and `PHASES.md`. Move/rename before Phase 0 or update the references.
