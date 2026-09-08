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
- [ ] **Voyage API key + embedding model.** `VOYAGE_API_KEY`, `AI_EMBED_MODEL` (1024-d), `EMBED_PROVIDER=voyage`.
- [ ] **Finish `pnpm ai:verify` and fill Appendix E.3.** Half-done: run on 2026-09-08 with the
      Anthropic key, both LLM ids confirmed live, STUDENT budget recomputed at **₹98.92 ≤ ₹100**.
      The embedding row is still the mock's, so the run is **not yet quotable** — the script says so
      itself. Once `VOYAGE_API_KEY` is set, re-run and paste the printed table into PRD Appendix
      E.3 (`docs/PRD.md`), filling "Verified value" and "By" yourself — §0.3 rule 3 forbids the
      agent filling that table. Then flip the flag (admin UI, or
      `UPDATE "FeatureFlag" SET enabled=true WHERE key='costModelVerified'`); the admin page reads
      "Cost model: UNVERIFIED" until you do. What the 2026-09-08 run printed, for reference:

      | Item | Value |
      |---|---|
      | Fast model id | `claude-haiku-4-5-20251001` — accepted, 21 in / 4 out on the probe |
      | Strong model id | `claude-sonnet-5` — accepted, 26 in / 4 out |
      | Embedding model | `mock-embed`, 1024 d — **not real yet** |
      | Exchange rate | INR 87 = USD 1 (`pricing.ts`) |
      | Recomputed §11.4 STUDENT total | ₹98.92, within by ₹1.08 |
- [ ] **Email delivery key**: `RESEND_API_KEY` (or `SMTP_HOST` + `SMTP_PORT`, plus `SMTP_USER` /
      `SMTP_PASS` if the relay wants them) and `MAIL_FROM` in the production `.env`. Both
      transports are built (`apps/api/src/common/mailer.ts` — Resend through its SDK, SMTP through
      nodemailer — chosen once at boot by `MailerModule`, 16 tests) and carry the sign-in code,
      the §14 alert emails (user cost > ₹120, platform average > ₹90, job failures > 5 %, TTFB p95
      > 900 ms, each over 15 min; sent to `SEED_ADMIN_EMAIL`), billing reminders and review
      invitations. With Resend, verify the sending domain in its dashboard first: an unverified
      `MAIL_FROM` is refused per message and the API logs the refusal. Dev keeps printing the
      one-time code to the API console. The first live check is simply signing in.
- [ ] **Google sign-in** (optional): `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, both or neither.
- [ ] **Scholarly API contact emails**: set `OPENALEX_MAILTO`, `CROSSREF_MAILTO`, `UNPAYWALL_EMAIL`
      to a real address you monitor (polite-pool rules). Optional: `SEMANTIC_SCHOLAR_API_KEY`, `CORE_API_KEY`.
      **Now blocking, not cosmetic.** They are all still `you@example.com`, and Unpaywall rejects
      that exact address with HTTP 422, so no source can reach `FULL_TEXT` grounding and the whole
      full-text path (task 2.6) cannot be measured. Crossref and OpenAlex do answer a placeholder,
      but only outside their polite pool. The worker warns about this at boot; verified with
      `curl "https://api.unpaywall.org/v2/10.1038/nature14539?email=<address>"` returning 200.
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
