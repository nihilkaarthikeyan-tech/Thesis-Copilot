# Thesis Copilot — Build log

Append-only. One section per unit, one entry per task. Newest at the bottom.
Evidence is a pasted command and its trimmed output — never a description (PRD §0.3 rule 2).

---

## Unit: PHASE-0 — Scaffold
Started: 2026-09-04 · Sessions: 1

### Task 0.1 — Monorepo skeleton
- Status: DONE
- Evidence:
  ```
  $ pnpm install
  devDependencies:
  + @biomejs/biome 2.5.12
  + turbo 2.10.12
  + typescript 5.9.3
  Done in 1m 10.6s using pnpm v9.15.9

  $ pnpm biome check .
  Checked 31 files in 9ms. No fixes applied.

  $ pnpm -r list --depth -1
  thesis-copilot D:\Thesis Copilot (PRIVATE)
  @tc/api@0.1.0        apps/api
  @tc/web@0.1.0        apps/web
  @tc/worker@0.1.0     apps/worker
  @tc/ai@0.1.0         packages/ai
  @tc/citations@0.1.0  packages/citations
  @tc/config@0.1.0     packages/config
  @tc/db@0.1.0         packages/db
  @tc/export@0.1.0     packages/export
  @tc/retrieval@0.1.0  packages/retrieval
  @tc/types@0.1.0      packages/types
  @tc/ui@0.1.0         packages/ui
  ```
- Notes / deviations from PRD:
  - Toolchain checked before pinning (§0.3 rule 1). Node v24.18.0, pnpm 9.15.9, Docker 29.5.3.
  - Versions pinned to the newest release inside each major the PRD fixes in §7.2:
    Next 15.5.25, React 19.2.0, NestJS 11.2.3, Fastify 5.12.3, Prisma 6.19.3, TypeScript 5.9.3,
    Biome 2.5.12, Turborepo 2.10.12, Vitest 4.1.11, Tailwind 4.3.3, BullMQ 5.81.4, zod 4.5.4.
    Newer majors exist (TypeScript 7, Next 16, NestJS 12, Prisma 8, vitest 5) and were NOT taken:
    §7.2 fixes the majors and §0.3 rule 6 says prefer boring. Changing a major needs an ADR.
  - `ai` 7.0.92 + `@ai-sdk/anthropic` 4.0.49 declare peer `zod: ^3.25.76 || ^4.1.8`; zod 4.5.4 satisfies it.
  - Dev Compose ports are shifted off the defaults (Postgres 5434, Redis 6381, MinIO 9002/9003,
    Gotenberg 3002) because this machine already runs other projects' containers on 5432/6379/9000.
  - `pnpm install` prints a node-gyp warning for `ssh2` (an optional native crypto binding pulled in by
    testcontainers). It is optional, the install completes, and testcontainers falls back to pure JS.
- UNSURE: —

### Task 0.2 — `CLAUDE.md` and docs
- Status: DONE
- Evidence:
  ```
  $ wc -l CLAUDE.md
  101 CLAUDE.md                      # limit is 150 (PRD §0 rule 7)

  $ diff <(sed -n '1831,1936p' docs/PRD.md) <(tail -n +11 docs/ADR/0001-editor.md) \
      && echo "VERBATIM MATCH OK"
  VERBATIM MATCH OK — Appendix B copied byte-for-byte

  $ ls docs docs/ADR fixtures/papers
  docs:     ADR  BUILD_LOG.md  CONSISTENCY_REVIEW.md  PHASES.md  PRD.md
  docs/ADR: 0001-editor.md
  fixtures/papers: README.md
  ```
- Notes / deviations from PRD:
  - The two spec files were delivered as `PRD_1.md` and `PHASES.md` at the repo root; moved to
    `docs/PRD.md` and `docs/PHASES.md` so the paths in PHASES.md's own start prompts resolve.
  - `docs/CONSISTENCY_REVIEW.md` is the discrepancy log required by PHASES.md's preamble
    ("the PRD wins and the discrepancy is logged"). It lists 11 places where the PRD contradicts
    itself and PHASES had to pick a side. These need human decisions; none block Phase 0.
  - Added `.gitattributes` with `* text=auto eol=lf`. Reason: this is a Windows checkout and the
    Appendix A prompt files must stay byte-identical to the PRD (§0.3 rule 11); CRLF churn would
    break that.
- UNSURE: —

### Task 0.3 — `packages/config`
- Status: DONE
- Evidence:
  ```
  $ pnpm --filter @tc/config test
   Test Files  2 passed (2)
        Tests  60 passed (60)

  Monthly budget for a fully active STUDENT_MONTHLY user (PRD 11.4)
  | Item                                           |       Cap x unit |      INR |
  |------------------------------------------------|------------------|----------|
  | Assist                                         |     180 x 0.1803 |    32.45 |
  | Draft                                          |      10 x 2.7144 |    27.14 |
  | Citation suggestions                           |      30 x 0.3393 |    10.18 |
  | Chat                                           |      15 x 0.5133 |     7.70 |
  | Commands                                       |       5 x 1.2789 |     6.39 |
  | Coherence                                      |       1 x 5.8725 |     5.87 |
  | One-time ops amortised over 4 months           |                  |     2.94 |
  | Hosting share (>= 500 users)                   |                  |     7.00 |
  |------------------------------------------------|------------------|----------|
  | TOTAL                                          |                  |    99.67 |

  Ceiling: INR 100/user/month (PRD 11). WITHIN by INR 0.33.

  $ pnpm --filter @tc/config typecheck
  (no output — clean)
  ```
- Notes / deviations from PRD:
  - **The real budget is ₹99.67, not the ₹95.8 printed in §11.4. Headroom is ₹0.33, not ₹4.20.**
    Appendix E.1 step 5 and E.2 both require the budget to be *derived* from `plans.ts` × `pricing.ts`
    rather than read off the §11.2 ₹ column, and the derived unit costs come out above the PRD's
    rounded ones. Per-action, derived vs printed:
    ASSIST 0.1610/0.15 (+7.3%), CITE 0.3393/0.30 (+13.1%), CHAT 0.5133/0.50 (+2.7%),
    DRAFT 2.7144/2.50 (+8.6%), COMMAND 1.2789/1.20 (+6.6%), COHERENCE 5.8725/6.00 (-2.1%),
    EXTRACT 5.742/5.70, OUTLINE 4.176/4.00, STYLE 1.305/1.30, EMBED 0.522/0.50.
    The check still passes, but any upward price move breaks the ₹100 ceiling immediately.
    Appendix E.4 lists the levers; turning `draftModeStrongTier` off is the largest.
    **This needs the owner's attention before the pilot** — it is a real reduction in margin, not a
    rounding quibble.
  - §11.2 prices Assist at "0.15 (0.18 avg incl. cache misses)" and §11.4 bills 0.18. A prompt cache
    is written once per session and read many times, so the write amortises. That is modelled as
    `pricing.assistCacheMissUplift = 1.12`, applied to Assist only, which is exactly what §11.4 does.
    Applying the same uplift to every cached action instead would total ₹105.85 and fail the ceiling.
    `UNSURE:` whether low-frequency cached actions (10 drafts/month) really achieve a cache hit at
    all, since the provider cache TTL is minutes. If they do not, Draft costs more than modelled here.
    Resolved by the real `cachedInputTokens` numbers in `AiCallLog` once week 4 telemetry runs.
  - PRD §11.3 gives cap rows for six actions; Appendix E.2 demands every `AiAction` have a cap in
    every plan. Both cannot hold (the enum has 14 members). Resolved as PHASES 0.3 directs, with an
    explicit `UNMETERED_ACTIONS` list, and the E.2 test asserts the two lists partition the enum
    exactly. Logged as item 10 in docs/CONSISTENCY_REVIEW.md.
  - §13.3 does not mark `GOOGLE_*`, `RAZORPAY_*` or the email variables optional, but §0.2 says the
    app must refuse to start without a required variable, and Razorpay does not ship until Phase 2
    week 11. Resolved by making them conditionally required: the Google pair and the Razorpay triple
    must be all-set or all-unset, and a mail transport is required only when `NODE_ENV=production`.
    Needs human sign-off (§0.3 rule 4); logged as item 11 in docs/CONSISTENCY_REVIEW.md.
  - `AI_FAST_MODEL`, `AI_STRONG_MODEL` and `AI_EMBED_MODEL` are required with no default, so the app
    cannot start on a guessed model id (§0.3 rule 5). `.env.example` ships them blank on purpose.
  - zod 4 API confirmed by spike before use (§0.3 rule 1): `error.issues`, `ctx.addIssue({code:'custom'})`,
    `z.coerce.number()`, `z.email()`.
- UNSURE: see the cache-hit note above.

### Task 0.4 — `packages/db`
- Status: DONE
- Evidence:
  ```
  $ pnpm --filter @tc/db run migrate
  1 migration found in prisma/migrations
  Applying migration `0001_init`
  All migrations have been successfully applied.

  $ docker exec -i thesis-copilot-dev-postgres-1 psql -U tc -d tc -c "\dx"
     Name   | Version |   Schema   |                     Description
  ----------+---------+------------+------------------------------------------------------
   pgcrypto | 1.3     | public     | cryptographic functions
   plpgsql  | 1.0     | pg_catalog | PL/pgSQL procedural language
   vector   | 0.8.6   | public     | vector data type and ivfflat and hnsw access methods

  $ psql -c "SELECT uuid_generate_v7();"
   01a06ce6-a663-77c6-a07e-2a851dd72f55

  $ psql -c "SELECT indexname FROM pg_indexes WHERE indexname LIKE '%hnsw%';"
   source_chunk_embedding_hnsw    (m='16', ef_construction='64')
   chapter_chunk_embedding_hnsw

  $ psql -c "SELECT count(*) FROM information_schema.tables
             WHERE table_schema='public' AND table_type='BASE TABLE';"
   23

  $ pnpm --filter @tc/db run seed
  user       SUPERADMIN  admin@example.com  (01a06ce7-6a2b-79b8-af8d-5490357d97f4)
  flag       automaticSuggest      false # Opt-in, ships Phase 2 week 9 (FR-4.6)
  flag       grobid                false # Off until the Phase 2 quality review (FR-1.7, §17 #8)
  flag       draftModeStrongTier   true  # Draft on the Strong tier (§10.1, A.2)
  flag       livingGapMap          false # Phase 3 (§4)
  template   EXAMPLE_IN_UNIVERSITY  (01a06ce7-6a49-774e-8410-757d89a38f97)
  Seed complete.

  # run twice — idempotent
  $ psql -c "SELECT (SELECT count(*) FROM \"User\") users,
                    (SELECT count(*) FROM \"FeatureFlag\") flags,
                    (SELECT count(*) FROM \"InstitutionTemplate\") templates;"
   users | flags | templates
   ------+-------+-----------
       1 |     4 |         1

  $ pnpm --filter @tc/db test
   Test Files  1 passed (1)   Tests  2 passed (2)      # AiAction parity with packages/config
  ```
- Notes / deviations from PRD:
  - `pg_uuidv7` was **checked, not assumed** (§0.3 rule 1). The `pgvector/pgvector:pg16` image ships
    `vector` but not `pg_uuidv7`, so §8's alternative was taken and `uuid_generate_v7()` is written
    in plain SQL. `pgcrypto` is enabled for `gen_random_bytes`.
    First implementation was wrong — it produced version `0` and a bad variant nibble. Caught by
    asserting on the output rather than trusting it. Verified after the fix over 5,000 rows:
    version nibble `7`, variant in `8|9|a|b`, all unique, and ordered across milliseconds.
  - `schema.prisma` is PRD §8 verbatim except for syntax: the PRD compresses `generator`,
    `datasource` and every `enum` onto one line with semicolons, which Prisma cannot parse. Field
    names, types, attributes, defaults, relations, indexes and comments are untouched.
  - `InstitutionTemplate.spec` for the seed uses the **Appendix D.3.1** shape (`marginsMm`, `sizePt`,
    object captions), not the §9.4 shape (`margins`, `size`, string captions), as PHASES 0.4
    directs. The PRD gives two incompatible shapes and the model comment points at §9.4.
    Item 3 in docs/CONSISTENCY_REVIEW.md — needs a human decision before the export work in Phase 2.
  - Prisma resolves `.env` next to its own package, not the workspace root, so the `@tc/db` scripts
    run through `dotenv-cli` with `-e ../../.env`. Added `dotenv-cli@11.0.0`.
  - `infra/compose/docker-compose.dev.yml` was written here rather than in task 0.9, because 0.4's
    verification requires a running Postgres. The rest of 0.9 is still outstanding.
    MinIO rejects a root user shorter than 3 characters, so the dev credentials are
    `tcadmin` / `tc-secret-key`; `.env.example` matches.
  - `.env.example` was rewritten to put every comment on its own line. Trailing comments after a
    value are kept verbatim by some parsers, which would have put "# Postgres 16 + pgvector..."
    inside `DATABASE_URL`.
- UNSURE: —

### Task 0.5 — `packages/ai`
- Status: DONE, except the live half of `pnpm ai:verify` — see BLOCKED below.
- Evidence:
  ```
  $ ls packages/ai/prompts | wc -l
  21

  $ pnpm --filter @tc/ai test
   Test Files  2 passed (2)
        Tests  48 passed (48)
  # includes one test per prompt file asserting it still matches the PRD byte for byte

  $ pnpm --filter @tc/ai typecheck
  (no output — clean)

  $ pnpm ai:verify          # AI_PROVIDER=mock, EMBED_PROVIDER=mock
  ==============================================================================================
  pnpm ai:verify — PRD Appendix E.1
  ==============================================================================================
  !! A provider is set to `mock`. This run proves nothing about real model ids or
  !! prices, and Appendix E.3 must NOT be filled from it.
  ...
  | TOTAL                                          |                  |    99.67 |
  Ceiling: INR 100/user/month (PRD 11). WITHIN by INR 0.33.
  OK: STUDENT budget INR 99.67 <= INR 100.
  ```
- BLOCKED: no provider API keys. PHASES PHASE-0 "Preconditions (human)" requires keys for the LLM
  provider, the embeddings provider and Resend/SMTP. None were supplied, so `pnpm ai:verify` has
  never made a real call. Steps 2 and 3 of Appendix E.1 (probe each model, check the embedding
  length against `EMBED_DIMS`) are therefore unproven, and **PRD Appendix E.3 must stay empty**.
  The script refuses to pretend: when either provider is `mock` it prints a banner saying the run
  proves nothing and that E.3 must not be filled from it.
  To unblock: put real `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `AI_FAST_MODEL`, `AI_STRONG_MODEL`
  and `AI_EMBED_MODEL` in `.env`, set `AI_PROVIDER=anthropic` and `EMBED_PROVIDER=voyage`, and run
  `pnpm ai:verify` again. Gate G0 cannot be ticked until then.
- Notes / deviations from PRD:
  - **Appendix A is not uniformly machine-readable, and the Phase 1 week 3 prompt builder must know
    it.** Only A.1 (`assist`) and A.2 (`draft`) put their user message in a second fenced block.
    The other 19 fence the system block only and describe the user message in prose — A.3 for
    example says: User message: `<sentence>{{sentence}}</sentence>` followed by the `<passages>`
    block. So 19 user templates have to be written as code against the prose spec rather than
    loaded from the file. That is a judgement call the PRD does not make explicit; task 3.2 should
    treat it as a decision to confirm. The shape is pinned by a test so it cannot drift silently.
  - Prompt files are produced by `scripts/extract-prompts.ts` and never by hand. Each file is the
    Appendix A subsection verbatim under a do-not-edit header. `test/prompts.spec.ts` re-runs the
    extraction against the current PRD and asserts every file still matches, which enforces
    §0.3 rule 11 mechanically instead of by good intentions.
  - `LlmChunk` and `LlmResult<T>` are named in §10.2 but never defined there. Defined in
    `src/types.ts`: `LlmChunk` is a text delta or a single terminal `finish` carrying usage;
    `LlmResult<T>` is the parsed value plus usage. The finish chunk is the only source of token
    counts, which is what §11.5 requires (cost from real usage, never estimates).
  - AI SDK v7 API checked in `node_modules` before use (§0.3 rule 1): `streamText`, `generateObject`,
    and `LanguageModelUsage.inputTokenDetails.{noCacheTokens,cacheReadTokens,cacheWriteTokens}`,
    which map one-to-one onto the four numbers `packages/config` prices.
  - `generateObject`'s return type is conditional on the inferred schema output and cannot resolve
    through a generic `z.ZodType<T>`. The options are cast at that one call site, and the result is
    then validated with `req.schema.safeParse`, so nothing downstream trusts the cast and a schema
    mismatch becomes a typed `LlmValidationError` the caller can retry on (A.5 retries once).
  - Voyage has no first-party AI SDK provider, so `VoyageEmbeddingProvider` calls the REST API
    directly. It stays inside `packages/ai`, so §0.2's no-vendor-SDK-in-product-code rule holds. It
    throws rather than truncating if the returned dimension differs from `EMBED_DIMS`, because the
    column is `vector(1024)`.
  - Bug found and fixed in `packages/config`: a blank `SMTP_PORT=` in a .env file arrives as `''`,
    which `z.coerce.number()` turned into `0` and then rejected, so the app refused to start on a
    valid file. Now blanked to `undefined` first. Caught by running `pnpm ai:verify`, not by the
    original tests; a regression test was added.
- UNSURE: —

### Task 0.6 — `apps/api`
- Status: DONE
- Evidence:
  ```
  $ pnpm --filter @tc/api test
   Test Files  2 passed (2)
        Tests  20 passed (20)

  # the test PRD §15 names, run against a real Postgres in Testcontainers:
   ✓ 20 parallel calls at cap−1 let exactly 1 through (PRD §15)          81ms
   ✓ 20 parallel calls from empty never exceed the cap                    46ms
   ✓ a refusal reports the cap and when it resets                         17ms
   ✓ refuses a zero cap without creating a ledger row                      9ms
   ✓ keeps separate counters per action / per month
   ✓ refunds a unit when the provider failed / never refunds below zero
   ✓ holds under concurrency: 50 parallel requests let exactly `max` through

  $ curl -s http://localhost:3001/api/v1/health          # HTTP 200
  {"status":"ok","uptimeSeconds":11,"checks":{
    "database":{"status":"up","latencyMs":4},
    "redis":{"status":"up","latencyMs":1},
    "objectStorage":{"status":"up","latencyMs":12},
    "aiProvider":{"status":"up","latencyMs":0}}}

  $ curl -s http://localhost:3001/api/v1/flags
  {"automaticSuggest":false,"grobid":false,"draftModeStrongTier":true,"livingGapMap":false}

  $ curl -s http://localhost:3001/api/v1/admin/cost-model
  {"verified":false,"banner":"Cost model: UNVERIFIED — run `pnpm ai:verify` with real provider keys
   and fill PRD Appendix E.3.","projectedMonthlyInr":99.67,"ceilingInr":100,"withinCeiling":true}

  $ curl -s http://localhost:3001/api/v1/nope            # RFC 9457 problem details
  {"type":"HTTP_ERROR","title":"NOT_FOUND","status":404,"detail":"Cannot GET /api/v1/nope",
   "instance":"/api/v1/nope","requestId":"0fa383b2-8a9f-4600-b2df-5f6d0086710b"}

  # rate limit: 25 requests to /api/v1/auth/* in one minute
  $ for i in $(seq 1 25); do curl -s -o /dev/null -w "%{http_code} " .../auth/methods; done
  200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 200 429 429 429 429 429

  $ curl -s http://localhost:3001/metrics | head
  hallucinated_cite_total 0        # plus the rest of §14's metric names
  ```
- Notes / deviations from PRD:
  - **`tsx` cannot run a NestJS app.** It strips types with esbuild, which does not implement
    `emitDecoratorMetadata`, so every constructor parameter arrives as `undefined` and Nest reports
    "Nest can't resolve dependencies ... appears to be undefined". Found by running the app, not by
    typechecking. The API is therefore compiled with `tsc` and run as `node dist/main.js`, and every
    workspace package now emits `dist/` JavaScript with `main`/`types` pointing at it. That is the
    shape §13.4's multi-stage Dockerfile needs anyway, so it is not extra work, but it is a change
    to how the repo builds and is worth knowing before task 0.9.
  - **Injection tokens must not live in module files.** `ENV` in `config.module.ts` and `AUTH` in
    `auth.module.ts` created ESM import cycles that resolve to `undefined` at runtime rather than
    failing at build time. Both moved to their own files (`common/env.token.ts`,
    `modules/auth/auth.tokens.ts`).
  - **`@fastify/rate-limit` was removed.** Its `createRateLimit` decorator ignored the per-call
    `max`/`timeWindow`: the Redis key came out as `fastify-rate-limit-undefinedundefined-127.0.0.1`
    and every request was refused with 429, including the first. Replaced with ~40 lines in
    `common/rate-limit.ts` — a fixed-window `INCR` + `EXPIRE NX` pipeline, keyed per user or IP,
    failing open when Redis is down. §0.3 rule 6: prefer boring. It is covered by tests including a
    50-way concurrency case, which the plugin never was.
  - PRD §12.1 asks for rate limiting on "auth and AI endpoints". Only auth exists in Phase 0; the
    same helper is applied to the AI endpoints when they land in week 3.
  - `fastify` is pinned to 5.11.3 to match what `@nestjs/platform-fastify@11.2.3` depends on. Two
    copies in the tree meant plugin type augmentations landed on a different `FastifyInstance` than
    the app used, and the errors were unreadable. A `pnpm.overrides` entry keeps it single.
  - Health checks the AI provider by reachability only, never a completion: a health check must not
    cost money or consume a cap.
  - `@All('*path')` is not a valid Fastify 5 route; the wildcard must be bare `*`.
- UNSURE: —

### Task 0.7 — `apps/worker`
- Status: DONE
- Evidence:
  ```
  $ pnpm --filter @tc/worker test
   Test Files  1 passed (1)
        Tests  4 passed (4)
   ✓ retries three times with exponential backoff
   ✓ keeps failed jobs, so the failure-rate alert in §14 has something to count
   ✓ is retried three times and then lands in the failed set
   ✓ a job that succeeds completes on the first attempt

  $ pnpm --filter @tc/worker run start:local
  {"level":30,"msg":"worker ready","queues":["noop"],"concurrency":4}
  ```
- Notes / deviations from PRD:
  - One queue only, named `noop`, as PHASES 0.7 specifies. The real queue names are taken from
    PRD §9 when the work lands: `extract-paper`, `index-source`, `search-literature` and
    `draft-section`. No other queue name is invented here.
  - Retry policy is 3 attempts with exponential backoff from 1s. `removeOnFail` keeps failed jobs
    for 7 days: PRD §14 alerts on a job failure rate above 5% over 15 minutes, which is impossible
    to compute if failures are discarded.
  - The worker holds no state the API also needs, so PRD §7.5 step 2 (move it to a second VPS) needs
    no code change.
- UNSURE: —

### Task 0.8 — `apps/web`
- Status: DONE
- Evidence (browser, driven end to end against the running API — not curl):
  ```
  # Next.js dev server log while the flow ran
  ✓ Compiled /sign-in in 1448ms (839 modules)          GET /sign-in 200
  ✓ Compiled /app in 840ms (820 modules)               GET /app 200
  ✓ Compiled /app/d/[id]/write/[chapterId] in 949ms    GET /app/d/01a06d13-…/write/first 200

  # 1. /sign-in: typed student2@example.com, clicked "Email me a code"
  page text → "We sent a code to student2@example.com. Six-digit code  Sign in"
  # API log (dev prints the OTP instead of emailing it)
  [auth] one-time code for student2@example.com (sign-in): 858168
  # API request log, origin http://localhost:3000
  OPTIONS /api/v1/auth/email-otp/send-verification-otp 204
  POST    /api/v1/auth/email-otp/send-verification-otp 200

  # 2. typed 858168, clicked "Sign in" → landed on /app
  page text → "Your theses … No theses yet. Create one above."
  GET /api/v1/documents 200  (session cookie sent by the browser)

  # 3. typed a title, clicked "Create thesis"
  POST /api/v1/documents 201 → GET /api/v1/documents 200
  page text → "Low-cost solar dryers for smallholder farms  From a paper · updated 9/4/2026, 9:09:21 PM"
  link href → /app/d/01a06d13-1088-765f-a575-0341b9c75575/write/first

  # 4. clicked the thesis
  title → "Editor — coming in week 1 · Thesis Copilot"
  page text → "Document 01a06d13-1088-765f-a575-0341b9c75575, chapter first. The TipTap editor …"

  # browser console: no errors during the whole flow

  $ psql … SELECT u.email, substring(u.id::text,15,1) user_v7, d.id, substring(d.id::text,15,1) doc_v7, …
   student2@example.com | 7 | 01a06d13-1088-765f-a575-0341b9c75575 | 7 | … | B_PAPER | has_memory=t
  $ psql … sessions per user
   student2@example.com sessions=1

  # session cookie as stored by curl in the API-level run of the same flow:
  #HttpOnly_localhost  FALSE  /  FALSE  1791127958  better-auth.session_token  u9Xd3fr0c4Uv...
  #   → HttpOnly, as PRD §12.1 requires

  $ pnpm --filter @tc/web build
  Route (app)                              Size  First Load JS
  ┌ ○ /                                   165 B        106 kB
  ├ ○ /app                              2.29 kB        129 kB
  ├ ƒ /app/d/[id]/write/[chapterId]       165 B        106 kB
  └ ○ /sign-in                          2.16 kB        125 kB

  $ pnpm --filter @tc/web typecheck      # clean
  ```
- Notes / deviations from PRD:
  - **PRD §8 cannot run Better Auth; ADR-0002 adds what it needs.** §7.2 fixes Better Auth as the
    auth layer, but the "verbatim" §8 schema has no `Session`/`Account`/`Verification` tables and
    `User` lacks `emailVerified`/`image`/`updatedAt`. Migration `0002_better_auth` adds exactly those,
    with shapes read from `getAuthTables()` in better-auth@1.7.2 for this config rather than from
    memory. Every §8 column is untouched. Written up in `docs/ADR/0002-better-auth-tables.md` and
    logged as item 12 in docs/CONSISTENCY_REVIEW.md. **Needs the owner's acknowledgement (§0.3 rule 4).**
  - Better Auth generates its own random-string ids by default; on a UUID column Postgres refused
    them ("Error creating UUID, invalid character … found `r`"). Set `advanced.database.generateId:
    false` so the adapter omits `id` and `uuid_generate_v7()` applies — verified in the adapter
    source (`unsafeData.id = void 0`) and by the new user's id having a `7` version nibble (§0.2).
  - Model naming needed no mapping: the adapter's `prisma.verification.create()` in the error trace
    is Prisma's own camelCase delegate for the PascalCase `Verification` model.
  - `GET /documents` (list) is not in PRD §9.1, which has no list route; the document list screen in
    §6.1 needs one. Added, scoped by `ownerId` (§12.1). Every document is created together with its
    `DocumentMemory` row so nothing downstream handles its absence.
  - `next build` must run with `NODE_ENV=production`. The shared root `.env` says `development` for
    the API and worker, and that leaked in through dotenv and broke Next's `/_error` prerender
    ("<Html> should not be imported"). The web `build`/`start` scripts now pass `-v NODE_ENV=production`.
  - **Biome nearly broke the API twice.** (a) `biome check --write` rewrote `import { PrismaService }`
    into `import type { … }` in the Nest services (rule `style/useImportType`); a type-only import
    emits no runtime reference, Nest's decorator metadata sees `Function`, and boot fails with
    "can't resolve dependencies … appears to be undefined". Found only by booting the app. Rule now
    off for `apps/api/**` and `apps/worker/**`. (b) Biome could not parse constructor-parameter
    decorators at all, so two API files were never linted; `unsafeParameterDecoratorsEnabled` is
    now on. Tailwind's `@theme` also needed `css.parser.tailwindDirectives`.
  - The cap-concurrency test applied only migration 0001 to its container; after 0002 the generated
    client sent `emailVerified` and every test failed in `beforeEach`. It now applies every migration
    in order, so it can never diverge from what `prisma migrate deploy` runs.
  - Driving the form with a programmatic value set bypassed React's change handler, so the submit
    stayed disabled; real keystrokes were required. Not a product bug — noted so the week-1 Playwright
    E2E types rather than sets values.
  - shadcn/ui "base" is `components.json`, `cn()` and one Button in the new-york style; the rest
    arrives with the screens that need it.
- UNSURE: —

### Task 0.9 — `infra/`
- Status: DONE locally; three DoD items are BLOCKED on things only the human can supply — see below.
- Evidence:
  ```
  # --- backup + restore drill (PRD §12.1), run inside the dev Postgres container ---
  $ bash backup.sh
  [backup] 20260904T161621Z pg_dump -> /tmp/backups/tc-20260904T161621Z.dump
  [backup] dump complete (60K)
  [backup] BACKUP_S3_* not set — dump kept locally only (fine for dev, NOT for production)
  $ bash restore.sh --test
  [restore] test-restoring /tmp/backups/tc-20260904T161621Z.dump into scratch database tc_restore_test_20260904161622
  [restore] restored. row counts in the scratch database:
  [restore]   User=3 Document=2 FeatureFlag=5 InstitutionTemplate=1 UsageLedger=0 migrations=2 uuid_v7=7
  [restore] scratch database dropped. RESTORE TEST OK
  $ psql ... live: User=3 Document=2 scratch_dbs_left=0        # live DB untouched

  # --- images (PRD §13.4: multi-stage, node:22-alpine, non-root, tini) ---
  $ docker images | grep tc-
  tc-api:latest     2.03GB     tc-web:latest   349MB     tc-backup:latest   72.8MB
  $ docker run --rm tc-api sh -c 'id; node packages/db/node_modules/prisma/build/index.js --version'
  uid=1001(app) gid=101(app)      prisma 6.19.3     Computed binaryTarget: linux-musl-openssl-3.0.x
  $ docker run --rm tc-backup sh -c 'pg_dump --version; mc --version; cat /etc/crontabs/root'
  pg_dump (PostgreSQL) 16.14 · mc RELEASE.2025-08-13 · 30 2 * * * backup.sh · 30 3 * * 0 restore.sh --test

  # --- the image does what deploy.sh asks of it, against the dev services ---
  $ docker run --rm ... tc-api node packages/db/node_modules/prisma/build/index.js migrate deploy --schema ...
  2 migrations found in prisma/migrations
  No pending migrations to apply.
  $ docker run -d ... -p 3101:3001 tc-api ; curl http://localhost:3101/api/v1/health
  {"status":"ok","checks":{"database":"up","redis":"up","objectStorage":"up","aiProvider":"up"}}   HTTP 200
  $ docker run --rm ... tc-api node apps/worker/dist/main.js
  {"level":30,"msg":"worker ready","queues":["noop"],"concurrency":4}
  $ docker run -d -p 3100:3000 tc-web ; curl http://localhost:3100/
  GET / -> HTTP 200   <h1 ...>Thesis Copilot

  # --- the CI steps, run locally ---
  $ pnpm --filter @tc/web e2e                                   # Playwright smoke
  5 passed (10.2s)
  $ DATABASE_URL=... node packages/db/scripts/migrate-diff-check.mjs
  migrate-diff-check: 2 allowlisted statement(s) (HNSW indexes, PRD §8)
  migrate-diff-check: OK — migrations and schema.prisma agree
  $ pnpm audit --audit-level=high ; echo $?
  4 vulnerabilities found   Severity: 4 moderate        exit 0
  $ pnpm biome check .   -> clean      $ typecheck (6 packages) -> 0 errors
  ```
- BLOCKED (human preconditions, PHASES PHASE-0 "Preconditions"):
  - **CI green on `main`** — the workflows are written and every step was run locally, but nothing
    has been pushed. I do not push without being asked. Push `main` and the `ci` workflow runs.
  - **A tag deploys to the VPS; `https://<domain>/api/v1/health` 200 over TLS** — there is no VPS,
    domain or GHCR org yet. `release.yml` + `infra/scripts/deploy.sh` are ready; they need the
    secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `DOMAIN`, `NEXT_PUBLIC_API_URL` and an
    `infra/compose/.env` on the box (template: `infra/compose/.env.production.example`).
  - The restore drill was done locally (above), which satisfies "restored a backup into a scratch
    database once"; the off-site `mc mirror` half needs `BACKUP_S3_*` credentials.
- Notes / deviations from PRD:
  - **The Playwright smoke cannot cover the editor yet.** PRD §13.5 names it "editor loads,
    suggestion streams against a mocked provider"; the editor is Phase 1 week 1 and must not be
    started before Gate G0. The Phase 0 smoke covers what exists (home, sign-in, `/app` redirect,
    health, problem-details) and week 1 extends it (Appendix B.9 test 9). Stated in
    `apps/web/playwright.config.ts`.
  - **`prisma migrate diff --exit-code` can never pass on this schema**, because Prisma cannot
    declare an index on an `Unsupported("vector")` column and PRD §8 puts the two HNSW indexes in
    a hand-written migration. CI therefore runs `packages/db/scripts/migrate-diff-check.mjs`, which
    allowlists exactly those two `DROP INDEX` statements and fails on anything else. It caught a
    real drift on its first run: `Verification.updatedAt` had a DB default in migration 0002 but
    not in the schema. Fixed in the schema (`@default(now()) @updatedAt`, same as `User`).
  - **`pnpm audit --audit-level=high` failed** with 3 high advisories: `postcss` (two path
    traversal / file read CVEs, pulled in by `next` via `better-auth`) and `deepmerge-ts`
    (stack exhaustion, pulled in by the `prisma` CLI). Both fixed with `pnpm.overrides` to the
    patched versions (`postcss >=8.5.18`, `deepmerge-ts >=8.0.0`); Prisma generate / migrate /
    diff and the Next build were re-run afterwards and work. 4 moderate advisories remain, below the
    PRD's threshold. UNSURE: whether the `deepmerge-ts` 8 override survives a future Prisma 6.x
    patch that pins 7.x — CI will say so.
  - Image notes: `Dockerfile.web` must not set `NODE_ENV=production` before `pnpm install` (pnpm
    then skips devDependencies and the `turbo`/`next` build tooling vanishes) and must build only
    the web app's own dependencies (`--filter='@tc/web^...'`), since `@tc/db` needs a generated
    Prisma client the web image never creates. `Dockerfile.api` copies the builder's full
    `node_modules` so the Prisma CLI, migrations and the linux-musl engine ship in the image for the
    one-off `migrate deploy` (§13.5); the 2 GB size is a later optimisation. The `schema.prisma`
    generator gains `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` for the alpine
    runtime — generator config only, the data model is unchanged.
  - `deploy.sh` runs the migration as `node packages/db/node_modules/prisma/build/index.js`
    because pnpm is not in the runtime image; the path was verified inside the image.
- UNSURE: see the `deepmerge-ts` note.

### Task 0.10 — Verification ledger
- Status: DONE for the banner; the live `pnpm ai:verify` half stays BLOCKED (see task 0.5).
- Evidence:
  ```
  $ pnpm db:seed
  flag       costModelVerified     false # Human flips after filling Appendix E.3 (PHASES 0.10)

  $ curl -s http://localhost:3001/api/v1/admin/cost-model
  {"verified":false,"banner":"Cost model: UNVERIFIED — run `pnpm ai:verify` with real provider keys
   and fill PRD Appendix E.3.","projectedMonthlyInr":99.67,"ceilingInr":100,"withinCeiling":true}

  # browser, http://localhost:3000/admin
  page text -> "Cost model: UNVERIFIED. run `pnpm ai:verify` with real provider keys and fill PRD Appendix E.3.
                ... Projected cost, fully active STUDENT ₹99.67 / month · Ceiling ₹100 / month · Within ceiling Yes"
  ```
- Notes / deviations from PRD:
  - `costModelVerified` is not one of FR-9.7's four flags; PHASES 0.10 adds it. Seeded `false` so
    the human has a row to flip after filling E.3. Listed under §3 in docs/CONSISTENCY_REVIEW.md.
  - The `pnpm ai:verify` block in this log (task 0.5) came from the mock provider and **must not be
    copied into Appendix E.3**. The banner stays until the real run happens and the flag is flipped.
- UNSURE: —

#### Gate G0 — agent's self-check (the human ticks the real one in docs/PHASES.md)
- [ ] CI is green on `main` — **BLOCKED: not pushed.** Every CI step passes locally (above).
- [ ] `https://<domain>/api/v1/health` returns 200 with all checks OK — **BLOCKED: no VPS/domain.**
      Local equivalent: the built image answers 200 with all four checks up.
- [ ] `pnpm ai:verify` output is in the log and Appendix E.3 is filled; budget ≤ ₹100 —
      **BLOCKED: no provider keys.** Mock run is in the log (₹99.67); E.3 must stay empty.
- [x] Cap concurrency test output is in the log — 20 parallel calls at cap−1 → exactly 1 succeeds
      (PRD §15), against real Postgres. (PHASES' checklist text still says "5 succeed / 15 blocked",
      the design PHASES 0.6 used before it was corrected to the PRD's; the PRD is what was tested.)
- [x] `packages/ai/prompts/` contains 21 files whose text matches Appendix A — enforced by a test.
- [x] `docs/ADR/0001-editor.md` exists and matches Appendix B — byte-for-byte diff in the log.
- [x] Backup restore drill output is in the log.
- [ ] I have started collecting the five fixture papers (C.1) — human task; `fixtures/papers/README.md`
      is the checklist.

**Phase 0 verdict from the agent's side:** everything buildable is built, tested and committed.
Gate G0 cannot be ticked until the human (1) pushes so CI runs, (2) supplies provider keys and runs
`pnpm ai:verify`, (3) provisions the VPS and secrets for a tag deploy, and (4) reads
`docs/CONSISTENCY_REVIEW.md` and ADR-0002. Phase 1 week 1 does not start before that.

---

## Owner instruction — 2026-09-04

The owner waived the "never skip a gate" rule: the agent is to build every phase it can without
pausing for gate sign-off, and to keep `docs/PENDING.md` listing all human-only work so it can be
done in one batch at the end. Gate checklists remain in `docs/PHASES.md` for the owner to tick
later against this log. Nothing else in PRD §0.3 changes: no fabricated fixtures, no guessed model
ids, no filling Appendix E.3.

---

## Unit: PHASE-1-W1 — Editor spike
Started: 2026-09-04 · Sessions: 2

### Task 1.1 — Schema and base editor
- Status: DONE
- Evidence:
  ```
  $ pnpm --filter @tc/ui test        # test/schema.spec.ts
   ✓ round-trips a document containing every node and mark type
   ✓ level-1 heading is not user-insertable but stays available programmatically
   ✓ citation renders {{cite:KEY}} in HTML so copies carry their key
  ```
  The round-trip fixture contains every node in B.2 (heading 1–3, paragraph, bulletList,
  orderedList, listItem, table/Row/Header/Cell, image, mathInline, mathBlock, codeBlock,
  blockquote, hardBreak, citation, draftBlock, needsSourceNote) and every mark (bold, italic,
  underline, strike, link, superscript, subscript, provenance, commentAnchor).
- Notes / deviations from PRD:
  - TipTap **2.27.3**, not 3.x. PRD §7.2 fixes "TipTap v2"; 3.x exists but is a different major
    (§0.3 rule 6, and a substitution would need an ADR).
  - Level-1 headings: the `#` input rule and `Mod-Alt-1` are removed, so the student cannot make
    one, while `setNode('heading', { level: 1 })` still works for the chapter title (B.2).
  - `commentAnchor` is registered and inert, as B.1 requires for Phase 3.
  - Images store an object-storage key and never base64 (B.1); the upload hook takes a signed URL.
- UNSURE: —

### Task 1.2 — Provenance mark + appendTransaction plugin (B.4)
- Status: DONE
- Evidence:
  ```
  $ pnpm --filter @tc/ui test        # test/provenance.spec.ts
   ✓ typed text with no mark becomes HUMAN
   ✓ B.9 #5a: typing at the END of an ASSIST range produces HUMAN text
   ✓ B.9 #5b: typing INSIDE an ASSIST range produces HUMAN_EDITED with the same actionId
   ✓ deleting inside an ASSIST range marks the touched text HUMAN_EDITED
   ✓ internal paste preserves provenance marks
   ✓ external paste becomes HUMAN
   ✓ counts words by provenance
  ```
- Notes / deviations from PRD:
  - The plugin works from the transaction's **step maps** only, as B.4 demands; it never diffs the
    document.
  - One case B.4 does not name: loading a chapter (`setContent`) replaces the whole document in one
    step, which the naive rule would have re-marked as freshly typed HUMAN text. A whole-document
    replace is now treated as a load, so stored marks survive a reload. Without this the provenance
    of every chapter would reset each time it was opened.
- UNSURE: —

### Task 1.3 — Ghost-text plugin (B.3)
- Status: DONE
- Evidence:
  ```
  $ pnpm --filter @tc/ui test        # test/ghost-text.spec.ts
   ✓ B.9 #1: ghost text never appears in editor.getJSON() at any point during a stream
   ✓ B.9 #2: Tab inserts the text with ASSIST provenance, converts {{cite}}, cursor to the end
   ✓ B.9 #3: typing while a suggestion is shown clears it and aborts the request
   ✓ B.9 #4: Tab without a suggestion still indents a list item
   ✓ a selection transaction at the same cursor position does not cancel (browsers emit these)
   ✓ Escape dismisses with REJECTED and reports nothing kept
   ✓ Alt+→ accepts one word at a time and reports PARTIAL on dismiss
   ✓ only one in-flight request per editor; requests need an eligible cursor
   ✓ sends before/after context with citations rendered as {{cite:KEY}}
  ```
  B.9 #1 asserts on `getJSON()` after **every** streamed token, not just at the end.
- Notes / deviations from PRD:
  - B.3 says any transaction that "moves the selection" cancels. Taken literally that kills every
    suggestion in a real browser: Chrome fires `selectionchange` when the widget decoration is
    inserted under the caret, producing a selection transaction at the *same* position. Cancelling
    now requires the cursor to actually leave `anchorPos`. Caught by the Playwright run, not by the
    unit tests, which is why the jsdom suite alone was not enough.
  - `editor.commands.keyboardShortcut()` cannot test this plugin: it is a capture-and-replay
    simulation that drops transaction metas. The tests dispatch real `KeyboardEvent`s instead.
  - The transport is injected (`options.request`), so the app passes SSE and tests pass a fake.
- UNSURE: —

### Task 1.5 — Citation node + NodeView (B.5)
- Status: DONE
- Evidence:
  ```
  $ pnpm --filter @tc/ui test        # test/citation-draft.spec.ts
   ✓ B.9 #6: switching APA → IEEE re-renders labels but leaves the document JSON untouched
   ✓ renders a removed source red-dashed and never deletes it
   ✓ insertCitation creates a node with a stable key and defaults
  ```
- Notes / deviations from PRD:
  - The label is never stored in the document: the NodeView reads `editor.storage.citations` and
    re-renders on `citationsRerender` meta (B.5). The B.9 #6 test asserts `getJSON()` is equal
    before and after a style switch.
  - The renderer is the week-1 placeholder B.5 allows; `packages/citations` (citeproc) replaces it
    in Phase 2 week 10.
- UNSURE: —

### Task 1.6 — Draft block (B.6)
- Status: DONE
- Evidence:
  ```
  $ pnpm --filter @tc/ui test        # test/citation-draft.spec.ts
   ✓ B.9 #7: accept unwraps the block and keeps citations and marks; notes become visible text
   ✓ discard removes the block entirely
   ✓ editing inside a pending draft yields HUMAN_EDITED, and requests are refused there
  ```
- Notes / deviations from PRD:
  - Regenerate is rendered but disabled, as PHASES 1.6 directs (it becomes a metered action in
    week 4).
  - Accept converts `needsSourceNote` atoms to plain `[NEEDS SOURCE: …]` text with HUMAN
    provenance, so they stay visible until the student deals with them (B.6).
- UNSURE: —

### Task 1.4 — SSE endpoint `/assist/suggest` (B.8, §9.3)
- Status: DONE
- Evidence:
  ```
  $ pnpm --filter @tc/api exec vitest run test/week1.spec.ts
   Test Files  1 passed (1)
        Tests  10 passed (10)
   ✓ streams the 3-sentence mock: start < 100 ms, tokens, then done with usage
   ✓ records the outcome the editor reports
   ✓ disconnecting the client aborts the provider stream (assert on the mock)
   ✓ a second request while one is open is refused with 409 (single in-flight per user)
   ✓ exhausting the ASSIST cap answers 429 CAP_EXCEEDED with resetsAt, and makes no provider call
   ✓ a chapter the user does not own answers 404 before any stream opens

  # and against the running dev stack:
  $ curl -N -s -b cookies.txt -d '{"chapterId":"...","before":"Prior studies in Karnataka found "}' \
      http://localhost:3001/api/v1/assist/suggest
  event: start
  data: {"suggestionId":"01a06d6e-ef66-7f86-bbef-299cff4b483d"}
  event: token
  data: {"t":"Evidence from rural Karn"}
  ... 13 token events ...
  event: done
  data: {"suggestionId":"...","citations":[{"key":"S1#c1","sourceId":null,"chunkId":null,
         "rendered":"(Source, n.d.)"}],"usage":{"inputTokens":52,"cachedInputTokens":537,
         "cacheWriteTokens":0,"outputTokens":77},"ttfbMs":262,"latencyMs":469,"empty":false}

  $ psql -tAc "SELECT outcome, shownChars, keptChars, ttfbMs, latencyMs FROM SuggestionEvent ..."
  suggestion outcome=ACCEPTED shown=305 kept=120 ttfb=262 latency=469 guided=false
  aicall model=mock-fast cost=0 ok=true out_tokens=77     # mock: cost 0, counter still increments
  ```
- Notes / deviations from PRD:
  - **The disconnect hook was wrong at first and the test caught it.** `request.raw.on('close')`
    fires as soon as the request *body* has been read, which for a JSON POST is before the handler
    runs — so every stream aborted immediately. The abort now hangs off the response socket
    closing before the response finished.
  - Refusals (404 / 409 / 429) are raised before the first SSE event, so the controller answers
    with problem-details JSON instead of a 200 stream carrying an error event.
  - The prompt is a **placeholder**: A.0 preamble + the A.1 task block loaded verbatim from
    `packages/ai/prompts/`, with no retrieved passages. The real cached/volatile builder, retrieval
    and memory trimming are week 3 (PHASES 3.2-3.4). Marked `TODO(prd)` in the source.
  - `done.citations[]` currently echoes each `{{cite:ID}}` with no resolved source. The retrieval
    whitelist that strips ids outside the retrieved set and counts `HALLUCINATED_CITE` (§10.6)
    lands in week 3 task 3.4.
  - Empty output refunds the cap unit and logs `EMPTY_SUGGESTION` (A.1 post-processing step 4).
    A provider error refunds too (§11.5). A client that disconnects mid-stream does **not** get a
    refund: tokens were generated and paid for.
- UNSURE: —

### Task 1.7 — Autosave, versions, conflict (B.7)
- Status: DONE
- Evidence:
  ```
  $ pnpm --filter @tc/ui test        # test/autosave.spec.ts - client half
   ✓ saves 2 s after the last change, with the current baseVersion
   ✓ writes a localStorage safety copy on every change and clears it after a save
   ✓ B.9 #8: a 409 conflict stops autosave and reports `conflict`
   ✓ flush() on blur or route change saves immediately
   ✓ saves every 30 s while dirty even if changes keep arriving
   ✓ keeps the change and reports `error` when the save fails, then retries

  $ pnpm --filter @tc/api exec vitest run test/week1.spec.ts   # server half
   ✓ a stale baseVersion is refused with 409 and the server version
   ✓ stores per-provenance word counts on save (B.4)
   ✓ a chapter owned by someone else reads as 404, never 403 (§12.1)
   ✓ a manual snapshot lands in object storage and the version list

  # against the dev stack:
  $ curl -X PUT -d '{"content":{...},"baseVersion":1}' .../chapters/$CH
  {"version":2,"wordCount":9,"snapshotTaken":true}
  $ curl -X PUT -d '{...,"baseVersion":1}' .../chapters/$CH          # stale
  {"type":"CONFLICT","status":409,"detail":"This chapter was changed elsewhere - reload to
   continue.","serverVersion":2,"baseVersion":1}
  $ mc ls -r l/thesis-copilot/snapshots/
  199B  .../1788542379917-autosave.json.gz
  203B  .../1788542380588-manual.json.gz
  $ psql -tAc "SELECT version, wordCounts, snapshotAt FROM Chapter ..."
  chapter version=2 wordCount=9 wordCounts={"DRAFT":0,"HUMAN":6,"ASSIST":3,"COMMAND":0,
                                            "HUMAN_EDITED":0} snapshotAt=2026-09-04 17:19:40.606
  ```
- Notes / deviations from PRD:
  - Appendix B.7 needs `Chapter.version`, a snapshot timestamp and a word-count breakdown; PRD §8's
    `Chapter` has none of them. Added additively in migration `0003_chapter_version` under
    **ADR-0003**; logged as item 13 in `docs/CONSISTENCY_REVIEW.md`. Needs owner sign-off.
  - Snapshots are gzipped JSON in MinIO with a `DocumentVersion` row holding the key, per §8.
  - The kill-tab check B.9 names is covered structurally by the localStorage safety copy written on
    every 2 s debounce; the manual browser run of it is pending (see tasks 1.8 and 1.9 below).
- UNSURE: —

### Task 1.8 — Editor page layout (§6.2)
- Status: CODE COMPLETE, BROWSER VERIFICATION BLOCKED (see below)
- What exists: `/app/d/:id/write/:chapterId` renders the §6.2 layout — left chapter rail, centre
  editor at 72ch in a serif face, right Sources/Citations tabs, top bar with document and chapter
  title, autosave state, the usage meter reading `/usage/me`, and an Assist|Draft mode marker.
  Ghost text is muted with a dot at the accept boundary; accepted text gets the 400 ms fade, which
  is disabled under `prefers-reduced-motion` (§6.4). Ctrl/Cmd+S forces a save and a MANUAL
  snapshot. A 409 shows the reload banner and stops autosave. A newer localStorage draft offers
  Restore / Discard.
- BLOCKED: **Docker Desktop's engine service (`com.docker.service`) is stopped and starting it
  needs Administrator rights this session does not have.** Postgres, Redis and MinIO are therefore
  down, the API cannot boot, and the browser end-to-end run (B.9 test 9) cannot be executed.
  Everything above was written and typechecks; it has not been driven in a real browser since the
  last round of fixes.
- UNSURE: the Playwright run before those fixes failed twice — once on the ghost-text
  selection-cancel bug (fixed, now covered by a unit test) and once on a knock-on assertion. The
  fixes are in, but until the suite runs green in Chromium this task is not proven.

### Task 1.9 — Latency measurement
- Status: BLOCKED — same Docker cause as 1.8.
- What exists: `apps/api/scripts/assist-bench.mjs` runs N `/assist/suggest` calls and prints p50/p95
  for client TTFB, the server's own `ttfbMs`, and total latency, then checks the two PHASES 1.9
  thresholds (p95 TTFB ≤ 600 ms; overhead over the 250 ms mock ≤ 350 ms) and that call 51 is
  refused with `CAP_EXCEEDED`. A dev-only overlay in the editor shows the last TTFB and latency.
- Single-sample datapoint from the dev stack before Docker stopped: `ttfbMs 262`, `latencyMs 469`
  against a 250 ms mock, i.e. **12 ms of server overhead**. That is one call, not the 50-call
  p50/p95 the DoD requires.
- To unblock: start Docker Desktop as Administrator, `docker compose -f
  infra/compose/docker-compose.dev.yml up -d`, start the API, then
  `node apps/api/scripts/assist-bench.mjs 50`.

---

### Tasks 1.8 and 1.9 — unblocked and closed (2026-09-05)

Docker Desktop finished starting on its own; the dev Compose stack came up and both tasks ran.
The browser run then found two CORS faults that nothing else could have caught.

#### Two bugs only a browser revealed

1. **`PUT /chapters/:id` was refused at the preflight.** `enableCors({ origin, credentials })`
   without an explicit `methods` list does not allow PUT, so Chrome answered the autosave with
   "Method PUT is not allowed by Access-Control-Allow-Methods in preflight response". Every save
   failed and the top bar sat on "Save failed — retrying". Server-side tests never preflight, so
   the 30 API tests and the manual `curl` drive all passed while the real editor could not save a
   single keystroke. Fixed by listing the methods, headers and exposed headers explicitly.

2. **`POST /assist/suggest` had no CORS headers at all.** The SSE handler calls `reply.hijack()`
   and writes the response head itself, which skips Fastify's `onSend` hooks — and with them the
   CORS headers Nest would have added. Chrome blocked the stream with "No
   'Access-Control-Allow-Origin' header is present". Fixed by writing
   `access-control-allow-origin` (the configured `APP_URL`, never the request's own Origin),
   `access-control-allow-credentials` and `Vary: Origin` into the hijacked head.

   `UNSURE:` resolved — this is why Appendix B.9 test 9 is specified as a browser test rather than
   an integration test. Recorded here so the same trap is not re-entered for `/draft/section`,
   `/chat` and the coherence stream, which all hijack the reply the same way.

#### Task 1.8 — Editor page layout: DONE
- Evidence:
  ```
  $ pnpm --filter @tc/web e2e
  Running 7 tests using 7 workers
    ok 5 smoke.spec.ts:45 › API answers errors as RFC 9457 problem details (503ms)
    ok 7 smoke.spec.ts:32 › API health reports every dependency up (563ms)
    ok 1 smoke.spec.ts:9  › home page renders and states the integrity position (2.9s)
    ok 4 smoke.spec.ts:17 › sign-in screen offers email OTP and asks for an address (3.0s)
    ok 6 smoke.spec.ts:27 › unauthenticated /app redirects to sign-in (3.1s)
    ok 3 editor.spec.ts:71 › typing while a suggestion is shown dismisses it; Tab in a list indents (6.6s)
    ok 2 editor.spec.ts:10 › B.9 #9: suggestion streams, Tab accepts, text survives a reload with provenance (10.7s)
  7 passed (11.9s)
  ```
  B.9 test 9 in full: sign in by emailed code, create a thesis, open its chapter, type a sentence,
  press `Ctrl+/`, ghost text streams in, press `Tab`, the text is inserted carrying
  `data-provenance="ASSIST"` with one citation node, the usage meter moves from `Assist 0/50` to
  `Assist 1/50`, autosave reports `Saved`, the page is reloaded, and both the typed and the
  accepted text are still there with provenance intact and no ghost widget.

  The second test covers B.9 #3 and #4 in a real browser: typing dismisses a shown suggestion, and
  `Tab` with no suggestion still indents a list item.

#### Task 1.9 — Latency measurement: DONE
- Evidence:
  ```
  $ node apps/api/scripts/assist-bench.mjs 50 http://localhost:3001
  ..................................................
  assist-bench: 50 streamed, 0 refused, mock latency 250 ms
  client TTFB    p50   279 ms   p95   303 ms   min  267   max  417
  server ttfbMs  p50   260 ms   p95   274 ms   min  253   max  322
  latency        p50   506 ms   p95   585 ms   min  466   max  654
  overhead p95 (server ttfb − 250) = 24 ms   →   OK: p95 TTFB ≤ 600 ms
  call 51 (cap check): HTTP 429 — CAP_EXCEEDED as expected
  ```
- Against the PHASES 1.9 thresholds: p95 server TTFB **274 ms** against a ceiling of 600 ms, and
  **24 ms** of our own overhead against a ceiling of 350 ms. Both comfortable.
- Call 51 is refused with `CAP_EXCEEDED`, confirming the FREE_TRIAL cap of 50 holds end to end
  through the real HTTP path, not just in the unit test.
- These are mock-provider numbers on a developer laptop. The figure that matters for Gate G2 is
  p95 TTFB on the pilot VPS with the real provider, measured in week 5.

#### Whole-repo state at the close of week 1
```
$ pnpm biome check .
Checked 169 files in 213ms. No fixes applied.

# tests, per package
@tc/config      62 passed        @tc/ui          31 passed
@tc/db           2 passed        @tc/api         30 passed
@tc/ai          48 passed        @tc/worker       4 passed
@tc/retrieval   78 passed        @tc/web (e2e)    7 passed
                                            total 262

# typecheck: 0 errors in all eight workspaces
```

#### Gate G1 — agent's self-check (the human ticks the real one in docs/PHASES.md)
- [x] All nine B.9 tests pass, with output in this log: #1–#7 in `@tc/ui`, #8 across `@tc/ui`
      (client) and `@tc/api` (server 409), #9 in Playwright.
- [x] p50/p95 TTFB recorded: p95 274 ms server-side, ≤ 600 ms.
- [x] `editor.getJSON()` contains no ghost text during a stream — asserted after every streamed
      token, not only at the end.
- [ ] The human opens the editor themselves, types, presses `Ctrl+/`, `Tab`, reloads.
- [ ] The human types while a suggestion shows and sees it vanish.
- [ ] The human presses `Tab` inside a list with no suggestion and sees it indent.
- [ ] Kill-tab test run by hand and the result recorded.

---

## Unit: PHASE-1-W2 — Path B ingestion
Started: 2026-09-05 · Sessions: 1

Docker Desktop's engine service is stopped and cannot be started without Administrator rights
(see PENDING.md). Everything in this unit that needs Postgres, Redis, MinIO or a live API is
therefore deferred. What follows is the part that is pure logic and provable on its own.

### Task 2.7 (part) — Chunker and the §10.4 retrieval ranking
- Status: DONE for the pure-logic half. The pgvector query and the embed-and-index job are
  deferred to the next session with Docker.
- Evidence:
  ```
  $ pnpm --filter @tc/retrieval test
   Test Files  4 passed (4)
        Tests  78 passed (78)

  # chunker (FR-2.4)
   ✓ produces chunks near the 350-token target
   ✓ never splits mid-sentence
   ✓ offsets index the original text, so a chunk can be found again
   ✓ consecutive chunks overlap by roughly 15% of the target
   ✓ keeps the page a chunk starts on
   ✓ never lets a chunk span two sections
   ✓ emits an over-long sentence whole rather than cutting it
   ✓ folds a tiny trailing remainder into the previous chunk
   ✓ terminates on pathological input rather than looping
   ✓ splits into batches of 64 by default (PHASES 2.7)

  # ranking (§10.4) and the whitelist (§10.6)
   ✓ is the last sentence before the cursor plus the scope note
   ✓ adds 0.15 for a matching sub-theme and 0.1 for full text
   ✓ takes 6 for Assist, 12 for Draft, 8 for Chat
   ✓ strips an invented id and reports it
  ```
- Notes / deviations from PRD:
  - FR-2.4 says "never split mid-sentence" but says nothing about a sentence longer than the
    budget. Such a sentence is emitted whole: an over-long chunk costs slightly more to embed, a
    cut one is unciteable, and the AC ("a chunk can be re-located in the PDF viewer by page +
    offset") only holds if the text is intact.
  - Token counts use the ~4-chars-per-token approximation PRD §11.1 already uses for the cost
    model, rather than adding a tokenizer dependency (§0.3 rule 6).
  - The sentence splitter is conservative on purpose: "et al.", "e.g.", initials and decimals do
    not end a sentence, and a lowercase word never starts one. A false boundary would split
    mid-sentence, which the DoD forbids.
- UNSURE: —

### Task 2.9 (part) — C.3 scoring rules
- Status: Rules implemented and unit-tested. The scoring RUN is
  `BLOCKED: fixture missing — fixtures/papers/pNN.pdf and pNN.expected.json`.
- Evidence:
  ```
   ✓ applies NFKC, collapses whitespace and case-folds
   ✓ folds the quotes and dashes PDF extractors emit
   ✓ makes two numbering styles of one reference compare equal
   ✓ clears the 0.85 reference bar for a realistic OCR wobble
   ✓ stays below the bar for two different papers by the same authors
   ✓ matches each captured string to at most one expected string
   ✓ passes a clean extraction / fails and says why when the title differs
   ✓ renders the per-paper table C.3 asks for
  ```
- Notes / deviations from PRD:
  - Reference matching is one-to-one and greedy by best score. C.3 does not say so, but a
    many-to-one match would let one captured string satisfy several expected entries and inflate
    recall; a paper that cites the same authors twice would score better than it should.
  - DOIs compare after lowercasing and stripping a `https://doi.org/` prefix, so the same DOI
    written two ways counts as resolved.
  - The agent has not created and will not create `*.expected.json` (§0.3 rule 3).
- UNSURE: —

### Task 2.5 (part) — Reference resolution clients
- Status: Clients and the matching rule are DONE and tested against recorded shapes with an
  injected `fetch`. Wiring them into the `resolve-reference` job needs Redis and Postgres; deferred.
- Evidence:
  ```
   ✓ sends a contact address in the User-Agent for the polite pool
   ✓ returns null on 404 rather than throwing
   ✓ retries a 429 and then succeeds / gives up after the attempt budget
   ✓ does not retry a 400
   ✓ spaces calls by the interval (≤ 5 req/s)
   ✓ resolves via Crossref and enriches from OpenAlex
   ✓ falls back to OpenAlex when Crossref finds nothing good
   ✓ returns UNRESOLVED rather than guessing when nothing matches
   ✓ flags a preprint and a retraction
   ✓ keeps the Crossref match when the OpenAlex enrichment fails
   ✓ returns the best OA PDF location / reports a closed-access record
  ```
- Notes / deviations from PRD:
  - FR-2.1 says "normalised similarity ≥ 0.85 on title/authors/year" without giving a formula.
    Implemented as 0.7 × title + 0.2 × author-surname hits + 0.1 × year agreement, where the title
    term slides a window along the reference string (a reference is author + title + venue + year,
    so comparing it whole against a bare title would score badly however right the match is). A
    year that contradicts the reference caps the score below the threshold: a same-titled paper
    from another year is a different work. The weights are a judgement call the PRD does not make;
    they will be re-checked against the fixture papers when those exist.
  - Crossref models retraction inconsistently, so both `type: retraction` and the
    `relation.is-retracted-by` signal are checked and neither is trusted alone.
  - OpenAlex enrichment is best-effort: if it fails, the Crossref match still stands.
- UNSURE: whether the 0.7/0.2/0.1 weighting hits the FR-2.1 acceptance criterion (≥ 80% of fixture
  references resolve with the correct DOI). It cannot be known until the five fixture papers exist.

### Tasks 2.1 and 2.3 — upload, storage and the extraction job
- Status: DONE against the dev stack. The accuracy DoD ("the expected title appears within the
  first 2,000 characters of each fixture PDF") stays
  `BLOCKED: fixture missing — fixtures/papers/pNN.pdf`.
- Evidence:
  ```
  # 1. an executable renamed .pdf is refused on its bytes, not its name
  $ curl -F "file=@fake.pdf;filename=evil.pdf;type=application/pdf" .../seed-papers
  CONTENT_MISMATCH | That file is not a readable PDF or Word document.

  # 2. a real PDF is accepted, stored and queued
  $ curl -F "file=@sample-paper.pdf;filename=p01.pdf" .../seed-papers
  {"id":"01a07070-1821-...","filename":"p01.pdf","status":"PENDING","hasExtraction":false}

  # 3. the worker ran extract-paper end to end
  $ curl .../seed-papers/01a07070-1821-...
  status     : DONE | error: None
  title      : 'Solar adoption in rural Karnataka'
  abstract   : 'We survey 312 households across three districts and report the leading'
  references : 2
     - [1] Kumar, A. (2021). Solar adoption in rural Karnataka. Energy Policy, 152, 112121.
     - [2] Rao, B. (2019). Wind turbine siting in coastal Kerala. Renewable Energy, 140, 55.
  sections   : ['Abstract', '1. Introduction', '2. Method', 'References']

  # 4. one Source per reference, queued for resolution (FR-2.1)
  $ curl .../sources
  count: 2
     PENDING | NONE | [1] Kumar, A. (2021). Solar adoption in rural Karnataka. Energ
     PENDING | NONE | [2] Rao, B. (2019). Wind turbine siting in coastal Kerala. Ren

  # worker log
  {"msg":"extract-paper done","jobId":"extract-paper__01a07070-...","references":2,
   "parts":1,"retries":0,"pages":1,"twoColumnPages":[],"queuedResolutions":2}

  $ pnpm --filter @tc/api exec vitest run test/upload-rules.spec.ts
   Tests  22 passed (22)
  $ pnpm --filter @tc/worker test
   Tests  17 passed (17)
  ```
- Notes / deviations from PRD:
  - **BullMQ refuses a job id containing `:`** ("Custom Id cannot contain :"), which was the
    obvious separator and made every upload 500. Job ids now come from a shared `jobId()` helper in
    `@tc/types` that joins with `__`, so the API and the worker derive the same id for the same work
    and the constraint is documented in one place. The id is what makes an enqueue idempotent.
  - PHASES 2.1 lists the quota check before the content check. Reversed: a student who uploads the
    wrong file while at quota should be told the file is wrong, which is the thing they can act on,
    and reading five magic bytes costs nothing.
  - The job contract (queue names, payload shapes, retry policy) lives in `@tc/types`, not a new
    package: PRD §7.3 fixes the package list, and §7.3 describes `types` as the shared DTOs both
    sides use. A new `@tc/queues` would have needed an ADR for no benefit.
  - `SeedPaper.status` gains `EXTRACTING` between `PENDING` and `DONE`/`FAILED`. §8 types the
    column as a free `String` with a `PENDING` default and never enumerates the values, so this is
    a filling-in rather than a change; the set is declared in `@tc/types`.
  - Failures are recorded on the row as something a student can act on, which is FR-1.1's
    acceptance criterion ("failures show a readable reason"): a password-protected PDF, a file with
    no text layer (suggesting OCR), and a corrupt file each get their own sentence.
  - The glossary is seeded from the paper's terminology (FR-3.5) and **never overwrites an entry the
    student already has**, so re-running extraction cannot undo their edits.
  - `AI_PROVIDER=mock` now answers an EXTRACT request by deriving a structurally valid
    `PaperExtraction` from the paper's own text — title, abstract, reference entries, headings. It
    invents nothing; every field is copied from the input or left empty, the same rule A.5 gives the
    real model. Without this an upload in mock mode failed schema validation and the whole
    proposal-and-library path was undevelopable before provider keys exist. `AiCallLog` still
    records `mock-strong` at zero cost, and `pnpm ai:verify` still refuses to let mock output stand
    in for a real verification (§0.3 rule 5).
- UNSURE: the extraction accuracy thresholds in C.3 cannot be judged until the five fixture papers
  exist. The pipeline is proven to run; how well it reads a real two-column paper is unmeasured.

### Task 2.5 — reference resolution (FR-2.1)
- Files: `packages/retrieval/src/scholarly/resolve.ts`, `apps/worker/src/jobs/resolve-reference.ts`,
  `apps/worker/src/main.ts`, `apps/api/src/modules/sources/sources.service.ts` (`refixSource`).
- Evidence, against the live services (no stubs):

  ```
  $ curl .../documents/<id>/sources
    RESOLVED   10.1038/nature14539            Deep learning            Nature | 2015 | 84228 cited
    RESOLVED   10.1016/j.enpol.2010.01.045    Assessment of bottom-up  Energy Policy | 2010 | 23 cited

  # a reference to a paper that does not exist:
    UNRESOLVED  doi=None  title=None

  # the student then types the DOI on the "Fix this reference" form:
  {"queued":true,"doi":"10.1038/nature14539"}
    RESOLVED   10.1038/nature14539   Deep learning   84228 cited

  $ pnpm --filter @tc/retrieval test
   Tests  121 passed (121)
  $ pnpm --filter @tc/worker test
   Tests  29 passed (29)
  ```
- Notes / deviations from PRD:
  - **`subtype` is not a Crossref-selectable field.** Asking for it made `query.bibliographic`
    return HTTP 400 on every single lookup; the job retried three times and gave up, so every
    library sat at `PENDING` forever with no error a student could see. The legal field list comes
    back in Crossref's own 400 body. The select is now pinned by a test that fails if a
    non-selectable field is ever added, and `relation` was added because the retraction check reads
    it and was silently always false without it.
  - **`printedDoi` was in the job payload but nothing used it.** `refixSource` already enqueued the
    DOI the student typed, and the job then re-ran the bibliographic search that had just failed —
    so the manual fix was decorative. `resolveByDoi` now takes the DOI as the answer (score 1, no
    search), falling back to OpenAlex for DOIs Crossref does not mint, and to the search if the DOI
    turns out to be wrong.
  - **Grounding level was asserted rather than observed.** The job hardcoded `ABSTRACT` for every
    resolution. It now stores the real abstract — Crossref's JATS stripped to text, or OpenAlex's
    inverted index rebuilt — and claims `ABSTRACT` only when there is one, `NONE` otherwise. FR-2.2's
    badge is a promise about what the AI can quote, so it has to be earned.
  - **A job that exhausted its retries left the source at `PENDING` for good**, showing "Looking it
    up…" forever with no route to the manual fix. `markUnresolvedAfterRetries` moves it to
    `UNRESOLVED` on the final failure, scoped to rows still `PENDING` so it cannot overwrite a fix
    that landed first.
  - Unpaywall answers HTTP 422 for the placeholder contact address rather than explaining, which
    reads as an outage in the logs. The worker now says so at boot. Real addresses are a
    `docs/PENDING.md` item; until then no source can reach `FULL_TEXT`.

### Tasks 2.4 and 2.8 — proposal screen and library UI (FR-1.3, FR-1.4, FR-2.2)
- Files: `apps/web/src/app/app/d/[id]/proposal/{page.tsx,ProposalScreen.tsx}`,
  `apps/web/src/app/app/d/[id]/sources/{page.tsx,SourcesScreen.tsx}`,
  `apps/api/src/modules/memory/*`, `apps/web/src/lib/api.ts`, `apps/web/e2e/proposal-sources.spec.ts`.
- Evidence — driven in a real browser against the running API and worker:

  ```
  $ npx playwright test --workers=1
    ok  3 FR-1.3/1.4: a paper becomes an editable proposal skeleton with a gap checklist
    ok  4 FR-2.1/2.2: the library shows resolved sources with a grounding badge
    ok  5 FR-2.1: an unfindable reference stays unresolved and offers a manual fix
    10 passed

  $ pnpm test
    config 62 · types 12 · ui 31 · db 2 · ai 90 · retrieval 121 · web 6 · worker 29 · api 52
  $ pnpm lint
    Checked 203 files. No fixes applied.
  ```
- Notes / deviations from PRD:
  - **Every upload made from the browser was rejected**, while every API test passed. `lib/api.ts`
    stamped `content-type: application/json` onto any request with a body, so a `FormData` upload
    lost its multipart boundary and the server tried to JSON-parse it. This is the third fault in
    this project that only a browser could find (after the two week-1 CORS faults), which is why
    these screens have E2E coverage rather than component tests.
  - **Re-opening a saved proposal showed the draft again, not the student's edits.** The screen
    pre-filled from `draftScopeFrom(extraction)` and never read back `DocumentMemory.scope`. FR-1.4
    says downstream prompts read the edited values and never the generated ones; the screen has to
    honour the same rule or the edits look lost. A saved scope now wins over the draft.
  - The E2E fixtures cite two papers that really exist (`10.1038/nature14539`,
    `10.1016/j.enpol.2010.01.045`), so resolution is exercised against live Crossref rather than a
    stub, and one reference to a paper that does not, so the "never guess" guarantee is exercised
    too. Both DOIs are asserted, so a wrong match fails the test.
  - `PUT /documents/:id/memory/scope` writes `Document.title` and `DocumentMemory.scope` in one
    transaction, so the list and the proposal can never disagree about the title.
  - `apps/web` gains a Vitest config; without it Vitest loaded the Playwright specs and failed on
    Playwright's own `test()`.

### Tasks 2.6 and 2.7 — full-text fetch, chunking, embedding, retrieval (FR-2.2, FR-2.4)
- Files: `packages/retrieval/src/scholarly/fulltext.ts`, `packages/retrieval/src/pgvector.ts`,
  `apps/worker/src/jobs/index-source.ts`, `apps/worker/src/main.ts`,
  `apps/api/test/retrieval.spec.ts`.
- Evidence — driven live, then read straight out of Postgres:

  ```
  worker: {"msg":"source indexed","from":"abstract","chunks":2,"groundingLevel":"ABSTRACT"}

  tc=# SELECT ordinal, section, "tokenCount", vector_dims(embedding), left(text,55) …
   ordinal | section  | tokenCount | dims |                    text
  ---------+----------+------------+------+--------------------------------------
         0 | Abstract |        285 | 1024 | Proteins are essential to life, and …
         1 | Abstract |        181 | 1024 |  Here we provide the first computat…

  tc=# SELECT "groundingLevel", doi FROM "Source" WHERE id = …
   ABSTRACT | 10.1038/s41586-021-03819-2

  $ pnpm --filter @tc/api exec vitest run test/retrieval.spec.ts   # real pgvector, Testcontainers
   Tests  7 passed (7)
  $ pnpm test
   config 62 · types 12 · ui 31 · db 2 · ai 90 · retrieval 149 · web 6 · worker 39 · api 59
  ```
- Notes / deviations from PRD:
  - **A re-index was silently swallowed.** The `index-source` job id keyed on `sourceId` alone, so
    BullMQ treated the second enqueue as a duplicate of the first: after a manual DOI fix the
    source kept whatever grounding the failed first attempt had left. The id now includes a
    `contentKey` — the DOI, or an uploaded PDF's storage key — so re-indexing the same content is
    still deduplicated but a source that now points at something else is indexed again. This is the
    third dedup fault of the same shape (after the `:` in job ids and the refix job id), and the
    rule that came out of it is: **a job id must key on what the job will read, not on what it will
    write.**
  - `groundingLevel` is only ever raised on evidence. FULL_TEXT needs a PDF that was fetched *and*
    yielded text, so a scanned paper with no text layer is not stored and not claimed; ABSTRACT
    needs an abstract that was actually chunked. A resolution on its own claims nothing.
  - The open-access URL comes from Unpaywall and points at a host we do not control, so the fetch
    caps the body as it arrives (a host that understates `content-length` cannot get past it),
    checks the PDF magic bytes because publishers serve paywall pages with a PDF content-type, and
    turns every failure into a sentence a student can read rather than an exception.
  - **All pgvector SQL lives in one file.** Prisma types `embedding` as `Unsupported`, so it cannot
    be read or written through the client at all. The vector literal has to be interpolated because
    no driver binds a pgvector value; every element is checked to be a finite number first, so
    nothing but digits can reach the SQL text, and that check is tested with a hostile value.
  - `replaceSourceChunks` deletes before inserting. Re-indexing without that would leave two
    generations of chunks behind and quietly double every retrieval hit.
- UNSURE: retrieval quality is unmeasured. The integration test proves the SQL, the HNSW index and
  the ordering are right, using the mock embedder, where identical text gives an identical vector.
  Whether `voyage-3` puts the *semantically* right passage first cannot be known until the real key
  exists (`docs/PENDING.md`).

### Task 2.9 — still to do
- The Appendix C.3 scoring run. **BLOCKED: fixtures missing** — it needs the five corrected
  `fixtures/papers/pNN.expected.json`, which only the human can write (`docs/PENDING.md`).

## Phase 1 — Week 3 (real prompts and citations)

### Task 3.1 — minimal chapter and source pins (FR-3.3, FR-3.4, §10.4)
- Files: `packages/types/src/outline.ts`, `apps/api/src/modules/memory/memory.controller.ts`,
  `apps/api/src/modules/chapters/{chapters.service.ts,chapters.controller.ts}`,
  `apps/web/src/components/editor/SourcePins.tsx`, `apps/api/test/{_harness.ts,week3.spec.ts}`,
  `apps/web/e2e/proposal-sources.spec.ts`.
- Evidence:

  ```
  $ pnpm --filter @tc/api exec vitest run test/week3.spec.ts   # real containers
   Tests  9 passed (9)
  $ npx playwright test --workers=1
    ok 6 3.1: Continue opens the chapter from the paper, and two sources can be pinned
    11 passed
  $ pnpm test
   config 62 · types 39 · ui 31 · db 2 · ai 90 · retrieval 149 · web 6 · worker 39 · api 68
  $ pnpm lint
   Checked 215 files. No fixes applied.
  ```
- Notes / deviations from PRD:
  - **"Abstract" was becoming the first chapter title.** PHASES 3.1 says to take "the first section
    from the paper's `sections`", and a real paper's first section is almost always its abstract.
    `firstChapterOutline` now skips front and back matter — abstract, keywords, acknowledgements,
    funding, references, appendices — and falls back to a neutral default rather than naming a
    student's opening chapter after the paper's front matter. Found by the browser, not by a test.
  - **The pins panel showed every source as unusable.** Grounding is decided by two background jobs,
    so a panel opened seconds after an upload saw `NONE` everywhere and stayed wrong until a manual
    reload. It now polls while any source is still `PENDING`, and says "still looking up" rather
    than "nothing to quote", which are different facts.
  - Continue does not touch a chapter the student has already written in (`wordCount > 0`) or an
    outline that already exists. The outline serves their draft; it does not overwrite it.
  - Pins are validated against the chapter's own document. A pin is a retrieval filter, and one
    that reached across documents would put another student's sources into this draft.
  - Only a source with something to quote is offered for pinning. Pinning a `NONE` source would
    filter retrieval down to nothing and read as a broken suggestion.
  - **The E2E suite tripped its own auth rate limit** (20 requests a minute from one address, which
    is right for production): five sign-ins plus their session checks exceed it, and a test failed
    for a reason unrelated to what it tested. The spec now establishes one session and reuses it;
    the sign-in UI is still covered by `smoke.spec.ts` and `editor.spec.ts`. The limit was not
    changed — loosening a security control to make a test pass would be the wrong fix.
  - `apps/api/test/_harness.ts` extracts the container boot from `week1.spec.ts` so later weeks
    share it. A copied harness would drift, and two suites would then disagree about what the
    application is.

### Tasks 3.2, 3.3, 3.4 — prompt builder, retrieval wiring, Assist through the real pipeline
- Files: `packages/ai/src/{template.ts,builder/memory.ts,builder/assist.ts,builder/postprocess.ts,builder/tokens.ts}`,
  `packages/ai/test/{builder.spec.ts,_memory-fixture.ts,__snapshots__/builder.spec.ts.snap}`,
  `apps/api/src/modules/assist/{context.service.ts,doc-text.ts,assist.service.ts}`,
  `apps/api/src/modules/ai/ai.module.ts`, `packages/ui/src/editor/ghost-text.ts`,
  `apps/web/src/lib/sse.ts`.
- Evidence:

  ```
  $ pnpm --filter @tc/ai test
   Tests  127 passed (127)     # 37 new: template dialect, outline render, trimming order,
                               # cached-block snapshot, FR-3.4 outline-edit test, A.1 steps 1–4
  fixture memory block:  344 tokens (420 with a style profile)     ≤ 3,200  (A.0.1)
  fixture cached block:  881 tokens (957 with a style profile)     ≤ 4,000  (§10.3)

  $ pnpm --filter @tc/api exec vitest run test/week1.spec.ts      # real containers
   Tests  10 passed (10)       # assist now: memory block + §10.4 retrieval + A.1 + post-processing
  $ pnpm --filter @tc/ui test
   Tests  34 passed (34)       # 3 new: `done.text` replaces the streamed buffer
  $ npx playwright test --workers=1
   11 passed
  $ pnpm lint
   Checked 225 files. No fixes applied.
  ```
- Token counting: **an estimator, not the tokenizer.** ~4 characters per token, which is PRD §11.1's
  own assumption, so the budget check and the cost model agree with each other. It is NOT
  calibrated against the real tokenizer — that needs `pnpm ai:verify` and a key (`docs/PENDING.md`).
  Modern tokenizers run 4.0–4.5 chars/token on academic English, so this over-estimates slightly
  and trims a little early, which is the safe direction for a cache budget.
- Notes / deviations from PRD:
  - **The prompt files are rendered, not rebuilt.** A.0.1 and A.1 are written in a small
    Handlebars-like dialect (`{{path}}`, `{{#each}}`, `{{#if}}`); `template.ts` renders exactly
    that, so the file on disk is the prompt byte for byte and the builder only fills the holes it
    declares (§0.3 rule 11). Not Handlebars itself: it HTML-escapes by default, which would turn a
    student's `<` into `&lt;` inside the prompt. `<!-- … -->` comments in the templates are notes
    from the PRD to the builder (A.0.1 carries one about the outline) and are dropped at render.
  - **Byte-stability is enforced, not hoped for.** Glossary rows render in a fixed order whatever
    the JSON key order; no timestamp or per-request id enters the cached block; a test proves the
    same memory renders to the same bytes and that only the volatile block changes between calls.
    Every byte of the cached block is part of the provider's cache key, and a miss costs six times
    §11.2's per-call price.
  - A.0.1's trimming step (3), "style profile samples", is a no-op today: the template renders no
    samples. The step is kept in code so the order is visible and the log says it ran. UNSURE
    whether the PRD intends `transitions` to count as samples; left as written.
  - **Passage ids are short and per request** (`S1#c1`, `S2#c1`), the form §10.4's example shows.
    A UUID pair per passage would cost ~25 tokens each and is exactly the kind of string a model
    mis-copies. The map back to real ids lives for one request; the accepted citation node stores
    the real ids (task 3.5).
  - **The `done` event now carries the post-processed text.** A.1 steps 1–3 can change what was
    streamed (a stripped citation, a third sentence cut), and the ghost text is a decoration of
    the streamed buffer. The plugin replaces its buffer with `done.text` when present; an empty
    final text goes idle (step 4). Without this, Tab would insert what the model said rather than
    what A.1 allows.
  - **The mock now obeys A.0 rule 3.** It cites the first passage actually in its prompt, by that
    passage's id, and cites nothing when there are none. The week-1 mock always emitted
    `{{cite:S1#c1}}`, which under the §10.6 whitelist was a guaranteed HALLUCINATED_CITE on every
    library-less document and made every E2E citation assertion meaningless. The week-1 assertions
    were updated to the new contract: no citation without a library, two sentences on `done`.
  - The chapter's sub-theme for the §10.4 rerank comes from its outline node; `Chapter` has no
    such column and the outline is the record FR-3.4 says both sides read.
- BLOCKED (PHASES 3.3 done-when): recall@6 on the C.4 labelled set needs `fixtures/retrieval/qa.json`,
  which only the human can write. BLOCKED (3.4 done-when): 30 real suggestions with cache hit rate
  need a provider key. Both in `docs/PENDING.md`.

### Task 3.5 — `{{cite}}` becomes a citation node with a real source (FR-5.x, B.5)
- Files: `apps/api/src/modules/chapters/{citations.ts,chapters.service.ts}`,
  `apps/api/src/modules/sources/{sources.service.ts,sources.controller.ts}`,
  `packages/ui/src/editor/{citation.ts,ghost-text.ts,extensions.ts}`,
  `apps/web/src/components/editor/{CitationList.tsx,ThesisEditor.tsx}`, `apps/web/src/app/editor.css`.
- Evidence:

  ```
  $ npx playwright test --workers=1
    ok 7 3.5: an accepted citation resolves to a real source, shows its passage, and survives a reload
    12 passed
  $ pnpm test
   config 62 · types 39 · ui 37 · db 2 · ai 127 · retrieval 149 · web 6 · worker 39 · api 80
  $ pnpm lint
   Checked 228 files. No fixes applied.
  ```
- Notes / deviations from PRD:
  - **`Citation` rows follow the document, never lead it.** B.2 makes the node's attrs the only
    citation state, so `save` mirrors them into the table: rows for nodes that are gone are deleted,
    the rest upserted by node key. Only sources still in this document's library get a row — a node
    whose source was removed stays in the text as a red-dashed orphan (B.5) with no row, because a
    row must reference a `Source` that exists.
  - `GET /sources/:id/chunks/:chunkId` returns the passage plus a signed PDF link. The chunk must
    belong to the named source *and* that source to the caller's document, so a chunk id from
    another student's library answers 404 rather than leaking a passage.
  - The popover is a child of the citation's own DOM, so `ignoreMutation` already covers it and it
    can never reach the document. It is fetched on hover after a short delay, never on render.
  - **The popover has to be absolutely positioned.** Inline, it reflows the line, which shifts the
    citation out from under a stationary pointer; Chrome then fires `mouseleave` on the layout
    change and closes the popover it just opened. Only a browser shows this.
  - The label the server rendered (`(Jumper 2021)`) is carried from `done.citations` into the
    citation store, so an accepted node shows a real label instead of the `(Source, n.d.)`
    placeholder. The label still lives in storage, never in the document (B.5); a test asserts the
    document JSON does not contain it.
  - `data-source-id` / `data-chunk-id` are set on the live element, not only in the serialised
    form: the Citations tab, the E2E and a debugger all read the DOM.
  - The accept fade decorates the accepted range and ProseMirror redraws it when the fade ends
    (~400 ms), which can recreate the NodeView and close a popover opened inside that window. Minor
    and self-correcting — the next hover reopens it — so it is recorded rather than worked around.

### Tasks 3.6, 3.7, 3.8 — citation suggestion, guided input, prompt golden set
- Files: `packages/ai/src/builder/cite.ts`, `packages/ai/src/golden.ts`,
  `packages/ai/test/{cite.spec.ts,golden.spec.ts}`,
  `apps/api/src/modules/assist/{cite.service.ts,citations.controller.ts}`,
  `apps/web/src/components/editor/{CiteSuggestions.tsx,GuidedInput.tsx}`,
  `fixtures/prompts/{README.md,example.draft.json}`.
- **Cadence change.** The owner directed on 2026-09-05 to build first and test at the end, which
  sets aside PRD §0.3 rule 7 ("one task at a time … do not start three things in parallel"). These
  three tasks were built as one batch and verified once. Rule 7 is otherwise unchanged in the PRD;
  this is a logged deviation, not an edit to the source of truth.
- Evidence:

  ```
  $ pnpm test
   config 62 · types 39 · ui 37 · db 2 · ai 170 (+1 skipped) · retrieval 149 · web 6 ·
   worker 39 · api 80        = 584 passing
  $ pnpm lint
   Checked 237 files. No fixes applied.
  $ npx playwright test --workers=1
   12 passed
  ```
- Notes / deviations from PRD:
  - **The claim heuristic is deliberately narrow.** It gates a metered call, so the two error
    directions are not symmetric: a false positive spends one of the student's 10–30 monthly CITE
    units and interrupts their typing, while a false negative costs nothing because they can still
    ask by hand. Structural sentences are excluded outright — A.1 tells the model to write "This
    section examines…" when it has no passage to cite, so offering a citation for one would be
    nonsense. Twenty sentences pin the boundary, ten each way, as PHASES 3.6 asks.
  - The trigger listens only for `.`, `!` and `?` on keyup and remembers the sentences it has
    already asked about, so FR-4.5's "never on every keystroke, at most once per sentence end"
    holds without a debounce timer.
  - **A declined suggestion is silence, not a message.** The heuristic saying no, an empty library,
    or a network failure all render nothing. Only a cap refusal speaks, because that one is about
    the student's plan rather than about this sentence.
  - Retrieval runs *before* the cap check here, unlike Assist. With no passages there is nothing to
    cite and therefore nothing to charge for; charging first would bill for an empty answer.
  - A.3 shares Assist's cached prefix (preamble + memory), so a CITE call reuses the block Assist
    has already warmed rather than paying a second cache write (§10.3).
  - **The golden set's scenarios are the human's to write** (§0.3 rule 3 forbids the agent
    authoring fixture expectations, and C.5's value is the owner's judgement of a good suggestion).
    The runner, the judge and a `example.draft.json` template are built and tested; the judge is
    proven against hand-made outputs with no key needed. The real-provider half is nightly only,
    behind `RUN_GOLDEN=1`, because a model's answer varies between runs and must never gate a PR.
  - The judge scores the *post-processed* text, not the raw output. The student never sees the raw
    output, so a prompt that leans on A.1's two-sentence cut is not thereby broken.
  - `window.prompt` replaced with an inline input (3.7): it blocked the page, stole focus from the
    document and could not be dismissed with Escape like the rest of the editor. The plugin captures
    `promptForInstruction` once, so the controller identity is stable across renders, and a pending
    promise is resolved on unmount or the next `Shift+→` would be ignored for ever.
- BLOCKED: PHASES 3.9 (ten weak suggestions with reasons) needs real model output, so it waits on a
  provider key together with 3.4's thirty-suggestion run. Both are in `docs/PENDING.md`.

## Phase 1 — Week 4 (caps, draft mode, telemetry, export)

### Task 4.2 — draft mode, server side (FR-4.4, A.2, §10.7.3)
- Files: `packages/ai/src/builder/draft.ts`, `packages/retrieval/src/context.ts`,
  `apps/worker/src/jobs/draft-section.ts`, `apps/api/src/modules/assist/{draft.service.ts,
  draft.controller.ts,sse.ts,context.service.ts}`, `packages/ai/test/draft.spec.ts`.
- Evidence:

  ```
  $ pnpm test
   config 62 · types 39 · ui 37 · db 2 · ai 188 (+1 skipped) · retrieval 149 · web 6 ·
   worker 39 · api 80        = 604 passing
  $ pnpm lint
   Checked 244 files. No fixes applied.
  ```
- Notes / deviations from PRD:
  - **There is no `Draft` table, and none was added.** PRD §8 defines none, and FR-4.4 puts the
    draft in the document as a marked block the student must accept or discard. So the durable
    record is the `SuggestionEvent` plus the block itself, and §9.3's `draftId` is that event's id.
    Accept and discard write the outcome, which is exactly what FR-9.4's telemetry measures.
  - **The refusal is the feature.** Draft writes hundreds of words at once, so an ungrounded draft
    is the most damaging output this product could make: fluent prose citing nothing, in a document
    that will be examined. With no retrievable passages the job refuses and names the fix ("pin at
    least one source"), and the cap unit is refunded because the student was not served.
  - A passage cited more than A.2's limit of three is **recorded, not rewritten**. Deleting the
    fourth citation would leave a claim uncited, which is worse than an over-cited one.
  - **The context glue moved to `@tc/retrieval`.** The worker needs the identical memory block and
    §10.4 retrieval the API uses, and the two must not drift: a draft retrieved from a different
    candidate set than the Assist call beside it would cite different sources for the same chapter.
    `ContextService` is now Nest wiring plus the §10.3 trim logging.
  - The SSE hijack block moved to `assist/sse.ts` and both endpoints share it. The CORS header and
    the disconnect detection each cost a debugging session in week 1; a second copy would
    eventually lose one of them.
  - The worker publishes progress and the result to a Redis channel and the API relays it, rather
    than the API making the call. A student who reloads mid-draft has not lost it: the worker
    finishes regardless and the result is waiting on the channel.
  - `target_words` sits in the cached block, so drafting at two lengths makes two cached prefixes.
    That is correct rather than wasteful: the instruction really did change.
- Still to do in 4.2: the editor trigger (`Ctrl+Shift+D`) and the draft block's needs-source notes,
  then the two E2E cases PHASES asks for. The server half is complete and unit-tested.
