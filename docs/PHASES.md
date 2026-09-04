# Thesis Copilot — PHASES.md (phase-by-phase execution plan)

This file splits `docs/PRD.md` (v1.1) into execution units. Each unit is one block of work for Claude Code: it says what to read, what to build, in what order, how to prove it is done, and what to do if it runs late. The PRD remains the source of truth; this file never contradicts it — if it appears to, the PRD wins and the discrepancy is logged.

## Units in this file

| Section | Unit | Target | Gate |
|---|---|---|---|
| **PHASE-0** | Scaffold | 3 days | G0 |
| **PHASE-1-W1** | Editor spike | 1 week | G1 |
| **PHASE-1-W2** | Path B ingestion | 1 week | — |
| **PHASE-1-W3** | Grounded Assist + citations | 1 week | — |
| **PHASE-1-W4** | Draft mode + metering + telemetry | 1 week | — |
| **PHASE-1-W5** | Pilot hardening + deploy | 1 week | G2 |
| **PHASE-2** | Complete the loop (weeks 6–11) | 6 weeks | G3 |
| **PHASE-3** | Thesis-grade (weeks 14–22) | 9 weeks | G4 |
| **BUILD_LOG template** (end of file) | Log format | — | — |

## How to run a unit

1. Open Claude Code in the repo root.
2. Paste the **Start prompt** printed at the top of the unit section below.
3. Let it work. It must follow `docs/PRD.md §0.3` (agent protocol) — one task at a time, evidence in `docs/BUILD_LOG.md`, stop when stuck.
4. When it reports the unit is done, open `docs/BUILD_LOG.md` and check the **Gate checklist** at the bottom of the unit section yourself. Do not start the next unit until every box is ticked by you, not by the agent.
5. If a unit is late, apply its **If late** section. Scope shrinks; quality does not.

## Cadence that works

- One unit per Claude Code session (or a few sessions for a week-long unit). Start each session with: *"Read docs/BUILD_LOG.md, find the last completed task in docs/PHASES.md → `<UNIT>`, continue from the next task."*
- Commit after each task. Push at least daily.
- Never say "build everything". Never skip a gate.

## Things only the human does

- Fill `docs/PRD.md` Appendix E.3 (verification ledger) after `pnpm ai:verify` runs in Phase 0.
- Collect the five fixture papers (Appendix C.1) before Phase 1 week 2, and correct `*.expected.draft.json` → `*.expected.json`.
- Write the retrieval Q&A set (C.4) and the prompt golden set (C.5) during week 3.
- Answer `DECISION PENDING` items in PRD §17 as they come up.
- Tick gate checklists.

## Start prompt (generic form)

```
Read docs/PRD.md sections 0, 0.2 and 0.3 completely. Then read the section "<UNIT>" in docs/PHASES.md.
Build only what that section lists, in the order given, one task at a time.
For every task: implement, run the verification command, paste the command and its trimmed output into docs/BUILD_LOG.md under the heading for this unit, commit with a Conventional Commit message.
If a task is blocked (missing fixture, missing decision, failing external service), write "BLOCKED: <reason>" under it in the log and move to the next task.
If you are unsure about anything, write "UNSURE: <question>" in the log rather than guessing.
Do not start any task from a later unit. When all tasks are done or blocked, print the unit's Gate checklist with your evidence for each item, and stop.
```


---

## PHASE-0 — Scaffold

**Target:** 3 days · **Maximum:** 5 days · **Gate:** G0

### Start prompt

```
Read docs/PRD.md sections 0 (all of it, including 0.3), 1.5, 7, 8, 11, 13 and Appendix E. Then read docs/PHASES.md → PHASE-0.
Build only the tasks in the PHASE-0 section, in order, one at a time. After each task: run its verification, paste command + output into docs/BUILD_LOG.md under "Unit: PHASE-0", commit.
Do not write any product feature (no editor, no AI endpoints beyond the verify script). When done, print the Gate G0 checklist with evidence and stop.
```

### Read before starting

PRD §0.2 (conventions), §0.3 (agent protocol), §7.2 (stack — final), §7.3 (repo layout — final), §8 (schema — copy verbatim), §11.3 (plans), §11.1 (pricing defaults), §13 (deployment), Appendix E (verify script).

### Preconditions (human)

- A VPS exists (8 vCPU / 16 GB / 160 GB, Ubuntu 24.04, Docker installed), a domain points at it, SSH key access works.
- Provider API keys exist for: LLM provider, embeddings provider, Resend/SMTP. (Razorpay, Google OAuth can be added in Phase 2 / week 5.)
- GitHub repo created; GHCR enabled.

### Tasks (in order)

#### 0.1 Monorepo skeleton
- pnpm workspaces + Turborepo; TypeScript strict base config; Biome config; `.editorconfig`; `.gitignore`; `.env.example` listing every variable in PRD §13.3 with a one-line comment each.
- Folders exactly as PRD §7.3 (empty packages may contain only `package.json` + `src/index.ts`).
- Done when: `pnpm install` succeeds; `pnpm biome check .` passes; `pnpm -r list --depth -1` shows all apps and packages.

#### 0.2 `CLAUDE.md` and docs
- `CLAUDE.md` ≤ 150 lines: conventions (§0.2), agent protocol (§0.3, condensed to the 12 rule titles + "see PRD §0.3"), stack table (§7.2), commands (§13.6), "where things live" (§7.3).
- `docs/PRD.md` (this spec), `docs/PHASES.md` (this file), `docs/BUILD_LOG.md` from the template, `docs/ADR/0001-editor.md` = copy of PRD Appendix B, `fixtures/papers/README.md` = the C.1 checklist as a fill-in table.
- Done when: files exist; `wc -l CLAUDE.md` ≤ 150.

#### 0.3 `packages/config`
- Zod env schema (§13.3): required vs optional; app refuses to start on missing required.
- `plans.ts`: caps exactly as PRD §11.3 for all four plans and every `AiAction` that is metered (`ASSIST, DRAFT, CITE, CHAT, COMMAND, COHERENCE`); non-metered actions listed explicitly as `unmetered` so the cost test can assert completeness.
- `pricing.ts`: model id → `{ inputPerM, outputPerM, cacheReadMult, cacheWriteMult }` in USD; `embeddingPerM`; `inrPerUsd`; `hostingInrPerMonth`; `assumedActiveUsersForHostingShare` (500). All overridable via `PRICING_OVERRIDE_JSON`.
- `cost.ts`: `computeCallCost(model, usage)` → micro-INR; `computeMonthlyBudget(plan)` reproducing PRD §11.4 line by line.
- Test `cost-model.spec.ts` (Appendix E.2): STUDENT budget ≤ ₹100; every metered action has a cap in every plan.
- Done when: `pnpm --filter @tc/config test` passes and prints the §11.4 table.

#### 0.4 `packages/db`
- `schema.prisma` copied verbatim from PRD §8 (including `previewFeatures = ["postgresqlExtensions"]`).
- Migration 0001: `CREATE EXTENSION vector`; a `uuid_generate_v7()` SQL function (or `pg_uuidv7` if the image has it — check first, do not assume); HNSW indexes on `SourceChunk.embedding` and `ChapterChunk.embedding`.
- Seed: one `SUPERADMIN` user from env `SEED_ADMIN_EMAIL`; `FeatureFlag` rows for `automaticSuggest=false, grobid=false, draftModeStrongTier=true, livingGapMap=false`; one `InstitutionTemplate` named `EXAMPLE_IN_UNIVERSITY` with the spec in Appendix D.3.1.
- Done when: `pnpm db:migrate` and `pnpm db:seed` succeed against the dev Compose Postgres; `psql -c "\dx"` shows `vector`; `SELECT uuid_generate_v7();` returns a UUID.

#### 0.5 `packages/ai` — provider abstraction, prompt loader, mock provider, verify script
- Interfaces exactly as PRD §10.2. Real provider adapter via the AI SDK with prompt caching on the cached system block. Mock provider: replays recorded fixtures or returns a fixed string with configurable latency (used by all tests and by week 1).
- Prompt loader: reads `packages/ai/prompts/*.md`; the 21 prompt files from Appendix A created **verbatim** (copy the fenced blocks; do not edit wording).
- `pnpm ai:verify` per Appendix E.1: real calls, print ids and usage, assert pricing entries exist, recompute budget, exit non-zero if > ₹100, print the E.3 block.
- Done when: `pnpm ai:verify` runs end-to-end with real keys and its output is pasted in the log; `ls packages/ai/prompts | wc -l` = 21.

#### 0.6 `apps/api`
- NestJS 11 on Fastify; modules `health`, `auth` (Better Auth: email OTP + Google — Google may be stubbed until keys exist), `usage` (cap service with the atomic `INSERT … ON CONFLICT … WHERE count < cap RETURNING` statement, §10.2), `admin` (empty), `flags`.
- Global: problem-details exception filter (RFC 9457), request-id, Pino logger (never logs AI request bodies), `/metrics` (Prometheus), rate limiting per IP and per user (Redis) on `/auth/*` and the AI endpoints (§12.1).
- Test: cap concurrency — a stub metered action with its counter already at cap−1; fire 20 parallel requests; exactly 1 succeeds, 19 return `CAP_EXCEEDED` with `resetsAt`; no provider call is made for the 19 (assert on the mock). (PRD §15.)
- Done when: `pnpm --filter @tc/api test` passes including the concurrency test; `curl /api/v1/health` returns DB/Redis/MinIO/provider status.

#### 0.7 `apps/worker`
- BullMQ with Redis; one queue `noop`; retry policy (3 attempts, exponential backoff); a test that enqueues a job that throws and asserts it lands in the failed set after retries.
- Done when: test passes; worker logs show queue registration.

#### 0.8 `apps/web`
- Next.js 15 App Router; Tailwind v4; shadcn/ui base; auth pages wired to Better Auth; `/app` document list (create/list only); `/app/d/:id/write/:chapterId` renders an empty page titled "Editor — coming in week 1".
- Done when: sign in with OTP works locally; a document can be created and appears in the list.

#### 0.9 `infra/`
- `docker-compose.dev.yml` (postgres pgvector, redis, minio, gotenberg); `docker-compose.prod.yml` per PRD §13.2 (grobid under a profile); Dockerfiles (multi-stage, non-root, tini); `Caddyfile` with `flush_interval -1` on `/api/*`; `backup.sh` (nightly pg_dump + `mc mirror`), `restore.sh`; `deploy.sh`.
- CI `ci.yml`: install, biome, tsc, vitest (with Testcontainers), Playwright smoke (editor loads, suggestion streams against the mock provider), `prisma migrate diff` check, `pnpm audit --audit-level=high`.
- `release.yml`: on tag → build/push images to GHCR → SSH deploy → `prisma migrate deploy` → health check → rollback on failure.
- Done when: CI green on `main`; a tag deploys to the VPS; `https://<domain>/api/v1/health` returns 200 over TLS; `restore.sh` restored a backup into a scratch database once (paste the output).

#### 0.10 Verification ledger
- Print the `pnpm ai:verify` block and ask the human to fill PRD Appendix E.3. Add an `UNVERIFIED` banner to the (empty) admin page that reads a `costModelVerified` flag from `FeatureFlag`; the human flips it after filling E.3.
- Done when: banner shows; the log contains the verify output.

### Do not
- Do not install any package not in PRD §7.2 without an ADR.
- Do not implement the editor, retrieval, or any Appendix A prompt call except the verify script.
- Do not create `fixtures/papers/*.expected.json`.

### If late (day 4–5)
Defer 0.9's `release.yml` rollback logic and the restore drill to week 5; everything else stays.

### Gate G0 — human checklist
- [ ] CI is green on `main` (link to run).
- [ ] `https://<domain>/api/v1/health` returns 200 with all checks OK.
- [ ] `pnpm ai:verify` output is in the log and I have filled PRD Appendix E.3; budget printed ≤ ₹100.
- [ ] Cap concurrency test output is in the log (5 succeed / 15 blocked).
- [ ] `packages/ai/prompts/` contains 21 files whose text matches Appendix A.
- [ ] `docs/ADR/0001-editor.md` exists and matches Appendix B.
- [ ] Backup restore drill output is in the log (or explicitly deferred).
- [ ] I have started collecting the five fixture papers (C.1).

---

## PHASE-1-W1 — Editor spike

**Target:** 5 working days · **Maximum:** 10 · **Gate:** G1 (the most important gate in the project)

### Start prompt

```
Read docs/PRD.md §0.3, §5.4, §6, §8 (Chapter, Citation, DocumentVersion, SuggestionEvent) and Appendix B in full. Then read the PHASE-1-W1 section of docs/PHASES.md.
Build the editor exactly as Appendix B specifies, task by task. Use the mock LLM provider for everything this week; do not call the real provider.
After each task: run its tests, paste command + output into docs/BUILD_LOG.md under "Unit: PHASE-1-W1", commit.
The unit is done only when all nine tests in Appendix B.9 pass and the DoD numbers are in the log. Then print the Gate G1 checklist and stop.
```

### Read before starting
Appendix B (all), PRD §6.2–6.3 (layout and keymap), §9.3 (`/assist/suggest` contract), Appendix A.1 (so the `{{cite:KEY}}` convention is understood — the mock returns text containing it).

### Preconditions
G0 ticked. Mock provider exists and can return a fixed multi-sentence string with `{{cite:S1#c1}}` at a configurable token rate.

### Tasks (in order)

#### 1.1 Schema and base editor
- TipTap editor with the node/mark set in B.2 (citation, draftBlock, needsSourceNote, mathInline/mathBlock via KaTeX, image with signed-URL upload, provenance, commentAnchor registered but inert).
- Level-1 heading is not user-insertable (toolbar and input rules omit it).
- Done when: unit test that `editor.getJSON()` round-trips a fixture document containing every node and mark type.

#### 1.2 Provenance mark + appendTransaction plugin (B.4)
- Typed text → `HUMAN`; boundary typing does not extend AI marks; edits inside AI ranges → `HUMAN_EDITED`; internal paste preserves marks; external paste → `HUMAN`.
- Word-count-by-provenance function.
- Done when: B.9 test 5 passes plus paste tests.

#### 1.3 Ghost-text plugin (B.3)
- Plugin state, widget decoration, request/stream/cancel/accept-all/accept-word, keymap precedence (Tab consumed only when shown), single in-flight request, `aria-live`.
- Done when: B.9 tests 1–4 pass.

#### 1.4 SSE endpoint `/assist/suggest` (B.8, §9.3)
- Fastify SSE with `start/token/done/error` events; `AbortController` propagation server-side (cancel the mock stream on client disconnect); per-user single in-flight guard (409); server-side `ttfbMs` and `latencyMs` timers; `SuggestionEvent` written on `done` (outcome `SHOWN`) and updated by `/assist/outcome`.
- Cap check uses the `ASSIST` action (Phase 0 cap service) — with the mock provider the cost logged is 0 but the counter increments.
- Done when: integration test streams a 3-sentence mock at 250 ms simulated latency; client receives `start` in < 100 ms and `done` with `usage`; disconnecting the client aborts the server stream (assert on the mock).

#### 1.5 Citation node + NodeView (B.5)
- Attrs, stable `key`, NodeView reading `editor.storage.citations`, rerender on `citationsRerender` meta, hover popover shell (source title/year placeholder), red-dashed "source removed" state, atom delete/backspace behaviour.
- A placeholder renderer: `(Author, Year)` from a stub map — real citeproc comes in Phase 2.
- `{{cite:KEY}}` → citation node conversion on accept, using the `citations[]` payload from the `done` event.
- Done when: B.9 test 6 passes (style switch changes labels, not JSON).

#### 1.6 Draft block (B.6)
- Node, header NodeView (Accept / Discard / Regenerate — Regenerate disabled this week), unwrap-on-accept, snapshot before accept, one-pending-per-chapter rule, `needsSourceNote` conversion.
- Done when: B.9 test 7 passes.

#### 1.7 Autosave, versions, conflict (B.7)
- 2 s debounce, blur/route/30 s triggers, `baseVersion` + 409 handling, `localStorage` safety copy, server snapshot rules, `DocumentVersion` rows to object storage (gzipped JSON).
- Done when: B.9 test 8 passes; manual kill-tab test loses ≤ 2 s (paste the steps and result).

#### 1.8 Editor page layout (§6.2)
- Left rail (static chapter list for now), centre editor (72ch), right panel tabs (Sources/Citations placeholders), top bar with autosave state and a static usage meter reading `/usage/me`.
- Done when: Playwright E2E (B.9 test 9) passes: type, `Ctrl+/`, ghost text visible, `Tab`, reload, text persists with `ASSIST` provenance.

#### 1.9 Latency measurement
- Add a dev-only overlay showing last `ttfbMs`/`latencyMs`; run 50 mock suggestions locally and record p50/p95 in the log.
- Done when: p95 TTFB ≤ 600 ms locally with the 250 ms mock (the remainder is our overhead — if > 350 ms overhead, profile and fix before continuing).

### Do not
- Do not call the real LLM provider this week.
- Do not build retrieval, extraction, or Draft-mode generation — only the editor-side draft block.
- Do not add Yjs or any collaboration library.
- Do not store ghost text in the document, ever.

### If late
- Day 7 not done: continue to day 10; move `Alt+→` word-accept and the accepted-text fade to week 5.
- Day 10 not done: **stop and report**. The human decides between (a) more time, (b) an ADR replacing citation NodeViews with decorations, (c) reducing schema (drop tables/math to Phase 2).

### Gate G1 — human checklist
- [ ] All nine B.9 tests listed in the log with passing output.
- [ ] I opened the editor myself, typed, pressed `Ctrl+/`, saw ghost text, pressed `Tab`, reloaded — the text was there.
- [ ] I typed while a suggestion was showing and it vanished immediately.
- [ ] I pressed `Tab` inside a list without a suggestion and it indented.
- [ ] p50/p95 TTFB numbers are in the log and p95 ≤ 600 ms.
- [ ] Kill-tab test result is in the log.
- [ ] `editor.getJSON()` shown in the log contains no ghost text during a stream.

---

## PHASE-1-W2 — Path B ingestion (upload → extraction → sources → index)

**Target:** 5 days · **Maximum:** 7 · **Gate:** none (feeds G2)

### Start prompt

```
Read docs/PRD.md §0.3, §5.1, §5.2, §5.3 (FR-3.5 only), §9.1–9.2, §10.4, §10.7.1, Appendix A.5 and Appendix C.1–C.3. Then read docs/PHASES.md → PHASE-1-W2.
Build the tasks in order. Real provider calls are allowed this week only for extraction (A.5) and embeddings; everything else stays mocked.
If fixtures/papers/ does not yet contain p01–p05 with *.expected.json, complete every task you can, write "BLOCKED: fixture missing" on the scoring task, and stop after the last task. Never create *.expected.json yourself.
```

### Read before starting
PRD §5.1 (FR-1.1–1.4, 1.7), §5.2 (FR-2.1–2.4), §10.4, §10.7.1, A.5, Appendix C.1–C.3, §13.3 (scholarly API env vars).

### Preconditions
G1 ticked. `fixtures/papers/README.md` filled by the human (or the task is marked BLOCKED). Keys for LLM + embeddings present. `OPENALEX_MAILTO`, `CROSSREF_MAILTO`, `UNPAYWALL_EMAIL` set.

### Tasks (in order)

#### 2.1 Upload + storage
- `POST /documents/:id/seed-papers` (multipart, `.pdf`/`.docx`, magic-byte check; size/page limits per plan from §11.3 — FREE_TRIAL 25 MB / 150 pages, STUDENT plans 50 MB / 500 pages) → object storage key → `SeedPaper { status: PENDING }` → enqueue `extract-paper`.
- Done when: integration test uploads `p01.pdf`, row exists, job enqueued.

#### 2.2 Text extraction (Node)
- `unpdf` for PDF (page-aware text; keep page boundaries as markers), `mammoth` for DOCX. Two-column heuristics: if `unpdf` returns interleaved columns, use its per-item positions to reorder by column (check what the library exposes before assuming; note findings in the log).
- Done when: a unit test extracts each fixture PDF and asserts the expected title string appears within the first 2,000 characters.

#### 2.3 Structured extraction (A.5)
- Prompt builder for A.5 with the ≤ 3-part split rule; strong-tier call; Zod validation of `PaperExtraction`; retries once on invalid JSON; result stored on `SeedPaper.extraction`; `status: DONE`.
- Agent writes `fixtures/papers/pNN.expected.draft.json` from the results (never `.expected.json`).
- Done when: all five drafts exist; the human is told to correct them.

#### 2.4 Proposal screen (FR-1.3, FR-1.4)
- `/app/d/:id/proposal`: editable fields (working title, problem statement, objectives, whyOpen — pre-filled from extraction), gap-analysis checklist (reference count vs 40–60; missing chapters list from `sections`), "Continue" writes `Document` (working title) + `DocumentMemory.scope` and seeds `glossary` from `terminology`.
- Done when: E2E: upload → wait → edit title → continue → reload → edited title persists and appears in `DocumentMemory.scope`.

#### 2.5 Reference resolution (FR-2.1)
- Job `resolve-reference` per raw string: Crossref `query.bibliographic` (top 3) → pick by normalised similarity ≥ 0.85 on title/authors/year; fallback OpenAlex search; store `Source` with `cslJson`, `oaStatus`, `citationCount`, `isPreprint`, retraction check (Crossref `update-to`); unresolved → `UNRESOLVED`.
- Polite rate limiting (Crossref/OpenAlex etiquette headers, ≤ 5 req/s), retries with backoff, idempotent by `documentId + rawReference`.
- Done when: integration test on `p01`'s references resolves ≥ 80% of those marked `crossref: true` in `expected.json` (or BLOCKED).

#### 2.6 Full-text fetch + student PDF upload (FR-2.2, FR-2.3)
- Unpaywall `best_oa_location.pdf_url` → download → object storage → `groundingLevel: FULL_TEXT`; CORE fallback (deferred to week 5 if late); else abstract only → `ABSTRACT`.
- `POST /documents/:id/sources/upload` for the student's own PDFs → same pipeline (title/DOI detection from first page + Crossref match).
- Done when: for the fixture set, at least the OA papers reach `FULL_TEXT`; the library API returns grounding levels.

#### 2.7 Chunking + embedding (FR-2.4)
- Section-aware chunker: ~350 tokens, 15% overlap, never split mid-sentence, keep `page`, `charStart/End`, `section`; embed via `packages/ai` in batches of 64; write `SourceChunk`; HNSW index in place from Phase 0.
- Retrieval function per PRD §10.4 (query embedding → `<=>` cosine → rerank) in `packages/retrieval`.
- Done when: unit tests for the chunker (no mid-sentence splits; overlap size; page preserved); an integration test embeds `p01` and retrieves a known passage by its own text with rank 1.

#### 2.8 Library UI (`/app/d/:id/sources`)
- List with status, grounding badge (Full text / Abstract only / Unresolved), year, venue, citation count, retracted warning; upload button; "Fix reference" for `UNRESOLVED` (manual DOI entry → re-resolve); PDF viewer opening at a page (signed URL).
- Done when: E2E shows the resolved library for `p01` with badges.

#### 2.9 Scoring (Appendix C.3)
- `extraction.spec.ts` prints the per-paper table; thresholds per C.3.
- Done when: table pasted in the log with pass/fail — or `BLOCKED: fixture missing`.

### Do not
- Do not call OpenAlex for discovery/search (that is Phase 2). Only resolution and metadata.
- Do not build the outline; a minimal one-chapter `Chapter` row is created in week 3.
- Do not edit `*.expected.json`.

### If late
Defer CORE fallback and the DOCX path (2.2 mammoth) to week 5. Keep Unpaywall.

### Human checklist (end of week)
- [ ] I corrected the five `expected.draft.json` files into `expected.json` and committed them.
- [ ] Extraction scoring table is in the log and meets C.3 (or I have a plan for the failures).
- [ ] I uploaded one real student paper myself and saw a sensible proposal skeleton and library.

---

## PHASE-1-W3 — Grounded Assist + citation suggestions

**Target:** 5 days · **Maximum:** 7 · **Gate:** none (feeds G2)

### Start prompt

```
Read docs/PRD.md §0.3, §5.4 (FR-4.3, 4.5, 4.7 note, 4.11), §5.5 (FR-5.1), §10.1–10.4, §10.6, Appendix A.0, A.0.1, A.1, A.3, and Appendix C.4–C.5. Then read docs/PHASES.md → PHASE-1-W3.
Build in order. From this week the real Fast-tier model is used for Assist and citation suggestion. Use the prompt files verbatim — do not edit them. If a prompt performs badly, record examples in the log under "Prompt observations" and continue.
```

### Read before starting
§10.3 (caching rules and the 4k-token budget), A.0/A.0.1 (block assembly and trimming order), A.1 post-processing list, §10.6 guardrails, C.4/C.5.

### Preconditions
Week 2 done (library indexed for at least the fixture papers). `AI_FAST_MODEL` verified in Appendix E.3.

### Tasks (in order)

#### 3.1 Minimal chapter + pins
- On "Continue" from the proposal screen, create one `Chapter` ("Chapter 1 — Introduction" or the first section from the paper's `sections`) with `scopeNote` from the extraction's first section summary; `DocumentMemory.outline` = a one-node tree.
- `PUT /chapters/:id/pins`; pins UI in the right panel ("Pin all" shortcut per §6.2 empty state).
- Done when: E2E: continue → editor opens on the chapter → pin two sources.

#### 3.2 Prompt builder (A.0 + A.0.1 + A.1)
- Cached block assembly with the trimming order; token counting via the provider's tokenizer or a calibrated estimator (state which, and the calibration in the log); volatile block from chapter title, scope note, retrieved passages (`[S<id>#c<id>]` ids), `before` (~1,200 tokens), `after` (~300), instruction.
- Snapshot tests: given a fixture memory + chapter state, the assembled prompt equals the stored snapshot; a second test proves that changing the outline changes the cached block (FR-3.4 AC).
- Done when: snapshot tests pass; the log shows the cached block token count for the fixture (≤ 4,000).

#### 3.3 Retrieval wiring (§10.4)
- Query = last sentence of `before` + scope note; pins filter; top 24 → rerank → top 6; passages rendered with `shortRef` (first author, year, venue) and page.
- Labelled set C.4: after the human supplies `fixtures/retrieval/qa.json`, map quotes to chunk ids and run recall@6.
- Done when: recall@6 ≥ 0.80 in the log (or BLOCKED if the human has not written the set).

#### 3.4 Real Assist through the pipeline
- Switch `/assist/suggest` to the real provider with prompt caching on the cached block; log `cachedInputTokens`/`cacheWriteTokens`; compute cost via `packages/config`; write `AiCallLog`.
- Post-processing per A.1: citation whitelist (count `HALLUCINATED_CITE`), overlap trim, two-sentence cut, empty handling (`EMPTY_SUGGESTION`, no cap charge).
- Done when: 30 manual suggestions on a fixture chapter — paste 5 examples (before/after/suggestion/citations) in the log; hallucinated-cite count; cache hit rate over the 30 (target ≥ 70% after warm-up).

#### 3.5 `{{cite}}` → citation nodes with real sources
- On accept, convert `{{cite:S<id>#c<id>}}` into citation nodes with `sourceId`/`chunkId`; `Citation` rows upserted on save; hover popover shows the real passage; "Open PDF at page".
- Done when: E2E: accept a suggestion containing a citation → hover shows the passage → reload → citation persists.

#### 3.6 Citation suggestion (FR-4.5, A.3)
- Claim heuristic (numbers/percentages, "studies show"/"has been shown"/"significantly", comparative statements) evaluated at sentence end; ≤ 1 trigger per sentence; `POST /citations/suggest` → retrieval top 6 → A.3 → show direct/partial (max 3) inline with the passage; insert or dismiss; counts as `CITE`.
- Done when: unit tests for the heuristic (10 positive, 10 negative sentences); E2E inserts a suggested citation.

#### 3.7 Guided suggestion (`Shift+→`)
- Small inline input; instruction passed as `<instruction>`; `guided: true` on the event.
- Done when: E2E passes with an instruction like "mention cost barriers".

#### 3.8 Prompt golden set (C.5)
- Runner for `fixtures/prompts/*.json` scenarios (properties, not exact text); nightly CI job only.
- Done when: runner works on at least 3 human-written scenarios (or BLOCKED for the rest).

#### 3.9 Prompt observations
- Log section with at least 10 real suggestions the agent judged weak, each with a one-line reason. Do not change the prompt files.

### Do not
- Do not edit `packages/ai/prompts/*.md`.
- Do not build Draft mode generation, chat, commands, or style profile (week 4 / Phase 2).
- Do not enable automatic-suggest.

### If late
Defer 3.7 (guided input) to week 5.

### Human checklist (end of week)
- [ ] I wrote `fixtures/retrieval/qa.json` (30 questions) and recall@6 is in the log.
- [ ] I read the 5 example suggestions in the log and at least 3 are ones I would keep.
- [ ] Hallucinated-cite count in the log is 0 or explained.
- [ ] Cache hit rate ≥ 70% after warm-up (or the reason is logged).

---

## PHASE-1-W4 — Draft mode + metering + telemetry + export

**Target:** 5 days · **Maximum:** 7 · **Gate:** none (feeds G2) — but this week cannot be marked done while the cost model is `UNVERIFIED`.

### Start prompt

```
Read docs/PRD.md §0.3, §5.4 (FR-4.4), §5.8 (FR-8.1, FR-8.6), §5.9 (FR-9.2–9.4, 9.7), §11 (all), §14, Appendix A.2, Appendix B.6, Appendix E. Then read docs/PHASES.md → PHASE-1-W4.
Build in order. Draft mode uses the Strong tier (flag draftModeStrongTier=true). Every metered action must be capped before this week ends; write the cap tests first, then the features.
```

### Read before starting
§11.3 caps, §11.5 enforcement, §10.2 call pipeline (cap → build → call → validate → log → ledger), A.2 (Draft prompt + post-processing), B.6, §14 dashboards, E.3.

### Preconditions
Week 3 done. Appendix E.3 filled (if not, do everything and leave the week `UNVERIFIED`).

### Tasks (in order)

#### 4.1 Caps on every P1 action (FR-9.2)
- Wire the Phase 0 cap service into `ASSIST`, `DRAFT`, `CITE` (and reserve `CHAT`, `COMMAND`, `COHERENCE` for later). Cap by plan from `plans.ts`; `CAP_EXCEEDED` problem-details with `resetsAt`; `/usage/me` returns counters + caps + `resetsAt`.
- Concurrency test per action (20 parallel at cap−1 → exactly 1 succeeds; no provider call for the rest).
- Done when: all cap tests pass; the top-bar meter shows live counts.

#### 4.2 Draft mode job (FR-4.4, A.2)
- `POST /draft/section` → cap check (`DRAFT`) → job `draft-section` (queue `draft`, timeout 90 s) → retrieval top 12 over pinned sources (refuse with the FR-4.4 message if zero) → A.2 on Strong tier with the cached block → post-processing (citation whitelist; `[[NEEDS SOURCE]]` → `needsSource[]`; `SHORT` marking) → Markdown → ProseMirror with `DRAFT` provenance → `draftBlock` inserted per B.6 → SSE progress (`queued`, `retrieving`, `writing`, `done`).
- Accept / Discard / Regenerate endpoints; `SuggestionEvent` with `action: DRAFT`; `DocumentVersion` snapshot before accept.
- Done when: E2E: pin sources → `Ctrl+Shift+D` on the chapter heading → draft appears tinted with citations → Accept → provenance `DRAFT` → reload persists. A second E2E proves refusal with no pins. Paste one real draft (first 150 words + needsSource list) in the log.

#### 4.3 AI call logging and cost (FR-9.3)
- `AiCallLog` on every call with real usage from the provider (input, cached, cache-write, output), `costMicroInr` from `packages/config`, `latencyMs`, `ok/error`.
- Done when: after 10 Assist + 2 Draft calls, `SELECT action, count(*), sum(cost_micro_inr)/1e6 FROM "AiCallLog" GROUP BY 1` is pasted in the log with plausible numbers vs §11.2.

#### 4.4 Suggestion telemetry (FR-9.4)
- `SuggestionEvent` outcomes for Assist (`SHOWN/ACCEPTED/PARTIAL/EDITED/REJECTED/CANCELLED`), citations (`ACCEPTED/REJECTED`), Draft (`ACCEPTED/DISCARDED`); `keptChars` on accept; `ttfbMs` from the server timer.
- Done when: a query for acceptance rate over the week's events is pasted in the log.

#### 4.5 Admin dashboard (`/admin`, SUPERADMIN)
- Cards: cost per user this period vs ₹100 (table, top 20), platform average, acceptance rate (Assist, Draft), TTFB p50/p95, cache hit rate per action, hallucinated-cite rate, cap-exceeded counts, failed jobs. Header banner `Cost model: UNVERIFIED` until `costModelVerified` flag is true.
- `/metrics` exposes the same as Prometheus series (§14).
- Done when: screenshots of the dashboard with real data are referenced in the log (saved under `docs/evidence/`).

#### 4.6 Alerts (§11.5, §14)
- Email to admins when a user's month-to-date cost > ₹120, platform average > ₹90, job failure rate > 5%/15 min, TTFB p95 > 900 ms/15 min, hallucinated-cite rate > 1% (§10.6). Implemented as a worker cron every 15 min.
- Done when: a forced condition in a test sends the email through the mock mailer.

#### 4.7 Plain `.docx` export (FR-8.1)
- `packages/export`: ProseMirror → docx (headings, paragraphs, lists, tables, images from object storage, math as image fallback), citations rendered by the placeholder renderer (citeproc comes in Phase 2) and a simple bibliography from `cslJson` fields; job `export-docx`; signed URL.
- Free plan: body only (no bibliography) per §11.3.
- Done when: the fixture chapter exports and opens in LibreOffice headless without errors (`soffice --convert-to pdf` succeeds); paste the command.

#### 4.8 AI-usage log export (FR-8.6)
- `.docx` and `.csv`: per chapter, word counts by provenance, number of AI actions by type, date range.
- Done when: an export for the fixture chapter matches the provenance word counts computed by the editor (assert equality in a test).

#### 4.9 Feature flags UI (FR-9.7)
- Admin toggle for `automaticSuggest`, `grobid`, `draftModeStrongTier`, `livingGapMap`, `costModelVerified`.
- Done when: toggling `draftModeStrongTier` off routes the next Draft to the Fast tier (assert on `AiCallLog.model`).

### Do not
- Do not charge a cap unit when the provider errors or the suggestion is empty (roll back the ledger increment inside the same transaction).
- Do not build billing (Phase 2). Everyone is on `FREE_TRIAL` caps with a manual admin override to `STUDENT_MONTHLY` for pilot users.

### If late
Draft mode runs non-streamed (job completes → block inserted on the next poll); streaming progress moves to Phase 2.

### Human checklist (end of week)
- [ ] Appendix E.3 is filled and I flipped `costModelVerified`; the banner is gone.
- [ ] I ran Draft mode on a real chapter and read the draft; every citation opened a real passage.
- [ ] Cap tests for ASSIST, DRAFT, CITE are in the log.
- [ ] Dashboard screenshot shows my own cost for the week.
- [ ] `.docx` export opened in Word/LibreOffice on my machine.

---

## PHASE-1-W5 — Pilot hardening and deployment

**Target:** 5 days · **Maximum:** 7 (+ up to 2 slack weeks for pilot fixes) · **Gate:** G2 (Phase 1 exit)

### Start prompt

```
Read docs/PRD.md §0.3, §6.4, §12, §13, §14, §15 and the "If late" deferrals recorded in docs/BUILD_LOG.md for weeks 1–4. Then read the PHASE-1-W5 section of docs/PHASES.md.
This week is about making what exists reliable and deploying it. Do not add features beyond the deferred items listed in the log. Build in order.
```

### Read before starting
§12 (security/privacy), §13.1–13.5 (VPS, Compose, CI/CD), §14 (alerts, uptime), §15 (load test), §6.4.

### Preconditions
Weeks 1–4 done or explicitly deferred. VPS reachable. Five pilot students identified by the human.

### Tasks (in order)

#### 5.1 Deferred items
- Implement anything marked "deferred to week 5" in the log (typically: `Alt+→`, accepted-text fade, CORE fallback, DOCX path, guided input). Each with its original verification.

#### 5.2 Error and empty states (§6.2, §6.4)
- Every AI action has: loading state, cap-exceeded state (with `resetsAt` in the user's timezone), provider-error state (retry once, then a readable message), empty-grounding state (Draft refusal; Assist "no sources pinned" hint).
- Autosave conflict (409) screen. Upload failure reasons. Unresolved reference guidance.
- Done when: a Playwright test forces each state via the mock and asserts the copy.

#### 5.3 Onboarding
- First-run flow: create document → upload paper → proposal → editor, with one-line hints; a 90-second "how suggestions work" panel (keys, Assist vs Draft, "verify every citation").
- Done when: E2E completes the flow from a fresh account.

#### 5.4 Security pass (§12.1)
- Authorisation tests: user A cannot read/write user B's document, chapter, source, or export (assert 404, not 403, to avoid enumeration). Rate limits on auth and AI endpoints (assert 429). Upload magic-byte rejection. Cookies `Secure/HttpOnly/SameSite=Lax`. HSTS via Caddy. `pnpm audit --audit-level=high` clean.
- Done when: the test file passes and the audit output is in the log.

#### 5.5 Observability
- Sentry (if `SENTRY_DSN`), Uptime Kuma container monitoring `/health`, Prometheus scrape config, log retention (Compose logging driver with rotation).
- Done when: a deliberately thrown error appears in Sentry (screenshot in `docs/evidence/`); Uptime Kuma shows green.

#### 5.6 Backups
- Nightly `backup.sh` cron on the VPS; weekly `restore.sh` test cron into a scratch database (§12.1), plus one manual restore drill now (paste output). Verify object-storage mirror.
- Done when: restore drill output in the log dated this week.

#### 5.7 Load test (§15)
- k6: 200 concurrent Assist streams for 5 minutes against the VPS with the mock provider at 250 ms; record p50/p95 TTFB, error rate, CPU/RAM.
- Done when: p95 TTFB ≤ 600 ms and error rate < 0.5% on the VPS; numbers in the log. If not met, profile (Fastify SSE, Postgres pool, retrieval query plan — `EXPLAIN ANALYZE` on the HNSW query) and fix before deploying.

#### 5.8 Deploy
- Tag `v0.1.0` → `release.yml` → VPS; `prisma migrate deploy`; health green over TLS; admin account seeded; feature flags set (`automaticSuggest=false`, `draftModeStrongTier=true`).
- Pilot users created and set to `STUDENT_MONTHLY` caps by admin override.
- Done when: `https://<domain>` login works for the human; the tag and deploy log link are in the log.

#### 5.9 Pilot support tooling
- Admin: per-user page with their documents (titles only), usage, cost, last active; "reset caps" button (logged); feedback link in the app that emails the admin with the document id and last 5 suggestion events.
- Done when: the human can see each pilot student's usage.

#### 5.10 Pilot report (after ≥ 10 days of student use)
- Script `pnpm pilot:report` printing: per student — words written by provenance, Assist acceptance rate, Draft accept/discard, p50/p95 TTFB, cost for the period; platform totals; hallucinated-cite count; cap-exceeded events.
- Done when: the report is pasted in the log and summarised in `docs/PILOT-1.md` (numbers only; the human writes the interpretation).

### Do not
- Do not ship any feature not listed here or in the deferral log.
- Do not enable automatic-suggest for pilot users (cost).
- Do not reset any student's document or caps without logging it.

### If late
Skip 5.3's video-style panel (keep the one-line hints). Everything else is required before deploy.

### Gate G2 — Phase 1 exit (human checklist)
- [ ] Five students have each drafted at least one real chapter on the deployed VPS.
- [ ] `docs/PILOT-1.md` states: Assist acceptance rate, Draft acceptance, p95 TTFB, cost per student for the month.
- [ ] Acceptance rate ≥ 30% (PRD §1.5) — or I have decided what to change in Phase 2 because of it.
- [ ] p95 TTFB ≤ 600 ms on the VPS under real use.
- [ ] Cost per active student ≤ ₹100 for AI alone (hosting share excluded at pilot scale) — or the overage is explained by the ledger.
- [ ] Backup restore drill and load test outputs are in the log.
- [ ] Acceptance rate, p95 TTFB and cost per user are all visible on the admin dashboard (PRD DoD G2).
- [ ] `docs/BUILD_LOG.md` has evidence for every Phase 1 DoD (PRD §16).
- [ ] I have shown the pilot report to the owner and we agreed to continue to Phase 2.

---

## PHASE-2 — Complete the loop (weeks 6–11)

**Target:** 6 weeks · **Maximum:** 8 · **Gate:** G3

### Start prompt (per week)

```
Read docs/PRD.md §0.3 and the sections listed under "Read" for week <N> in docs/PHASES.md → PHASE-2. Read docs/PILOT-1.md.
Build only week <N>'s tasks, in order, one at a time; verification + evidence in docs/BUILD_LOG.md under "Unit: PHASE-2-W<N>"; commit per task. Use prompt files verbatim. Stop at the end of the week's tasks and print its checklist.
```

### Preconditions
G2 ticked. `docs/PILOT-1.md` exists. Any prompt changes the human approved after the pilot are applied to `packages/ai/prompts/` by the human (with a note in the log) before week 6 starts.

---

#### Week 6 — Path A + multi-paper

**Read:** §5.1 (FR-1.5, 1.6), A.6, §9.1 (`/documents/:id/proposal`).

1. **Path A conversation endpoint** — message history per document (`Document.meta.proposalChat`), A.6 as system prompt, ≤ 3 questions enforced in code (if the model asks a fourth, the server replies with the skeleton instruction), `<gap_check>` injection after turn 1 from an OpenAlex search of the clarified topic (top 8 + total count), `<skeleton>` parsing → same proposal screen as Path B. Done when: E2E completes a 3-turn conversation and lands on an editable skeleton; a unit test proves the 4th question is blocked.
2. **Multi-paper upload** — up to 3 seed papers; extraction per paper; cross-paper pass (A.16 `xpaper.md`, Strong tier, structured: overlaps, contradictions, terminology differences); merged glossary (dedupe by term, keep both definitions if they differ and flag). Done when: two fixture papers produce a merged glossary and at least the planted overlap is flagged (human plants one).
3. **Chooser UI** `/app/new` — Path A vs Path B with one-line explanation each.

Checklist: [ ] Path A skeleton quality judged by the human on 3 topics; [ ] multi-paper flags reviewed.

#### Week 7 — Literature search, gap map, curation, import

**Read:** §5.2 (FR-2.5–2.9), A.7, A.8, §9.2.

1. **Query generation** (A.7) → **search job** — OpenAlex (`/works?search=`, filters: `type:article|preprint|book-chapter`, year ≥ current−15), Semantic Scholar secondary (if key), merge by DOI then normalised title, embedding-similarity relevance filter vs the scope (threshold tuned on fixtures: keep top 60), store as `SearchCandidate` rows under a `runId` (model in PRD §8). Done when: ≤ 1 Strong call per run; results in ≤ 10 s on the fixture scope; log shows counts per stage.
2. **Theme labelling** (A.8, Fast) → gap map JSON on `DocumentMemory.gapMap`; thin = < 4. Done when: gap map renders as a grid with thin themes flagged.
3. **Curation UI** `/app/d/:id/sources` "Discover" tab — per-theme lists, select → `POST …/select` → `Source` rows → index jobs; nothing selected automatically. Done when: E2E selects 3 candidates and they appear in the library with grounding badges.
4. **Path B expansion** (FR-2.8) — for each resolved reference: OpenAlex `cited_by` (top 10) and `related_works`; merged into the same run under theme "Related to your citations". Done when: a Path B fixture document shows the expansion set.
5. **BibTeX/RIS import** (FR-2.9) — parse → resolve pipeline. Done when: a 20-entry `.bib` fixture imports with ≥ 80% resolved.
6. **Sub-theme on sources** — `Source.subTheme` set from the candidate's theme; chunk `subTheme` propagated; retrieval rerank bonus (§10.4) active.

Checklist: [ ] I ran discovery on my own topic and the themes made sense; [ ] nothing entered the library without my click.

#### Week 8 — Templates, outline, document memory, multi-chapter

**Read:** §5.3 (FR-3.1–3.5), §5.4 (FR-4.2), A.9, §9.1 (`/memory/outline`, `/outline/generate`).

1. **Templates** — `STEM_EMPIRICAL`, `QUALITATIVE`, `COMPILATION` chapter skeletons in `packages/config/templates.ts`; picker with system suggestion from `Document.field`. 
2. **Outline generation** (A.9, Strong) with `<gap_map>` and `<extraction>` (Path B mapping + missing chapters) → `OutlineNode[]` validated → `DocumentMemory.outline`; `Chapter` rows created/updated per top-level node (idempotent by `outlineNodeId`). Done when: fixture Path B document yields an outline where `mappedFromPaperSection` is set for the paper's sections and at least "limitations/future work" is added.
3. **Editable tree** — drag/reorder/rename/merge/add/delete with confirmation when a chapter has content; every edit → `PUT /memory/outline` → `Chapter` sync; prompt snapshot test proves the cached block changes after an edit (FR-3.4 AC).
4. **Scaffold panel** (FR-4.2) — scope note + subheadings shown collapsible in the editor; not inserted as text.
5. **Multi-chapter navigation** — left rail from the outline; chapter switch preserves autosave state; word counts per chapter.
6. **Glossary editor** — view/edit terms in memory (add/rename/delete; usage notes). Done when: an added term appears in the next cached block (snapshot test).

Checklist: [ ] I generated an outline for a real student's paper and it needed ≤ 5 edits to be acceptable.

#### Week 9 — Style profile, section commands, automatic-suggest, chat

**Read:** §5.4 (FR-4.6–4.9), A.10, A.11, A.4, §11.3 (`CHAT`, `COMMAND` caps).

1. **Style profile** (A.10) — trigger when `HUMAN` words ≥ 1,500 across the document (computed from provenance counts on save); one Strong call; store `styleProfile`; add to cached block; "Re-learn my style" button. Done when: snapshot shows the profile block after the threshold; a test proves `ASSIST/DRAFT` words are excluded from the count.
2. **Section commands** (A.11) — selection toolbar: expand / formalise / simplify / shorten / consistency; result as a word-level diff with Apply/Discard; provenance `COMMAND`; cap `COMMAND`. Done when: E2E applies "shorten" and citations in the selection survive (assert node count unchanged).
3. **Automatic-suggest opt-in** (FR-4.6) — per-user setting, 800 ms idle trigger with the B.3 conditions; same cap; setting screen explains cost in cap units. Done when: unit test proves no request fires while the user is typing continuously.
4. **AI chat** (A.4) — right-panel tab; SSE; retrieval top 8 with filters (year range, min citations, exclude preprints); cited answers with clickable `{{cite}}` → passage; cap `CHAT`; last 4 turns kept. Done when: E2E asks a question about a pinned paper and the answer contains a citation that opens the passage; a test proves the "library does not contain enough" reply on an off-topic question.
5. **Draft streaming progress** if deferred from week 4.

Checklist: [ ] After I wrote ~1,500 words, suggestions changed voice noticeably (I compared before/after samples in the log).

#### Week 10 — Citations done properly

**Read:** §5.5 (FR-5.2–5.5), A.15, Appendix B.5, §5.8 (FR-8.1 upgrade).

1. **CSL rendering** — `packages/citations`: `Source.cslJson` → citeproc via `@citation-js/core` + CSL plugin; 20 bundled styles (APA 7, IEEE, Harvard, Chicago author-date, Vancouver, MLA, ACM, Springer, Elsevier Harvard, Nature + 10 more chosen by the human; two placeholder "IN_UNIVERSITY_*" variants derived from IEEE/APA until real ones are named). Rendered map (key → label) recomputed on save and style change; numeric ordering across chapters. Done when: golden tests for 5 styles on a 10-source fixture match hand-checked strings.
2. **Style switcher** — document-level; instant re-render via `citationsRerender` meta; export uses the same style. Done when: B.9 test 6 extended to real citeproc output.
3. **Mechanical checks** (FR-5.4) — orphan/unused/untagged-string checks as a list on `/citations`. 
4. **Paste-parse** (A.15) + Crossref verification; imported drafts: on chapter import (`.docx` → ProseMirror), run the untagged-citation regex and offer "Convert to citation" per match with verification. Done when: a pasted APA string becomes a verified citation node; an unverifiable one is shown as "unverified — check manually" and not inserted.
5. **`.docx` export upgrade** — heading styles, numbered headings, citeproc bibliography, list of sources with grounding notes removed.

Checklist: [ ] I switched APA→IEEE→Vancouver on a real chapter and nothing in the body text changed except labels; [ ] bibliography matched the style guide for 3 spot-checked entries.

#### Week 11 — Billing, plans, marketing

**Read:** §5.9 (FR-9.5), §11.6, §2.5 (Jenni billing failures), §12.

1. **Razorpay subscriptions** — plans `STUDENT_MONTHLY`, `STUDENT_ANNUAL`; UPI autopay + cards; webhook handler (idempotent by event id) → `Subscription`; plan → caps; trial → paid upgrade immediate; downgrade at period end; past-due handling (grace 3 days, then `FREE_TRIAL` caps, documents preserved). Done when: webhook fixture tests for `subscription.activated/charged/cancelled/halted` pass; a test-mode subscription upgrades a user's caps.
2. **Anti-Jenni billing hygiene** — renewal reminder email T−3 days; cancel button on `/app/account` (works on mobile width); cancellation confirmation email; refund policy page linked from pricing; invoice PDF per charge. Done when: E2E cancels from a 375 px viewport.
3. **Pricing page + marketing site** — plans (§11.6), caps table, integrity statement (§12.3), FAQ (Jenni comparison in plain words), privacy page (§12.2). 
4. **Usage meter polish** — per-action bars, reset date, "what counts" tooltip.

Checklist: [ ] I paid with a real UPI in test mode and saw caps change; [ ] I cancelled from my phone in one click.

#### Weeks 12–13 — Slack (only if needed)
Finish deferrals; pilot-2 fixes. **Cut order if late:** BibTeX/RIS → cited-by expansion → automatic-suggest → styles beyond 8.

### Gate G3 — human checklist
- [ ] A student went from topic (Path A) to a cited multi-chapter draft with a rendered bibliography — I watched it.
- [ ] Same for Path B from a real paper.
- [ ] Billing live (or test mode with a dated plan to go live); cancel works from a phone.
- [ ] Cost per active user this month within §11 on the dashboard; cache hit ≥ 70%; hallucinated-cite < 1%.
- [ ] Acceptance rate is not lower than the Phase 1 pilot.

---

## PHASE-3 — Thesis-grade (weeks 14–22)

**Target:** 9 weeks · **Maximum:** 12 · **Gate:** G4

### Start prompt (per block)

```
Read docs/PRD.md §0.3, Appendix D (the sub-section for this block), and the sections listed under "Read" for block <N> in docs/PHASES.md → PHASE-3. Read docs/PILOT-1.md and docs/PILOT-2.md if present.
Build only block <N>'s tasks, in order; evidence in docs/BUILD_LOG.md under "Unit: PHASE-3-B<N>"; commit per task. Use prompt files verbatim. Stop at the end of the block and print its checklist.
```

### Preconditions
G3 ticked. The human has: a real university formatting guideline PDF (C.7) and its `template.json`; the coherence fixture thesis planted per C.6; at least one real guide willing to test.

---

#### Block 1 — Coherence engine (weeks 14–16)

**Read:** §5.6, Appendix D.1, A.12.1–A.12.4, C.6, §11.3 (`COHERENCE` cap).

1. **ChapterChunk indexing** — paragraph-aligned ~300-token chunks with PM positions; re-index changed chapters only; HNSW index exists from Phase 0. Done when: a test re-indexes one changed chapter and leaves others' chunks untouched.
2. **Run lifecycle** (D.1.1) — trigger endpoint + autosave debounce (≥ 15 min), changed/related detection, cost pre-estimate with scope reduction > ₹12, flag fingerprinting (replace OPEN, keep RESOLVED/IGNORED, suppress IGNORED fingerprints), SSE progress, `lastCheckedAt`. Done when: unit tests for changed/related selection and fingerprint rules.
3. **CITATION_INTEGRITY** (mechanical) — orphans, unused, retracted, duplicate DOI, untagged strings. Done when: fixture assertions.
4. **TERM_DRIFT** (A.12.1) — term selection (≤ 12, by frequency in changed chapters), sentence gathering (≤ 40, plural/possessive variants), flags with ranges. 
5. **CLAIM_CONTRADICTION** (A.12.2 two-step) — claim extraction ≤ 25 with spans, retrieval top 5 per claim from other chapters, one comparison call per changed chapter, `relatedChapterId`.
6. **UNSUPPORTED_CLAIM** (A.12.3, Fast) — heuristic pre-filter, batches of 40, chapter-role exemptions from the template.
7. **OUTLINE_DRIFT** (A.12.4) — 150-word summary (Fast) + comparison; whole-chapter range.
8. **Sidebar UI** (D.1.3) — grouping, filters, jump with position remapping through versions, Resolve/Ignore/Suggest fix (→ scoped revision, cap `COMMAND`). 
9. **Fixture test** (C.6) — ≥ 5/6 planted detected with correct type+chapter; ≤ 2 false positives; run cost ≤ ₹12 printed. Done when: table in the log.

Checklist: [ ] I ran a check on a real 4+ chapter thesis and at least half the flags were real problems; [ ] run cost in the log.

#### Block 2 — Guide and committee cycle (weeks 17–19)

**Read:** §5.7, Appendix D.2, A.13, A.14, §8 (`GuideShare`, `Comment`), §12.1 (authorisation).

1. **Share + guide role** (D.2.1) — `GuideShare` creation and email; `/guide/:token` → OTP sign-in bound to the share email → `GUIDE` role scoped to that document; read-only editor with comment mode; revocation. Authorisation tests: a guide cannot access any other document, endpoint, or AI action (404). 
2. **Comments** (D.2.2) — `commentAnchor` mark + `Comment` row with `quotedText`; chapter-level comments; re-anchoring on load (exact → whitespace-normalised → 0.85 similarity); pasted-feedback splitter and assignment UI. Done when: a test deletes the mark and the comment re-anchors from `quotedText`.
3. **Classification** (A.13) — on create; stored `class`; `needsHumanRewrite`. 
4. **Scoped revision** (A.14) — target = anchored range → paragraph bounds ± 1; passages top 6; output replaces only the range; `[[NEEDS INPUT]]` handling; snapshot before apply; provenance `COMMAND`; cap `COMMAND` (`SCOPED_REVISION` action label). Substantive comments: button present but never bulk.
5. **Review queue** (D.2.4) — ordering, diff view, Accept/Edit/Reject (reason ≥ 10 chars), `j/k/a/e/r`, "Suggest for all mechanical" with cap preview, "Mark round complete" email, coherence re-run enqueue (`triggeredBy: FEEDBACK`, not cap-counted).
6. **Resolution log + export** (D.2.5) — `.docx` table; sorted by chapter; header fields. Done when: fixture export opens and lists every comment with its outcome.
7. **Notifications** — guide digest (max 1/hour) when new comments arrive from pasted feedback attribution; student email when the guide comments.

Checklist: [ ] A real guide commented on a real draft through the link without my help; [ ] the student resolved ≥ 5 comments in the queue; [ ] the response-to-committee export looked usable.

#### Block 3 — Institution templates, compliance, PDF, polish (weeks 20–21)

**Read:** §5.8, Appendix D.3, C.7, §5.3 (FR-3.6), §4 and FR-9.7 (living gap map), §9.4.

1. **Template spec + seed** (D.3.1) — validate `InstitutionTemplate.spec` with Zod; seed the human-written `template.json` from C.7 alongside `EXAMPLE_IN_UNIVERSITY`; export banner when the example template is selected.
2. **Thesis details form** — `Document.meta` fields for front matter.
3. **Export pipeline** (D.3.2) — front matter generation, styled body, heading/figure/table numbering, citeproc in the template style, TOC/LOF/LOT fields, appendices, Gotenberg PDF, last-5 retention. Done when: the coherence fixture thesis exports to `.docx` and PDF with the real template; page setup asserted on the docx XML.
4. **Compliance checklist** (D.3.3) — all ten checks; blocks PDF (not docx) until fixed or overridden with a logged reason. Done when: fixture passes all checks; each check has a negative test.
5. **Per-section outline regeneration** (FR-3.6) — sibling context; A.9 constrained to one node.
6. **Living gap map** (flag `livingGapMap`) — recomputed on library change; panel in Sources.

Checklist: [ ] I exported a real thesis with the real template and compared it against the university guideline page by page.

#### Block 4 — Institution admin and hardening (week 22)

**Read:** §5.9 (FR-9.6), §8 (`Institution`), §11.3 (`INSTITUTION_SEAT`), §7.5.

1. **Institution admin** — create institution, invite students by email (seat count enforced), usage by student (no document content), invoice PDF per period, default template per institution.
2. **`.docx` comment import** (FR-7.3) if time: parse `word/comments.xml` + anchors → `Comment` rows via re-anchoring.
3. **Hardening** — load test rerun with real feature mix; backup drill; dependency audit; a `docs/RUNBOOK.md` (deploy, rollback, restore, rotate keys, scale worker to a second VPS per §7.5 step 2).

#### Weeks 23–25 — Slack (only if needed)
**Cut order if late:** living gap map → `.docx` comment import → per-section regeneration → institution invoices (manual).

### Gate G4 — human checklist
- [ ] First thesis exported through the platform and **accepted for submission** by a university (or its formatting office).
- [ ] Coherence fixture: ≥ 5/6 detected, ≤ 2 false positives (log table).
- [ ] A guide completed a full review round end-to-end.
- [ ] Compliance checklist passes on the fixture thesis with the real template.
- [ ] Cost per active user still within §11 with Phase 3 features on; `COHERENCE` and `COMMAND` caps holding.
- [ ] `docs/RUNBOOK.md` exists and I have followed the rollback procedure once.

---

## BUILD_LOG.md template (copy to docs/BUILD_LOG.md in Phase 0)

Append-only. One section per unit, one entry per task. Newest at the bottom. Evidence is a pasted command and its trimmed output — never a description.

---

### Unit: PHASE-0 — Scaffold
Started: YYYY-MM-DD · Sessions: N

#### Task 0.1 — Monorepo skeleton
- Status: DONE | BLOCKED | UNSURE
- Commit: `abc1234 chore: scaffold monorepo`
- Evidence:
  ```
  $ pnpm -r list --depth -1
  apps/api  apps/web  apps/worker  packages/ai ... 
  $ pnpm biome check .
  Checked 42 files in 120ms. No fixes needed.
  ```
- Notes / deviations from PRD: none
- UNSURE: —

#### Task 0.2 — …

#### Gate G0 — agent's self-check (human ticks the real one in the unit file)
- [ ] CI green — evidence link
- [ ] …

---

### Unit: PHASE-1-W1 — Editor spike
…
