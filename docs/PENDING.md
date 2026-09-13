# PENDING — work only the human can do

The agent builds every phase it can (owner's instruction, 2026-09-04) and lists here everything
that needs you. Each item says what, why, and exactly how. Do them in any order; nothing below
blocks the agent from continuing to build against mocks.

## Accounts, keys and services

- [x] **Anthropic API key + model ids.** Done 2026-09-08. The owner supplied the key; it is in the
      root `.env` (git-ignored). Both `claude-haiku-4-5-20251001` and `claude-sonnet-5` were
      accepted by the provider on a live call. **The key is kept but no longer used**: on
      2026-09-13 the owner moved both tiers to OpenAI (ADR-0011) and instructed that the Anthropic
      key stay in place, unused. No configured model routes to it, so nothing calls it; putting a
      `claude-*` id back on either tier is all it takes to use it again.
- [x] **OpenAI API key** (ADR-0011). Done 2026-09-13. `OPENAI_API_KEY` is in `.env`, and both tiers
      now name OpenAI models, so the vendor is derived and the key is required at boot.
      `pnpm ai:verify` probes each tier against the vendor its id belongs to and both came back
      live: `gpt-5-nano` (fast) and `gpt-5-mini` (strong).
- [x] **Decide whether nano actually ships.** Decided 2026-09-13: **yes**, `gpt-5-nano` on the fast
      tier. It was rejected first on a six-run sample and that was wrong — over 30 runs across
      three real Assist prompts nano produced a usable, correctly-cited suggestion 29/30 (97%)
      against `gpt-4o-mini`'s 27/30 (90%), at 2.4× less cost. The correction is recorded at the
      end of ADR-0011.
      **This is not the full answer.** It is 30 runs on three prompts, not the Appendix C.5 golden
      set, which is still blocked on the fixture papers. If the golden set contradicts it, the fast
      tier is one environment variable away from moving back.
- [ ] **Amend the PRD for ADR-0011**: §7.2's AI SDK row (a second provider, and per-tier routing)
      and §13.3's variable list (`OPENAI_API_KEY`). Same kind of follow-up as ADR-0010's A.17.
- [x] **Confirm the model prices** (§0.3 rule 4 — the agent must not guess a price). Done
      2026-09-13, read off each provider's own published pricing page and written into
      `packages/config/src/pricing.ts` as per-model entries:
      `gpt-5-nano` $0.05/$0.40 per M, `gpt-5-mini` $0.25/$2.00, cached input 0.1× on both, no
      cache-write charge (OpenAI caches automatically and bills nothing to populate).
      **This also corrected a live error:** `claude-sonnet-5` was priced at $3/$15, which is
      Sonnet 4.6's rate — the page carries a note that the rise scheduled for 2026-09-01 was
      cancelled, so it is $2/$10. That alone moved the STUDENT total from ₹98.92 to ₹86.03 while
      we were still on Claude.
      **Still yours:** confirm both pages independently before the pilot bills anyone. Prices
      change and nothing in the product re-reads them.
- [x] **Voyage API key + embedding model.** Done 2026-09-08. `VOYAGE_API_KEY` is in `.env` with
      `EMBED_PROVIDER=voyage` and `AI_EMBED_MODEL=voyage-3`; `ai:verify` got 1024-d vectors back,
      matching `EMBED_DIMS` and the `vector(1024)` column.
- [ ] **Fill PRD Appendix E.3 and flip the flag.** `pnpm ai:verify` ran fully real on 2026-09-08 and
      again on 2026-09-13 after the move to OpenAI — no mock in either — and passed both times. Paste the block it prints into Appendix E.3 (`docs/PRD.md`),
      filling "Verified value" and "By" yourself: §0.3 rule 3 forbids the agent filling that table.
      Then flip the flag (admin UI, or
      `UPDATE "FeatureFlag" SET enabled=true WHERE key='costModelVerified'`); the admin page reads
      "Cost model: UNVERIFIED" until you do. What the run printed:

      | Item | Value |
      |---|---|
      | Fast model id | `gpt-5-nano` (OpenAI) — accepted live |
      | Strong model id | `gpt-5-mini` (OpenAI) — accepted live |
      | Embedding model | `voyage-3`, 1024 d — accepted live |
      | Exchange rate | INR 87 = USD 1 (`pricing.ts`) |
      | Recomputed §11.4 STUDENT total | **₹14.18**, within the ceiling by ₹85.82 |

      Still yours to supply in that table: independent confirmation of the two model prices, the
      cache multipliers and the VPS monthly cost, none of which the agent may guess (§0.3 rule 4).
      The prices in `pricing.ts` were read off each provider's published page on 2026-09-13; that
      is the agent reading a page, not a human confirming a contract.
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

- [ ] **Settle the price and the caps together.** `docs/COSTING.md` gives the cost side:
      ₹14.18 per fully active student, ₹299 charged, 95% margin. `docs/PRICING-REVIEW.md` reviews
      `RADemics_Thesis_Copilot_Pricing.docx` and its ₹349 / ₹2,999 proposal — but that review was
      written on Haiku + Sonnet, and §1 and §4 of it are superseded by the OpenAI move; the
      addendum and §"The caps are now far tighter" below carry the current numbers. The code still
      has ₹299 / ₹2,499 in `packages/config/src/billing.ts` and PRD §11.6 still marks the price
      `DECISION PENDING`.
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

## What the ₹100 ceiling actually rests on (revised 2026-09-13)

Two things enforce it, and only the second is a guarantee.

- **The projection**: caps × modelled cost per call = **₹14.18** for a fully active STUDENT.
  `pnpm ai:verify` and CI both recompute it and fail over ₹100. This catches a bad plan.
- **The runtime hard stop** (built 2026-09-08, `UsageService.consume`): the sum of actual logged
  spend for the period is checked before every metered call and refuses at ₹100 with its own
  reason and its own error, because a ceiling refusal can arrive while the action counter still
  shows units left. The owner chose "tell them the limit is over" over degrading to a cheaper
  model. 11 tests in `apps/api/test/ceiling.spec.ts`. This catches reality being different from
  the plan.
- **An alert below the ceiling** (2026-09-12): `ALERT.userApproachingInr` at ₹85, as an else-if
  against the existing ₹120, so a user gets one email rather than two.

The projection has moved a long way and every move was a defect or a decision, not drift:

| | STUDENT total | What changed |
|---|---|---|
| 2026-09-08 | ₹98.92 | Haiku 4.5 + Sonnet 5, Sonnet priced at $3/$15 |
| 2026-09-13 | ₹86.03 | Sonnet 5 is $2/$10 — the scheduled rise was cancelled |
| 2026-09-13 | ₹26.40 | ADR-0011: `gpt-4o-mini` + `gpt-5-mini` |
| 2026-09-13 | ₹16.68 | `gpt-5-nano` on the fast tier after a 30-run re-measurement |
| **2026-09-13** | **₹14.18** | the one-time-ops line was still priced at the tier fallback |

**What is still not proven, and it is the same thing it always was:**

- [ ] **Prove the prompt cache engages on real chapters.**
      `cost.ts` prices every fast-tier action assuming a 4,000-token cached prefix read at 0.1×.

      | Assist unit cost | STUDENT month total | |
      |---|---|---|
      | as modelled (4k cached) | ₹0.0097 | **₹14.18** ✅ |
      | if the cache never engages | ₹0.0244 | **₹16.81** ✅ |

      At our own caps this no longer threatens the ceiling — the move to nano bought so much
      headroom that a total cache failure costs ₹2.63 a month. **It still matters for any larger
      tier.** The owner's proposed 7,500-autocomplete tier is ₹99 with the cache and **₹215.71**
      without it, so the cache is the difference between that tier being viable and not.

      The first real call in the product came back `cachedInputTokens: 0`, because a 657-token
      prompt is under the fast tier's cache floor — harmless there, but it means the cached case
      is still unmeasured. A full chapter with six pinned passages is the case that matters, and
      it is only reachable with the fixture papers.

      OpenAI caches automatically on prefixes over ~1,024 tokens with no marker, so there is
      nothing to configure — only something to confirm.

---

## The caps are now far tighter than the money requires

- [ ] **Decide how generous the plans should be.** This item used to read "the ceiling has about ₹1
      left". It is now the opposite problem: a fully active STUDENT costs **₹14.18** of a ₹100
      ceiling, so **86% of the allowance is unused**.

      What fits, all recomputed 2026-09-13 on the configured models (`docs/COSTING.md` has the
      working):

      | | Ships today | A generous tier that still fits | The owner's pricing doc, adjusted |
      |---|---|---|---|
      | Autocomplete | 180 | 4,000 | 7,500 |
      | Citation suggestions | 30 | 100 | 100 |
      | Chat | 15 | 100 | 100 |
      | AI edits | 4 | 100 | 200 (on the fast model) |
      | Drafts | 10 | 20 | 10 |
      | Coherence | 1 | 8 | 8 |
      | **Cost** | **₹14.18** | **₹64.60** | **₹99.05** |
      | **Margin at ₹299** | 95% | 78% | 67% |

      The last column is `RADemics_Thesis_Copilot_Pricing.docx`'s own tier with two changes:
      autocomplete capped at 7,500 rather than 8,000, and AI edits moved from the strong model to
      the fast one. On Haiku + Sonnet that same tier cost ₹1,772; `docs/PRICING-REVIEW.md` said it
      was not survivable and that was true of those models.

      Three things to settle, and they are all yours:

      1. **The caps.** Raising them is a config change in `plans.ts`, no new code.
      2. **Whether AI edits move to the fast tier.** That is what makes the 200-edit row cheap
         (₹31.32 → ₹6.26), and it is a quality decision, not an arithmetic one.
      3. **The advertised cap and the enforced ceiling must be the same number.** If the pricing
         page says 8,000 autocompletes and the runtime stops at ₹100, a heavy user is cut off
         before the number they paid for. That is a refund problem, not a cost problem.

      Nothing here is settled by the agent, and none of it blocks other work.


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
