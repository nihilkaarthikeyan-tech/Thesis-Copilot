# PENDING — work only the human can do

The agent builds every phase it can (owner's instruction, 2026-09-04) and lists here everything
that needs you. Each item says what, why, and exactly how. Do them in any order; nothing below
blocks the agent from continuing to build against mocks.

## Accounts, keys and services

- [ ] **Anthropic API key + model ids.** Put `ANTHROPIC_API_KEY`, `AI_FAST_MODEL`, `AI_STRONG_MODEL`
      in `.env`, set `AI_PROVIDER=anthropic`. Choose ids from https://docs.claude.com/en/docs/about-claude/pricing.
      Why: the app refuses to guess model ids (PRD §0.3 rule 5); all AI runs on a mock until then.
- [ ] **Voyage API key + embedding model.** `VOYAGE_API_KEY`, `AI_EMBED_MODEL` (1024-d), `EMBED_PROVIDER=voyage`.
- [ ] **Run `pnpm ai:verify` with the real keys** and paste the printed table into PRD Appendix E.3
      (`docs/PRD.md`). Then flip the `costModelVerified` feature flag (admin UI, or
      `UPDATE "FeatureFlag" SET enabled=true WHERE key='costModelVerified'`). Why: PRD §0.3 rule 5;
      the admin page shows "Cost model: UNVERIFIED" until then. Budget printed must be ≤ ₹100.
- [ ] **Email delivery**: `RESEND_API_KEY` (or `SMTP_*`) in the production `.env`. Dev prints the
      one-time code to the API console instead.
      **Now also carries the §14 alert emails** (user cost > ₹120, platform average > ₹90, job
      failures > 5 %, TTFB p95 > 900 ms, each over 15 min). The alerts are built and tested through
      a console mailer that records what it would have sent; a Resend or SMTP implementation of
      `Mailer` in `apps/api/src/common/mailer.ts` is the one file to add once a key exists. The
      admin address they go to is `SEED_ADMIN_EMAIL`.
- [ ] **Google sign-in** (optional): `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, both or neither.
- [ ] **Scholarly API contact emails**: set `OPENALEX_MAILTO`, `CROSSREF_MAILTO`, `UNPAYWALL_EMAIL`
      to a real address you monitor (polite-pool rules). Optional: `SEMANTIC_SCHOLAR_API_KEY`, `CORE_API_KEY`.
      **Now blocking, not cosmetic.** They are all still `you@example.com`, and Unpaywall rejects
      that exact address with HTTP 422, so no source can reach `FULL_TEXT` grounding and the whole
      full-text path (task 2.6) cannot be measured. Crossref and OpenAlex do answer a placeholder,
      but only outside their polite pool. The worker warns about this at boot; verified with
      `curl "https://api.unpaywall.org/v2/10.1038/nature14539?email=<address>"` returning 200.
- [ ] **Fastify pin decision** (PHASES 5.4): `pnpm audit` reports one moderate in `fastify`
      ("schema validation bypass via root primitive coercion"). Fastify is pinned at 5.11.3 by
      `pnpm.overrides` (week 1, to keep one copy in the tree); 5.12.3 exists. Either bump the pin
      and re-run the SSE tests (`apps/api/test/week1.spec.ts`, the E2E), or accept the moderate —
      §12.1's bar is high/critical, which the audit passes today. Nothing else in the audit is in a
      request path.
- [ ] **CORE fallback** (PHASES 2.6 / 5.1): needs `CORE_API_KEY`, optional in §13.3. Without it the
      client cannot be exercised, and Unpaywall already covers the open-access path. Not built.
- [ ] **Razorpay** (Phase 2 week 11): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
- [ ] **Sentry DSN** (optional, week 5).

## Deployment

- [ ] **VPS** (8 vCPU / 16 GB / 160 GB, Ubuntu 24.04, Docker) + a **domain** pointing at it + SSH key.
- [ ] Copy the repo to `~/thesis-copilot` on the VPS, create `infra/compose/.env` from
      `infra/compose/.env.production.example` plus the root `.env.example` values.
- [ ] **GitHub secrets** for `release.yml`: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `DOMAIN`,
      `NEXT_PUBLIC_API_URL` (= `https://<domain>`). GHCR is enabled automatically with `GITHUB_TOKEN`.
- [ ] **Off-site backup bucket**: `BACKUP_S3_ENDPOINT/ACCESS_KEY/SECRET_KEY/BUCKET` in the VPS `.env`.
- [ ] Push a tag (`git tag v0.1.0 && git push --tags`) and confirm `https://<domain>/api/v1/health` is 200.
- [ ] Check the first CI run is green: https://github.com/nihilkaarthikeyan-tech/Thesis-Copilot/actions

## Test material (PRD Appendix C — the agent must never fabricate these)

- [ ] **Five fixture papers** `fixtures/papers/p01.pdf … p05.pdf` + `p05.docx`, per the checklist in
      `fixtures/papers/README.md`. Needed for extraction accuracy scoring (Phase 1 week 2).
- [ ] After the agent writes `pNN.expected.draft.json`, correct them and rename to `pNN.expected.json`.
- [ ] **Retrieval Q&A set** `fixtures/retrieval/qa.json` (30 questions → correct chunk ids), Appendix C.4.
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
