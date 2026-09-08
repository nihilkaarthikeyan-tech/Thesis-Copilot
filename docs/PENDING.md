# PENDING — work only the human can do

The agent builds every phase it can (owner's instruction, 2026-09-04) and lists here everything
that needs you. Each item says what, why, and exactly how. Do them in any order; nothing below
blocks the agent from continuing to build against mocks.

## Accounts, keys and services

- [x] **Anthropic API key + model ids.** Done 2026-09-08. The owner supplied the key; it is in the
      root `.env` (git-ignored) with `AI_PROVIDER=anthropic`,
      `AI_FAST_MODEL=claude-haiku-4-5-20251001` and `AI_STRONG_MODEL=claude-sonnet-5`. Both ids
      were accepted by the provider on a live call — see the `ai:verify` block below.
- [ ] **Confirm the two model prices** (§0.3 rule 4 — the agent must not guess a price).
      `packages/config/src/pricing.ts` has **no per-model entry** for either id, so the budget
      below falls back to the PRD §11.1 tier assumption: Fast $1/$5 per M in/out, Strong $3/$15.
      Check both against https://docs.claude.com/en/docs/about-claude/pricing. If either is
      higher, the ₹98.92 total moves and the ₹100 ceiling decision below becomes live. Add real
      entries to `pricing.ts` (or `PRICING_OVERRIDE_JSON`) and re-run `pnpm ai:verify`.
- [x] **Voyage API key + embedding model.** Done 2026-09-08. `VOYAGE_API_KEY` is in `.env` with
      `EMBED_PROVIDER=voyage` and `AI_EMBED_MODEL=voyage-3`; `ai:verify` got 1024-d vectors back,
      matching `EMBED_DIMS` and the `vector(1024)` column.
- [ ] **Fill PRD Appendix E.3 and flip the flag.** `pnpm ai:verify` ran fully real on 2026-09-08 —
      no mock in it — and passed. Paste the block it prints into Appendix E.3 (`docs/PRD.md`),
      filling "Verified value" and "By" yourself: §0.3 rule 3 forbids the agent filling that table.
      Then flip the flag (admin UI, or
      `UPDATE "FeatureFlag" SET enabled=true WHERE key='costModelVerified'`); the admin page reads
      "Cost model: UNVERIFIED" until you do. What the run printed:

      | Item | Value |
      |---|---|
      | Fast model id | `claude-haiku-4-5-20251001` — accepted live |
      | Strong model id | `claude-sonnet-5` — accepted live |
      | Embedding model | `voyage-3`, 1024 d — accepted live |
      | Exchange rate | INR 87 = USD 1 (`pricing.ts`) |
      | Recomputed §11.4 STUDENT total | **₹98.92**, within the ceiling by ₹1.08 |

      Still yours to supply in that table: the two model prices, the cache multipliers and the VPS
      monthly cost, none of which the agent may guess (§0.3 rule 4).
- [x] **Email delivery.** Done 2026-09-08, and proven by a real send. The owner's existing
      Hostinger mailbox is reused — the same one Gate, Bank and TNPSC already send their OTP and
      reset mail from, so deliverability is established rather than hoped for:
      `SMTP_HOST=smtp.hostinger.com`, `SMTP_PORT=465`, `SMTP_USER=no-reply@rademics.ai`,
      `MAIL_FROM=Thesis Copilot <no-reply@rademics.ai>`, password in `.env` (git-ignored).
      `createMailer` selected `smtp`, and one real sign-in code arrived in the owner's inbox.
      This carries the sign-in code, the §14 alert emails (to `SEED_ADMIN_EMAIL`), billing
      reminders and review invitations. `RESEND_API_KEY` stays empty and unused; the Resend
      transport is built and tested should the pilot ever want a separate sending domain.
- [ ] **Copy the SMTP block into the VPS `.env` at deploy time.** It is only in the local `.env`
      today. `infra/compose/.env.production.example` lists the five variables.
- [ ] **Consider a dedicated mailbox before the pilot.** `no-reply@rademics.ai` is shared across
      four products and its password is the same everywhere; one leak rotates all four. A
      `no-reply@` on whatever domain Thesis Copilot ships under would isolate it. Not urgent —
      the shared box works and is already warmed up.
- [ ] **Google sign-in.** Everything but the credentials is built: Better Auth's Google provider is
      registered whenever both variables are set (`apps/api/src/modules/auth/auth.ts`), the API
      reports it at `GET /api/v1/auth/methods`, and the sign-in page shows a "Continue with Google"
      button only when that says `true` — so a missing key hides the button rather than showing one
      that fails. Right now it reports `{"emailOtp":true,"google":false}`.

      To turn it on, at https://console.cloud.google.com/apis/credentials:
      1. Create (or pick) a project, then **Create credentials → OAuth client ID → Web application**.
      2. **Authorised redirect URIs** — add both, exactly:
         - `http://localhost:3001/api/v1/auth/callback/google` (local)
         - `https://<your-domain>/api/v1/auth/callback/google` (production)
         The path is `{API_URL}` + `/api/v1/auth/callback/google`; `API_URL` and the basePath are
         set in `auth.ts` and must match character for character or Google returns `redirect_uri_mismatch`.
      3. Configure the OAuth consent screen: External, app name "Thesis Copilot", your support
         email, and the `email` + `profile` scopes. While it is in *Testing* only addresses you add
         as test users can sign in — publish it before the pilot.
      4. Put the client id and secret in `.env` as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`,
         both or neither, and restart the API. The button appears on its own.
- [x] **Scholarly API contact emails.** Done 2026-09-08. `OPENALEX_MAILTO`, `CROSSREF_MAILTO` and
      `UNPAYWALL_EMAIL` are a real monitored inbox instead of `you@example.com`, checked first with
      `curl "https://api.unpaywall.org/v2/10.1038/nature14539?email=<address>"` returning 200 (the
      placeholder gets a 422, which is why no source could reach `FULL_TEXT` before). The worker no
      longer warns at boot. Change it if you would rather the polite pools wrote to a project
      address than a personal one -- it is one line each in `.env`.
- [ ] **Optional scholarly keys**: `SEMANTIC_SCHOLAR_API_KEY` (second discovery source) and
      `CORE_API_KEY` (full-text fallback, below). Both free, both skipped cleanly when unset.
- [ ] **CORE fallback key** (FR-2.2, PHASES 2.6 / 5.1): the fallback is built
      (`packages/retrieval/src/scholarly/core.ts`, wired in `apps/worker/src/jobs/index-source.ts`
      after Unpaywall fails; 11 + 8 tests against the API's recorded responses). It runs only when
      `CORE_API_KEY` is set (optional, §13.3). Register for a free key at core.ac.uk/services/api,
      set it in `.env`, then re-index one source whose DOI Unpaywall has no PDF for and look for
      `full text fetched via core fallback` in the worker log. A wrong key logs
      `core lookup failed` with HTTP 401 and the source falls back to its abstract as before.
- [ ] **Sentry** (PHASES 5.5): set `SENTRY_DSN` in the VPS `.env`. The API and worker initialise
      `@sentry/node` only when it is set (`apps/api/src/common/sentry.ts`, `apps/worker/src/sentry.ts`;
      errors only, no tracing, no PII). Then throw one on purpose — `GET /api/v1/health?boom=1`
      is not wired; the simplest is a bad `DATABASE_URL` for one request — and save the Sentry
      screenshot under `docs/evidence/`. The web app has no Sentry yet (`@sentry/nextjs` is a
      separate integration); add it if browser errors matter during the pilot.
- [ ] **Uptime Kuma** (PHASES 5.5): it is in `docker-compose.prod.yml` on `127.0.0.1:3010`. Over an
      SSH tunnel, create the admin account and add an HTTP monitor for
      `http://api:3001/api/v1/health` with keyword `"status":"ok"`, 60 s. Screenshot it green.
- [ ] **Prometheus** (PHASES 5.5): `docker compose --profile monitoring up -d` on the VPS; it
      scrapes `api:3001/metrics` every 15 s (`infra/prometheus/prometheus.yml`). Nothing exposes it
      publicly; use an SSH tunnel to 9090. Optional for the pilot.
- [ ] **k6 load test** (PHASES 5.7, §15): `infra/k6/assist-stream.js` is written; k6 is not
      installed here and PHASES wants the run against the VPS. Install k6 on your machine, sign in
      as one pilot account, then
      `k6 run -e API_URL=https://<domain> -e COOKIE='better-auth.session_token=…' -e CHAPTER_ID=<uuid> infra/k6/assist-stream.js`
      with the API on the mock provider. Paste p50/p95/error rate into `docs/BUILD_LOG.md`; the
      thresholds (p95 ≤ 600 ms, errors < 0.5%) are in the script. Reset that account's caps
      afterwards from `/admin/users/<id>`.
- [ ] **Pilot report interpretation** (PHASES 5.10): after ≥ 10 days of student use run
      `pnpm pilot:report` (or `pnpm pilot:report --json`), paste it into `docs/BUILD_LOG.md`, and
      write `docs/PILOT-1.md` — the numbers are the script's, the reading is yours.
- [ ] **`pnpm build` for the web app on Windows** (environment, not code): Next's `output:
      'standalone'` copies traced files with symlinks, and Windows refuses them without Developer
      Mode or an elevated shell — `EPERM: operation not permitted, symlink … @opentelemetry/api`.
      Every other workspace builds. `pnpm dev` and the Docker image (Linux) are unaffected, so this
      only bites if you want a production build on this machine: turn on Settings → Privacy &
      security → For developers → Developer Mode, or build in Docker.
- [ ] **Razorpay keys and plans** (PHASES v2 W11.1): create the two subscription plans in the
      Razorpay dashboard at §11.6's prices (₹299/month, ₹2,499/year), then set `RAZORPAY_KEY_ID`,
      `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_MONTHLY` and
      `RAZORPAY_PLAN_ANNUAL`. Point the webhook at `https://<domain>/api/v1/billing/webhook` and
      subscribe it to `subscription.activated`, `charged`, `pending`, `halted`, `cancelled`,
      `completed`, `paused`, `resumed`. Without the keys the product runs in full except that
      nothing can be bought, and `/app/account` says so. Then buy one subscription in test mode
      and check the caps change, the invoice PDF renders, and cancelling emails you.
- [ ] **Confirm §11.6's prices** (PRD marks it `DECISION PENDING`): ₹299 / ₹2,499 / negotiated
      institution seat are what `packages/config/src/billing.ts` and the pricing page use today.

## Deployment

- [ ] **VPS** (8 vCPU / 16 GB / 160 GB, Ubuntu 24.04, Docker) + a **domain** pointing at it + SSH key.
- [ ] Copy the repo to `~/thesis-copilot` on the VPS, create `infra/compose/.env` from
      `infra/compose/.env.production.example` (every variable, with the in-network hostnames filled in).
- [ ] **GitHub secrets** for `release.yml`: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `DOMAIN`,
      `NEXT_PUBLIC_API_URL` (= `https://<domain>`). GHCR is enabled automatically with `GITHUB_TOKEN`.
- [ ] **Off-site backup bucket**: `BACKUP_S3_ENDPOINT/ACCESS_KEY/SECRET_KEY/BUCKET` in the VPS `.env`.
- [ ] Push a tag (`git tag v0.1.0 && git push --tags`) and confirm `https://<domain>/api/v1/health` is 200.
- [ ] Check the first CI run is green: https://github.com/nihilkaarthikeyan-tech/Thesis-Copilot/actions

## Test material (PRD Appendix C — the agent must never fabricate these)

- [ ] **Five fixture papers** `fixtures/papers/p01.pdf … p05.pdf` + `p05.docx`, per the checklist in
      `fixtures/papers/README.md`. Needed for extraction accuracy scoring (Phase 1 week 2).
- [ ] After the agent writes `pNN.expected.draft.json`, correct them and rename to `pNN.expected.json`.
- [ ] **Retrieval Q&A set** `fixtures/retrieval/qa.json`, Appendix C.4: six questions per fixture
      paper, thirty in all, each with the page and a verbatim quote of the answering passage. The
      scorer and its runner are built (`packages/retrieval/src/recall.ts`,
      `test/recall.spec.ts`) — the suite reports BLOCKED and skips until the file exists, then
      prints the per-paper table for `docs/BUILD_LOG.md`.
      `fixtures/retrieval/README.md` explains what makes a usable quote, and
      `example.draft.json` is the shape to copy. §0.3 rule 2 forbids the agent writing the
      questions: the point of the set is your judgement of what a paper answers.
- [ ] **Prompt golden set**, Appendix C.5: ten Assist scenarios in `fixtures/prompts/*.json`.
      The runner, the judge and a template (`example.draft.json`) are built and tested; only your
      scenarios are missing, because §0.3 rule 3 forbids the agent writing fixture expectations and
      the point of the set is your judgement of a good suggestion. `fixtures/prompts/README.md`
      explains each field. The most valuable scenarios are the ones where the right answer is
      **not** to cite. Run with `RUN_GOLDEN=1` and a provider key; it is a nightly job, never a
      per-PR test.
- [ ] **Thirty real Assist suggestions** (PHASES 3.4 done-when): with a provider key set, run
      thirty suggestions on a fixture chapter and paste five examples (before / after / suggestion /
      citations), the hallucinated-cite count and the cache hit rate over the thirty into
      `docs/BUILD_LOG.md`. Target ≥ 70 % cache hits after warm-up (§10.3). The whole pipeline is
      built and proven on the mock; only the real-model evidence is missing.
- [ ] **Prompt observations** (PHASES 3.9): after the thirty runs, ten weak suggestions with a
      one-line reason each. The prompt files must not be edited (§0.3 rule 11); propose changes
      for the human to approve.
- [ ] **Coherence fixture thesis** `fixtures/thesis/` with planted inconsistencies (Appendix C.6, Phase 3).
- [ ] **A real university formatting guideline** to replace the `EXAMPLE_IN_UNIVERSITY` template (D.3.1).

## Decisions and reviews

- [ ] Read `docs/CONSISTENCY_REVIEW.md` — 12 places where the PRD contradicts itself; the agent picked
      a side each time and says which. Confirm or overrule.
- [ ] Acknowledge `docs/ADR/0002-better-auth-tables.md` (auth tables added to the PRD §8 schema).
- [ ] PRD §17 `DECISION PENDING` items as they come up (pricing, pilot field, data residency, GROBID).
- [ ] Tick the gate checklists in `docs/PHASES.md` (G0 … G4) against `docs/BUILD_LOG.md` evidence.
      Gates were waived for building; ticking them is still your call.

## Pilot (Phase 1 week 5)

- [ ] Recruit five pilot students; collect consent for using their papers.
- [ ] Review `docs/PILOT-1.md` when the agent produces it.

## Dependency advisories (B4.3 audit, 2026-09-07)

`pnpm audit --prod` found five moderate advisories. Four were fixed in the audit itself: `fastify`
5.11.3 → 5.12.1 (schema-validation bypass, and X-Forwarded spoofing under `trustProxy` — the app
sets `trustProxy: true` behind Caddy, so that one was live), and pnpm `overrides` for
`decode-uri-component` ≥ 0.5.0 and `stream-json` ≥ 3.5.0, both transitive under `minio@8.0.7`.

One is left, and it needs a decision:

- [ ] **`@tiptap/core` prototype pollution** (GHSA, moderate). `mergeAttributes()` turns an own
      `__proto__` key into inherited executable DOM attributes. Fixed in **3.30.4**; we are on
      2.27.3, and PRD §7.2 fixes the stack at "TipTap v2 (ProseMirror)", so the fix is a major
      upgrade — a substitution that needs an ADR and a real migration of five custom extensions
      (`ghostText`, `citation`, `draftBlock`, `provenance`, `commentAnchor`), not a version bump.

      **Mitigated, not fixed, in the meantime,** and the smoke test showed the two halves are
      different: Fastify's JSON parser already refuses a request body containing `__proto__`
      outright (HTTP 400, before any of our code runs), so the HTTP path was never open.
      `stripUnsafeKeys` in `apps/api/src/modules/chapters/word-counts.ts` covers the rest — the
      worker writing a drafted section, and a `citation` node whose attributes come from Crossref
      and OpenAlex metadata — and also strips `constructor` and `prototype`, which the parser
      lets through.

      Decide: schedule the v3 upgrade, or accept the mitigation and record why.

## What the ₹100 ceiling actually rests on (measured 2026-09-08)

The ceiling is a **design projection**, not a runtime guarantee. What enforces it today is the
per-action caps: 180 Assist × an *assumed* cost per call = ₹98.92. Nothing measures actual money
spent and refuses when it reaches ₹100 — the only runtime signal is an email to the admin once a
user passes **₹120**, which is detection after the fact, and above the ceiling.

Three things decide whether the projection holds.

- [ ] **Prove the prompt cache engages on real chapters. This is the whole promise.**
      `cost.ts` prices Assist assuming a 4,000-token cached prefix read at 0.1×. Measured:

      | Assist unit cost | Month total | |
      |---|---|---|
      | as modelled (4k cached) | ₹0.1803 | **₹98.92** ✅ |
      | if the cache never engages | ₹0.5310 | **₹162.06** ❌ |
      | measured, empty chapter (657 tok) | ₹0.0830 | ₹81.41 ✅ |

      Break-even for Assist is **₹0.1863**; the model assumes ₹0.1803. That is a **3 % margin**. The
      first real call in the product came back `cachedInputTokens: 0`, because a 657-token prompt is
      under the fast tier's cache floor — harmless there (small prompt, cheap call), but it means
      the cached case is still unproven. A full chapter with six pinned passages is the case that
      matters, and it is only reachable with the fixture papers.

- [ ] **Decide whether to add a hard stop at ₹100 of actual spend.** Caps are a proxy for cost, not
      a measure of it. A per-user month-to-date ceiling that refuses metered actions at ₹100
      regardless of remaining caps is the only thing that *guarantees* the number. It is maybe half
      a day's work, and it needs a product decision first: a student who has written all month is
      told "no more AI until the 1st" while their Assist counter still shows 40 left. Alternatives:
      degrade to the cheaper model instead of refusing, or alert the admin and let a human decide.

- [ ] **Lower the alert threshold below the ceiling.** `ALERT.userCostInr` is ₹120 — it only fires
      once a user is already ₹20 over. A second threshold around ₹85 would give warning while there
      is still something to do about it.

---

## The ₹100 ceiling has about ₹1 left

- [ ] **Decide what gives.** Building FR-3.6 surfaced this (ADR-0008): the STUDENT plan computes to
      **₹98.92** of the ₹100 ceiling, and was at ₹99.61 before that feature was metered. §11.4's own
      table prints ≈₹95.8 using rounded unit costs; the exact rates leave about a rupee.

      That is not a bug — it means the ceiling is doing its job — but the next Strong-tier feature
      will not fit, and neither will a real provider's prices if they are higher than
      `DEFAULT_PRICING` assumes. §11.4 already names the lever: with `draftModeStrongTier` off,
      Draft costs ₹8 instead of ₹27 and the total falls to about ₹80.

      Nothing here is evidence yet. Every figure comes from `DEFAULT_PRICING` and every AI call so
      far went to the mock; `pnpm ai:verify` with a real key is what settles it. Do that first, then
      decide: Fast-tier drafts, lower caps, or a higher ceiling.

## After the VERIFY batch (2026-09-07)

Every test `docs/PHASES-version-2.md` → VERIFY names is written and passing. What it could not
produce, because none of it is the agent's to make up:

- [ ] **`docs/PILOT-1.md`.** `pnpm pilot:report` runs and prints the platform table, but every row
      in it today is a smoke-test account of this build's own making and every AI call went to the
      mock, so the cost column is ₹0 by construction. The report needs five real students using
      the product for a few weeks. The numbers are the script's; the reading is yours.
- [ ] **A coherence fixture thesis** (`fixtures/thesis/`, Appendix C.6) with inconsistencies you
      planted on purpose. `coherence-run.spec.ts` proves the run's lifecycle, the flag identity
      across re-runs and the mechanical checks; what it cannot prove is whether the model *finds*
      a contradiction a supervisor would care about, and that needs a thesis where you know the
      answer. §0.3 rule 2 forbids the agent writing the expectations.
- [ ] The C.3 scoring set, the C.4 recall set, the C.5 golden scenarios and the thirty-run Assist
      evidence, all listed above and all blocked on the same two things: fixture papers and a
      provider key.

## Prompt for FR-5.6 (ADR-0010)

- [ ] **Add an `A.17 Citation role rewrite` section to the PRD** with the text of
      `packages/ai/prompts/cite_role.md`. Appendix A had no prompt for FR-5.6, so that file is the
      one hand-written prompt in the product and is marked as such. Once the PRD carries it, the
      file becomes a verbatim copy like the other 21 and ADR-0010 becomes history.
