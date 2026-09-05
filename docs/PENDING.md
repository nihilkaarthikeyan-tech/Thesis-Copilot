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
- [ ] **Google sign-in** (optional): `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, both or neither.
- [ ] **Scholarly API contact emails**: set `OPENALEX_MAILTO`, `CROSSREF_MAILTO`, `UNPAYWALL_EMAIL`
      to a real address you monitor (polite-pool rules). Optional: `SEMANTIC_SCHOLAR_API_KEY`, `CORE_API_KEY`.
      **Now blocking, not cosmetic.** They are all still `you@example.com`, and Unpaywall rejects
      that exact address with HTTP 422, so no source can reach `FULL_TEXT` grounding and the whole
      full-text path (task 2.6) cannot be measured. Crossref and OpenAlex do answer a placeholder,
      but only outside their polite pool. The worker warns about this at boot; verified with
      `curl "https://api.unpaywall.org/v2/10.1038/nature14539?email=<address>"` returning 200.
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
- [ ] **Prompt golden set** review, Appendix C.5 (the agent drafts; you judge).
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
