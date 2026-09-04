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
