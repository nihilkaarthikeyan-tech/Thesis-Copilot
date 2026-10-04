# PENDING — work only the human can do

The agent builds every phase it can (owner's instruction, 2026-09-04) and lists here everything
that needs you. Each item says what, why, and exactly how. Do them in any order; nothing below
blocks the agent from continuing to build against mocks.

## Decision: proofreading on the stronger model? (2026-09-30)

Proofreading runs on gpt-5-nano and catches about 60% of planted errors (missed typos such as
"indsutry"). On gpt-5-mini the same prompt fixed 50 of 60 against 41, with fewer extra edits in
faulty sentences, and a few more edits to sentences that had no planted error. It would cost more
per proofread (the strong tier is several times the fast tier's price) and needs an ADR and a
`docs/COSTING.md` update. Say yes or no; nothing changes until you do. Evidence:
`packages/ai/eval/results/proofread-*.json`, `docs/BUILD_LOG.md` → "Prompt evaluation, rounds 2
and 3".

## Autocomplete model and allowance (ADR-0051, 2026-10-04)

- [ ] **On the next release, set `AI_FAST_MODEL=gpt-4.1-mini`** in the VPS `.env` (it is a setting,
      not code). The shakedown passed every fast-tier task on it; a fully active student costs
      ₹74.64 against the ₹100 ceiling.
- [ ] **Decide the monthly suggestion allowance.** Paid plans allow 180 autocomplete suggestions a
      month — fewer than Jenni's *free* plan (10 a day). On `gpt-4.1-mini`, 300 a month costs
      ₹85.87 per fully active student; 500 would break the ₹100 ceiling. Say the number and it is
      one line in `packages/config/src/plans.ts`.
- [x] **Decided 2026-10-04: automatic suggestions and automatic sources are on** (ADR-0053), by
      the `automaticSuggest` and `autoSources` flags in production. Pause suggestions count against
      the allowance above, which makes that decision more pressing.

## Citations and equations (ADR-0045, 2026-10-03) — what a person should do

- [ ] **Tell the students who complained.** Citations no longer share labels or vanish under a
      command, and AI-written equations arrive as real equations. A chapter written before the
      fix repairs itself the first time it is opened; nothing is needed from the student.
- [ ] **Optional: re-key theses nobody will reopen.** The repair runs in the editor. For an
      abandoned thesis that will still be exported, a one-off script over
      `rekeyDuplicateCitations` (`@tc/citations`) does the same server-side. Say if you want it.
- [ ] **Evaluate preamble rule 7** (LaTeX for equations) in the next ADR-0038 round, with a
      shakedown case that writes an equation. It is a format rule, added without the side-by-side.

## Research-type guidance (ADR-0047, 2026-10-03)

- [ ] **Read the guidance once** (`packages/config/src/profiles/guidance.ts`): one short block per
      research type telling the writer what counts as evidence and what an examiner calls a
      mistake. A law and a humanities colleague are the people to check those two. It is data;
      say what to change and it is one edit.

## Competitor-parity features (ADRs 0040–0042, 2026-10-03) — optional human steps

These shipped grounded and un-metered; none blocks anything. The human steps only widen them.

- [ ] **A licensed indexing provider (Scopus / Web of Science).** The indexing check
      (`packages/retrieval/src/indexing/provider.ts`, ADR-0042) verifies DOAJ membership and ISSN
      registration from OpenAlex, free; Scopus and Web of Science stay reported as `unknown`
      because their catalogues are paid. If you license one, implement `IndexingProvider` against
      its API (the interface and the OpenAlex default are the template) and set its key in env.
      Until then the journals screen and the indexing status never claim a venue is in Scopus — it
      says unknown, never "not indexed".
- [ ] **Confirm the ₹299 / Scopus-targeting framing** against what you actually tell students the
      journal matcher does (ADR-0040). It ranks fit and shows real OpenAlex citedness, never a
      Journal Impact Factor; marketing copy must not promise an impact factor or a guaranteed
      acceptance.
- [ ] **Optional: inline originality check in the editor.** The overlap check (ADR-0042) is a
      read-only page at `/app/d/:id/originality` and a `POST /documents/:id/overlap` endpoint today.
      Wiring it to flag the current selection inside the TipTap editor is a nice-to-have; it needs
      an editor extension and is deferred, not built. It must stay read-only — report the overlap,
      never offer to reword it (§12.3).

## Chapter build (ADR-0039, 2026-10-01) — what only a person can supply

- [ ] **Confirm the university profiles against the manuals.** `packages/config/src/profiles/universities.ts`
      ships five, every one `confirmed: false`; the build screen says so. For each university you
      will support: the in-text citation form (surnames only? "and" or "&"? "et al." from how many
      authors?), spelling variant, whether a chapter summary is required, and the manual's name,
      version and date. Ranjith's spec lists Anna University's page and font values (A4; margins
      38/25/25/25 mm; Times New Roman 12 at 1.5) — those belong in the institution template
      (Admin → template), and the spec itself says "confirm against the official manual".
- [ ] **Approve the pitfall bank as a domain expert** (spec §8.2: "every entry is approved by a
      domain expert before going live"). The fifteen engineering entries came in approved because
      they are Ranjith's own evaluation findings; a materials engineer should read them once
      (Admin → Pitfall bank), and each other discipline needs its own seed (the spec suggests
      correlation-as-causation for social sciences, overruled cases for law, superseded guidelines
      for medicine). Students' reports arrive there as pending.
- [ ] **The AA7050 gold test** (spec §13.2). It needs the original Chapter 1 the evaluation was made
      on. Put it in `fixtures/thesis/aa7050-chapter1.docx` (`fixtures/thesis/README.md`); the
      runner `apps/worker/test/gold-aa7050.spec.ts` is written, reports BLOCKED until the file
      exists, then asserts 90% recall of the code-checkable list and prints what it missed.
- [ ] **Evaluate the three new prompts** (`entities.md`, `examiner.md`, `fix_flagged.md`) under
      ADR-0038 once a few real chapters have been built: the harness needs real built sections as
      material. `pnpm ai:shakedown` should get cases for them too before the next release.
- [x] **Done 2026-10-01: the first two real builds**, Literature Review of the Hastelloy EDM thesis
      on gpt-5-mini, ₹5.93 and ₹4.43, QA reports read, seven faults fixed from run 1 and the
      missing per-call timeout from run 2 (`docs/BUILD_LOG.md` → "The first real chapter build").
      **Still yours before a release:** read one built chapter yourself, on a thesis with a fuller
      library (twenty papers or more), and say whether an examiner would accept it.
- [ ] **The monthly benchmark against Jenni** (spec §13.4): 20–30 matched inputs per profile through
      both tools each release, scored by the checks plus a blind expert rating. The machine half is
      built: put each pair in `fixtures/benchmark/<case>/` (`README.md` there) and run
      `pnpm ai:benchmark`. Writing the Jenni side and the expert rating are a person's, with a
      budget and a panel.
- [ ] **Tamil and other languages** (spec Phase 4): the build passes the document language through
      to every prompt as the rest of the product does; a native-speaker review of one built chapter
      is what says whether the checks (spelling pairs, abbreviations, terminology) need language
      variants.

## Accounts, keys and services

### Keys still to add (checked on the production server, 2026-09-29)

Missing in the VPS `.env`, each with its steps further down this file:

| Key | What it unlocks | Urgency |
|---|---|---|
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_MONTHLY`, `RAZORPAY_PLAN_ANNUAL` | Students can pay | **Needed by 2026-10-13.** The free trial ends 14 days after sign-up (ADR-0036) and applies to accounts created from 2026-09-29 13:11 UTC; the first can end on 2026-10-13. Without these keys a student whose trial ends cannot subscribe — "See plans" leads to a page that cannot take money. Until then, extend trials from Admin → Users. |
| `CORE_API_KEY` | Full-text fallback for papers with no open PDF (FR-2.2) | Useful |
| `SENTRY_DSN` | Error reports from production | Useful |
| `BACKUP_S3_*` | Backups copied off the VPS | Important: today backups live only on the same server |
| `SEMANTIC_SCHOLAR_API_KEY`, `NCBI_API_KEY` | Higher rate limits for literature search | Optional |

Already set and working: OpenAI, Voyage, Anthropic (kept unused), SMTP mail, Google sign-in,
OpenAlex.

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
- [ ] **Review the citation-support prompt** (ADR-0023): `packages/ai/prompts/coh_support.md`, the
      second prompt not taken from PRD Appendix A (the first is `cite_role.md`, ADR-0010). It decides
      whether a cited passage supports, overstates, misrepresents or only weakly supports the
      sentence citing it. If it reads right, add it to the PRD as A.12.5 so the file becomes a
      verbatim copy like the others; if not, say what to change — the agent does not edit a prompt
      on its own judgement (§0.3 rule 11).
- [ ] **Review the proofreading prompt** (ADR-0026): `packages/ai/prompts/proofread.md`, the third
      prompt not from Appendix A. It asks for spelling, grammar, punctuation and agreement
      corrections as the smallest span. The line against paraphrasing does not rest on it — code
      refuses anything that puts a different word in (`correctionSize`) — but it is still content
      and still yours. Same choice as above: add it to the PRD as an A.12 entry, or say what to
      change.
- [ ] **Review the two viva prompts** (ADR-0030): `packages/ai/prompts/viva_questions.md` and
      `viva_feedback.md`, the fourth and fifth not from Appendix A. The first writes examiner
      questions about paragraphs of the student's thesis; the second judges a typed answer and
      must never write the answer for them. Code already drops a question about an unsent
      paragraph and any quotation that is not the thesis's own words. Same choice as above: add
      them to the PRD as A.12 entries, or say what to change.
- [ ] **Know this before moving the strong tier back to Claude** (ADR-0030): the ₹100 check now
      judges the whole budget at the configured models. Viva's 30 uses a month cost ₹11.16 on
      `gpt-5-mini` and would cost ₹98.66 on Sonnet, so its cap must come down first.
      `pnpm ai:verify` prints the budget for whatever `.env` configures.
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
- [x] **Done 2026-09-25 (see the Voyage entry below): add a payment method to the Voyage account —
      it was rate-limited to 3 requests a minute.** Hit on 2026-09-14: `429 … you have not yet added your payment method in the billing page and
      will have reduced rate limits of 3 RPM and 10K TPM`. Every chapter index and every chat
      question needs an embedding, so at 3 RPM the product is unusable with more than one student
      on it. The 200M free tokens still apply once a card is on file — this is about the rate
      limit, not the bill. dashboard.voyageai.com, billing page.
      **Seen again 2026-09-24:** a real Discover run fetched 125 candidates and failed at the
      embedding step with the same 429 — one run's candidates are more than 10K tokens.
- [x] **Done 2026-09-26: the owner's free OpenAlex key is in the VPS `.env` as
      `OPENALEX_API_KEY`** (tested against the API first — 200; API and worker containers
      restarted alone; `key-present-in-container` confirmed). The free plan is $1/day of API
      budget, about a thousand searches, nothing to pay; prepaid top-ups in $1 steps exist if a
      day ever runs out. CI stays anonymous on purpose — its rule is that no real key enters it —
      and the 8-second timeout plus abortable retry from 2026-09-25 keeps a 503 from stalling the
      browser job. Was: **Get the free OpenAlex API key and put it in the VPS `.env`. Now
      urgent:** on the afternoon of 2026-09-25 OpenAlex answered every *anonymous* search with
      `503 "Anonymous search is paused while the search cluster recovers … use a free API key"`.
      Until the key is set, paper search, the proposal's related-works check and reference
      resolution on the live site fail whenever OpenAlex does that. Also put the key in the
      GitHub repository secrets for CI (the browser job drives the proposal against live OpenAlex).
      Originally:
      Read off help.openalex.org on 2026-09-25: OpenAlex now meters its API by cost. Without a key
      the whole site gets **$0.10 a day** — about 100 searches — and with the free key **$1 a
      day** (≈1,000 searches; single-paper lookups by DOI are free, list queries $0.10 per 1,000).
      Beyond that, prepaid in $1 steps. Sign up at openalex.org, create a key in the account
      settings, send it; the code already sends it on every OpenAlex request (`ScholarlyHttp`,
      tested). No budget line yet: at launch scale the free tier covers it, and the day it does
      not, OpenAlex answers with a clear error rather than a bill.
- [x] **Fixed with v0.1.6 (2026-09-25, seed run on the VPS): the owner's account is superadmin on production.** Was: Signing in with
      nihilkaarthikeyan@gmail.com opened a student home. `deploy.sh` runs migrations, not the seed,
      and the seed (which promotes `SEED_ADMIN_EMAIL`) ran before that variable held this address.
      The agent runs the seed on the VPS at the next release — idempotent upserts only: the
      superadmin role, the four feature flags, the example template — and the home page now shows
      an **Admin** link to superadmins.
- [x] **Live in v0.1.6 (2026-09-25): Google sign-in links to the existing account.** Was: The Google keys
      were set and working; the sign-in library would not attach a Google login to the account the
      emailed code had already created. Fixed in code (`accountLinking: { enabled, trustedProviders:
      ['google'] }`, Better Auth's own verified-email gate left on); live at the next release.
- [x] **Done 2026-09-28: the superadmin is now `editor.publicationmart@gmail.com` only**, at the
      owner's instruction. That account was created and verified by the owner's own Google sign-in;
      then, after a `pg_dump` (`/root/backups/pre-admin-swap-2026-09-28/`), one transaction set it
      to SUPERADMIN and `nihilkaarthikeyan@gmail.com` to STUDENT (not deleted — its data stays),
      each with a `ROLE_CHANGED` audit row marked as done by the agent. The VPS `.env` now has
      `SEED_ADMIN_EMAIL=editor.publicationmart@gmail.com` (so alerts and feedback mail go there)
      and `ALERT_EMAILS=nihilkaarthikeyan@gmail.com` as the backup inbox; the old file is
      `.env.bak-2026-09-28-admin-swap`. The owner sets the password themselves under Account →
      Password. The item as it stood:
- [ ] **Admin access for the manager / HR (2026-09-25).** Built: `PUT /admin/users/:id/role` and a
      Role control on `/admin/users/:id`. There are no passwords in this product; the credential
      is the email address plus the code it receives. The owner's own address is already the
      superadmin on production (`SEED_ADMIN_EMAIL`). To let a second person in: they sign in once
      at thesis.rademics.ai with their email (that creates the account), then the owner opens
      Admin → Users → their page → Role → SUPERADMIN. Logged as ROLE_CHANGED; a superadmin cannot
      remove their own role. INSTITUTION_ADMIN is for a university's seat manager, not for staff.
- [x] **Site-wide monthly AI budget: ₹2,000, decided by the owner 2026-09-25** — set in the VPS
      `.env` as the fallback at the v0.1.7 release, and editable from Admin → "Site-wide AI
      budget" (the admin's number wins over the file). Alerts go to `SEED_ADMIN_EMAIL` and
      `ALERT_EMAILS=editor.publicationmart@gmail.com` at 80% and at the stop. At the stop every
      AI call is refused and paper indexing / literature search pause (the worker asks the same
      question before it spends). The item as it stood:
- [ ] **Set the site-wide monthly AI budget** (`PLATFORM_MONTHLY_CEILING_INR` in the VPS `.env`,
      2026-09-25, the owner's "so that we are very safe"). Rupees for the whole site per calendar
      month; once every user's successful AI spend adds up to it, every AI call is refused with
      `PLATFORM_CEILING_EXCEEDED` ("AI features paused for this month… not your allowance")
      until the 1st, and the refusal is audited. Summed at most once a minute, so the overshoot
      is bounded to a minute of calls. Unset means no site-wide stop (the per-student ₹100 one
      always applies). A number: at ₹25.60 per fully active student, ₹5,000 covers ~195 such
      students; for the trial, ₹2,000. Restart api/worker after setting it (`docker compose up
      -d api worker` in `infra/compose`, thesis-copilot only).
- [x] **Voyage payment method added by the owner (2026-09-25):** $5 prepaid credit, auto-recharge
      off (so Voyage can never charge the card unasked), the $10 budget *alert* on the org that
      owns our key — proven by six calls in a minute all answering 200. The card cannot be
      debited beyond the credit already bought.
- [x] **Add a payment method to the Voyage account** (also listed under AI above) — done above. Price read off
      docs.voyageai.com on 2026-09-25: `voyage-3` is **USD 0.06 per million tokens**, pay-as-you-go,
      no minimum — about ₹1.60 to make a 30-paper library searchable, under ₹5 per active student
      a month. `docs/COSTING.md` and `pricing.ts` now carry 0.06 (they had §11.1's 0.02).
      **Switched to `voyage-4` on 2026-09-25 at your "yes" (ADR-0032)** — same price, 200M free
      tokens. Done locally (verified, re-embedded, floor re-measured); production gets it at the
      next release: `AI_EMBED_MODEL=voyage-4` in the VPS `.env`, deploy, `pnpm ai:reembed` in the
      api container — all inside the thesis site's own containers. The card is still needed: the
      3-requests-a-minute limit stopped the local re-embed until the script learned to wait.
- [ ] **Fill in the company details for the Terms and Contact pages** (`apps/web/src/lib/company.ts`,
      2026-09-25): legal name, registered address, a support email a person reads, a phone number,
      and the city for jurisdiction. Every one is `null` today and the pages print "To be added."
      — nothing is invented. Razorpay's approval reads these pages, so they must be real before
      the Razorpay application. Then approve the Terms (`/terms`) themselves: drafted in plain
      words from what the code does, and they are your contract with the student.
- [x] **Done 2026-09-25, before v0.1.5: back up the MinIO volume** (ADR-0024). The files and a
      full database dump are on the server in `/root/backups/pre-v0.1.5/` (`minio_data.tar.gz`,
      `postgres.dump`); MinIO now runs Chainguard's image and reports healthy. Delete the backups
      once you are happy. Kept for the record: MinIO withdrew its public
      images — quay.io now refuses anonymous pulls — so the next deploy switches storage to
      Chainguard's build of MinIO (`cgr.dev/chainguard/minio`). Proven on the dev volume (same 651
      objects before and after), but it is production's files: on the server,
      `docker run --rm -v thesis-copilot_minio_data:/data -v $PWD:/backup alpine tar czf /backup/minio-$(date +%F).tgz -C /data .`
      (check the volume's name with `docker volume ls`). **Without this change the next deploy
      fails**: `deploy.sh` pulls every image, and the old one can no longer be pulled.
- [x] **Done 2026-09-25, after v0.1.5: `backfill:journals` ran on the server** (ADR-0022) — no
      source on production needed it (0 of 0). Kept for the record: New
      references get their journal's figure as they resolve; this fills it in for every source
      resolved before. Safe to re-run. On 2026-09-24 against the dev database it matched 338 of
      339 sources to a journal, 268 with a figure — the rest are in venues OpenAlex does not list
      as journals, and are left unknown on purpose.
- [ ] **Optional: an NCBI API key** (ADR-0020). PubMed search works without one at 3 requests a
      second, shared by the API and the worker. A free key from an NCBI account
      (ncbi.nlm.nih.gov → Account settings → API Key Management) raises that to 10: put it in
      `NCBI_API_KEY`.
- [ ] **Confirm the arXiv-copy question** (ADR-0020). arXiv's API terms forbid storing and serving
      e-prints unless their licence allows it, so the new arXiv search never downloads one. But the
      existing full-text path can: when Unpaywall names an arXiv copy as a journal article's best
      open-access location, `index-source` downloads it and `GET /sources/:id/file` serves it
      back — to that one student, for their own thesis. That reads as the personal research use
      arXiv's terms allow; if you want it stricter, the fix is one condition in `index-source`.
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
- [x] **Copy the SMTP block into the VPS `.env`.** Done 2026-09-19 with the first deploy, and proven
      the next day: a production sign-in code arrived in the owner's inbox from
      `no-reply@rademics.ai`. Note for any future deploy — the app checks `SMTP_FROM`, not
      `MAIL_FROM` (`packages/config/src/env.ts:204`), and the first write of the VPS `.env` set only
      the latter, so boot refused until both were there.
- [ ] **Consider a dedicated mailbox before the pilot.** `no-reply@rademics.ai` is shared across
      four products and its password is the same everywhere; one leak rotates all four. A
      `no-reply@` on whatever domain Thesis Copilot ships under would isolate it. Not urgent —
      the shared box works and is already warmed up.
- [~] **Google sign-in — credentials supplied 2026-09-21, not yet proven.** The owner supplied a
      client id and secret in `D:\Thesispilotgoogle.txt`; both are now in the local `.env`
      (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), so `GET /api/v1/auth/methods` should now report
      `"google": true` and the button should appear. Two things remain and neither is code:

      1. **Register the redirect URIs** at https://console.cloud.google.com/apis/credentials, on
         this client. Without them every attempt fails with `redirect_uri_mismatch`. Add both,
         character for character:
         - `http://localhost:3001/api/v1/auth/callback/google`
         - `https://thesis.rademics.ai/api/v1/auth/callback/google`
      2. **Copy the two variables to the VPS `.env`** and restart the API, or production keeps
         showing email-only sign-in.

      Also publish the consent screen before the pilot — while it is in *Testing*, only addresses
      added as test users can sign in. A different Google client was found first
      (`client_secret_…googleusercontent.com.json` in Downloads): it belongs to the **Gate**
      project, has no redirect URIs at all, and was not used. Full instructions below.

- [x] **Google sign-in** — live since v0.1.6 (production reports `"google":true`; the double-press
      fix shipped in v0.1.11). The original steps are kept below for reference.
      Everything but the credentials was built: Better Auth's Google provider is
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
      **Checked on the VPS 2026-09-20: the container is up and `monitor` has zero rows.** So the
      thing that is supposed to notice an outage currently notices nothing, and ADR-0014's whole
      design — a provider outage answers 200 with `"status":"degraded"` so that a *human* is paged
      rather than a container restarted — has no human on the other end of it until this is done.
- [ ] **Turn off SSH password login on the VPS.** `sshd -T` on 2026-09-20 reports
      `passwordauthentication yes` and `permitrootlogin yes`, so root is reachable from the whole
      internet with a guessable secret, on a box that now holds student theses as well as eight
      other projects. Keys are already in use for every deploy path, so nothing depends on the
      password: set `PermitRootLogin prohibit-password` and `PasswordAuthentication no` in
      `/etc/ssh/sshd_config`, **confirm a second key-based session opens before closing the first**,
      then `systemctl reload ssh`.
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

**Deployed 2026-09-19 to `https://thesis.rademics.ai`** — srv1555044, the shared Hostinger box that
already runs eight other projects, behind its nginx rather than our own Caddy (ADR-0012).
`docs/BUILD_LOG.md` has the account, including the four failed attempts and what each one caught.

- [x] **VPS + domain + SSH key.** Existing box; `thesis` A record; its own read-only deploy key for
      the clone, and a separate key for GitHub Actions to reach it.
- [x] Repo at `~/thesis-copilot`, `infra/compose/.env` written by hand and `chmod 600`.
- [x] **GitHub secrets** for `release.yml` — all five set.
- [x] Tag pushed, CI green, `https://thesis.rademics.ai/api/v1/health` 200, first real user journey
      walked end to end on 2026-09-20 (proposal → outline → Assist, ₹0.68).
- [ ] **Off-site backup bucket**: `BACKUP_S3_ENDPOINT/ACCESS_KEY/SECRET_KEY/BUCKET` in the VPS
      `.env`. **Still open and the most serious thing on this page.** The nightly dump runs and the
      Sunday restore test passes — but onto the same disk as the data it is backing up, and the
      backup log says so itself every night: "dump kept locally only — fine for dev, NOT for
      production". One disk failure loses the data and every backup of it together.
- [x] **Re-sync `infra/compose/` to the VPS on every release.** Fixed 2026-09-20: `release.yml` now
      checks the VPS working tree out to the tag before running `deploy.sh`, and back to
      `.last_good_tag` if the deploy rolls back. It also calls `../scripts/deploy.sh` rather than an
      untracked symlink made by hand during the first deploy — so a fresh clone can now deploy.
- [ ] **Turn on live co-authoring in production** (ADR-0028) — **stopped on 2026-09-25 before any
      change and left off until the owner says otherwise**: the server hosts many other projects
      and the step below edits nginx, which they all share. If it is ever wanted, in this order:
      1. **Add** the `/collab/` location block from `infra/nginx/thesis.rademics.ai.conf` to the
         live `/etc/nginx/sites-available/thesis.rademics.ai`, above `location /`. Do **not** copy
         the file over: see the next item. Without the block every live session fails to connect
         and the editor says "Connecting…" for ever.
      2. The release brings a `collab` service (compose) — one instance of the API image with
         `COLLAB_ENABLED=true`. Check it is healthy: `docker compose ps collab`.
      3. Flip the `collaboration` flag on the admin page. Until then nothing changes for anyone:
         the share panel does not offer "edit with me", and every editor stays on autosave.
      4. Prove it: share a thesis with a second address ticking "edit with me, live", open the
         chapter in two browsers, type in each. `apps/web/e2e/collab.spec.ts` is the same walk.
- [ ] **Never copy the repo's nginx vhost over the live one — edit the live file by hand.** Found
      2026-09-25 by diffing the two before touching anything: the live file carries the lines
      Certbot added when it issued the certificate (`listen 443 ssl`, the certificate paths, and
      the port-80 redirect block), and the repo's copy has none of them. Copying it over would
      have taken HTTPS off thesis.rademics.ai. The same nginx serves every other site on the
      server, so any change is: back the file up, add only the new block, `nginx -t`, and reload
      only if that passes. CI's drift warning will always fire because of the Certbot lines;
      read its diff for anything *besides* them.
- [x] **Released v0.1.23, 2026-10-01** (tag on `0f13b66`, CI green including the browser smoke,
      `pg_dump` in `/root/backups/pre-v0.1.23/`): the chapter build (ADR-0039) — plan step with
      key-term confirmation and intake questions, the build itself with its checks, examiner and
      one fix loop, pending draft blocks, the QA report on screen and as PDF/HTML, discipline,
      university and language profiles, the pitfall bank with its admin screen, `CHAPTER_BUILD`
      metered at 3/3/3/1; the per-call timeout from the second real build; fastify 5.12.5 and
      @nestjs/platform-fastify 11.2.7 for six new advisories. The seed ran on the VPS (15 approved
      pitfalls). Verified live: every container on v0.1.23, migration 0026 applied, the worker
      serving `chapter-build`, health 200, anonymous `/api/v1/admin/*` and
      `/api/v1/chapter-build/profiles` 401, web 200.
- [x] **Released v0.1.20, 2026-09-30** (tag on `76f3339`, CI green, `pg_dump` in
      `/root/backups/pre-v0.1.20/`): the writing-quality plan, steps 1–4 — joining space, no
      repeats or filler, the approved A.1/A.2 wording, uncited "research shows" dropped, automatic
      sources (ADR-0037, off until the flag is turned on), citation records on hover, the
      review-density warning, the different-material verdict on the strong tier; nodemailer
      10.0.13 for a new advisory. Verified live: containers on v0.1.20, migration 0025, the
      worker serving `find-sources`, health 200.
- [x] **Released v0.1.19, 2026-09-29** (tag on `654f27d`, CI green, `pg_dump` in
      `/root/backups/pre-v0.1.19/`): the trial notice for the whole 14 days and the sign-up
      wording. Verified live: containers on v0.1.19, health 200, the sign-up page carries the new
      sentence.
- [x] **Released v0.1.18, 2026-09-29** (tag on `b5d1936`, CI green, `pg_dump` in
      `/root/backups/pre-v0.1.18/`): the free trial ends 14 days after sign-up (ADR-0036).
      Verified live: containers on v0.1.18, migration 0024 applied, health 200, the terms carry
      the new sentence, and every existing account has a trial end in the future (5 running,
      0 ended, 0 without a date) — nobody lost the AI features on release day.
- [x] **Released v0.1.17, 2026-09-29** (tag on `5c75683`, CI green, `pg_dump` in
      `/root/backups/pre-v0.1.17/`): the superadmin controls of ADR-0035 — overview, users with
      filters, suspend, sign out everywhere, extra allowance, thesis delete (admin and student),
      read-only thesis view that emails the student, activity log, jobs, feedback inbox,
      Settings; the privacy page's new wording; migration 0023. Verified live: every container on
      v0.1.17, migration 0023 applied, health 200, `/admin/badges` 401 signed out, the privacy
      page carries the new sentence, `/admin/jobs` served.
- [x] **Released v0.1.16, 2026-09-29** (tag on `b74c9d7`, CI green, `pg_dump` in
      `/root/backups/pre-v0.1.16/`): a superadmin's sign-in lands on `/admin`, not a thesis list;
      the admin header links Account instead of "Your theses". The first deploy attempt failed on
      an SSH timeout from GitHub to the VPS (nothing changed on the server); a re-run of the deploy
      job succeeded. Verified live: containers on v0.1.16, health 200, the served `/app` bundle
      carries the redirect, anonymous `/admin/users` 401.
- [x] **Released v0.1.15, 2026-09-29** (tag on `83e36c7`, CI green, `pg_dump` in
      `/root/backups/pre-v0.1.15/`; VPS `.env` gained `S3_PUBLIC_URL=https://thesis.rademics.ai`,
      old file `.env.bak-pre-v0.1.15`): one look for landing and product (ADR-0034), rate limits on
      every request, pagination and caps, a CSP, the editor header that no longer wraps, the footer
      without photo credits — and working download links. Verified live: every container on
      v0.1.15, `edge` recreated with the `/thesis-copilot/` route, the CSP header served, a probe
      file signed as the app signs downloads opened from outside with 200 while a bad signature
      and a PUT through the proxy got 403 (probe removed), anonymous `/admin/users` 401.
- [x] **Released v0.1.14, 2026-09-28** (tag on `3b151d7`, CI green, `pg_dump` in
      `/root/backups/pre-v0.1.14/`): a sign-up with an address that already has an account emails
      its owner how to sign in instead of sending nothing (`onExistingUserSignUp`).
- [x] **Released v0.1.13, 2026-09-28** (tag on `8861570`, CI green, `pg_dump` in
      `/root/backups/pre-v0.1.13/`): the logo (option D, the owner's choice from a PDF of four),
      the favicon — the site had none — the Apple and manifest icons, and a 1200×630 link preview.
      Verified live: every container on v0.1.13, `/icon.svg`, `/favicon.ico`, `/apple-icon.png`,
      `/manifest.webmanifest`, `/icons/icon-512.png` and `/opengraph-image.jpg` 200 with the right
      types, the page's `<link rel="icon">` and `og:image` pointing at them, the new mark in the
      live header, anonymous `/admin/users` 401.
- [x] **Released v0.1.12, 2026-09-28** (tag on `4294213`, CI green, `pg_dump` in
      `/root/backups/pre-v0.1.12/`): the redesigned landing, sign-in and sign-up pages (landing
      round 7, approved by the owner as a PDF). Verified live: every container on v0.1.12, `/`,
      `/sign-in`, `/sign-up` and the self-hosted photos 200, Satoshi loaded, no broken images and
      no console errors at desktop, phone and dark, Google offered on sign-in, anonymous
      `/admin/users` 401. Still needed from the owner: the company's legal name (the footer shows
      "Thesis Copilot" until `COMPANY.legalName` is set).
- [x] **Released v0.1.11, 2026-09-28** (tag on `e7a6bca`, CI green, `pg_dump` in
      `/root/backups/pre-v0.1.11/`): one press of "Continue with Google" starts one sign-in (the
      double press behind the owner's `state_mismatch`), a failed Google return lands on sign-in
      or sign-up with the reason in words, and grey suggestions show citation labels instead of
      the raw marker. Verified live: every container on v0.1.11 and healthy, `/auth/methods`
      reports Google, `POST /auth/sign-in/social` returns a Google URL, anonymous
      `/admin/users` 401. Not yet done by a human: one real Google sign-in on the live site.
- [x] **Released v0.1.10, 2026-09-26** (tag on `5a720e3`, CI green, `pg_dump` in
      `/root/backups/pre-v0.1.10/`): the optional password with forgot and reset (ADR-0033), the
      CI-only sign-in rate-limit headroom. Verified live: every container on v0.1.10 and healthy,
      `/auth/methods` says `password: true`, `/forgot-password` and `/reset-password` 200, the
      dev sink 404 in production, anonymous `POST /account/password` 401, and the password
      sign-in screen seen in a browser. Not yet done by a human: a real sign-up with a password
      through to the emailed link on the live site (mail goes out over Hostinger SMTP; the code
      path is the same one the OTP already uses).
- [x] **Released v0.1.9, 2026-09-25** (tag on `e6dac1d`, CI green, `pg_dump` in
      `/root/backups/pre-v0.1.9/`): the admin gate — a signed-out visit to `/admin` goes to
      sign-in and comes back (`?next=`), a signed-in student is told plainly, a session that
      ends under the page goes back to sign-in. Proven on the live site in a browser after the
      deploy: `/admin` signed out → `/sign-in?next=%2Fadmin`, no Sign out button; anonymous
      `/api/v1/admin/*` → 401.
- [x] **Released v0.1.8, 2026-09-25** (tag on `4b056e4`, CI green, `pg_dump` in
      `/root/backups/pre-v0.1.8/`): plain feature names on the admin screens, token detail behind
      a toggle.
- [x] **Released v0.1.7, 2026-09-25** (tag on `09eac3d`, CI green, `pg_dump` in
      `/root/backups/pre-v0.1.7/`, migration 0022 applied): the site-wide AI budget at ₹2,000
      with `ALERT_EMAILS=editor.publicationmart@gmail.com`, editable in Admin; the admin screen's
      header, plain labels and corrected cost figure. Verified live: budget and alert address in
      the container, `/admin/platform-budget` 401 without a session.
- [x] **Released v0.1.6, 2026-09-25, at the owner's go-ahead** (tag on `7b1aaa6`, CI green; a
      `pg_dump` first in `/root/backups/pre-v0.1.6/`; `AI_EMBED_MODEL=voyage-4` set in the VPS
      `.env` (backup `.env.bak-pre-v0.1.6`); the seed run; nothing to re-embed — production held no
      chunks). Carries: voyage-4, Google account linking, admin roles + Admin link, embedding
      counted as spend, Terms and Contact, the OpenAlex key support, the bounded gap check, the
      Chrome add-on's privacy section. Not yet in it: the site-wide budget (2c06124, awaiting the
      owner's number) — next release.
- [x] **Released v0.1.5, 2026-09-25, at the owner's go-ahead** (tag on `40d3b7d`, CI green;
      migrations 0015–0021 applied; all 13 services healthy). The item as it stood: Every figure a
      student adds goes blank fifteen minutes later on production today (53179b2 fixes it: the
      stored link was signed for fifteen minutes and nothing renewed it). The same release carries
      the other 2026-09-24 fixes — a pending AI draft printed into the submitted thesis, raw
      Crossref lines and "&amp;" in reference lists, file names as figure captions, Find papers
      returning nothing for a question ending in "?" — and everything built against the
      competitor list (ADRs 0018–0029: co-authoring, pasted screenshots, merged table cells,
      footnotes and note citation styles, typeset equations, the citation report, viva preparation
      with its database migration `0021_viva_prep`, and the supervisor's live progress view). **This release builds a fourth
      image, `tc-gotenberg`** (Gotenberg with LibreOffice Math, `infra/docker/Dockerfile.gotenberg`),
      and prod Compose now pulls it instead of the stock `gotenberg/gotenberg:8`; the first
      build takes a few minutes longer because it installs one LibreOffice package. Two things first, both above: **back up the MinIO
      volume** (the release switches the image, ADR-0024) and run `pnpm backfill:journals` after
      the deploy. Then `git tag v0.1.5 && git push --tags`; `release.yml` does the rest and rolls
      back to `.last_good_tag` if the health check fails. The agent does not tag a release: that
      is the one deploy step that is yours.
- [x] **Fixed by the v0.1.5 release (2026-09-25): the VPS tree is at `v0.1.5`, matching its
      images.** The item as it stood: checked 2026-09-20 — tree at
      `0916302`, containers on `v0.1.1`. The next tagged release now fixes this by itself; to do it
      sooner, on the VPS:
      `cd ~/thesis-copilot && git fetch --tags && git checkout --force v0.1.1`.

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

## Account and privacy gaps (audit 2026-09-14)

Found by auditing the account surface against PRD §12, prompted by the owner asking whether the
basics — password reset, email verification, account deletion — were done. Three of these are the
agent's to build and are listed here only because they were found after the phase plan closed.

**Not applicable, recorded so the question stops coming back:**

- *Forgot password / reset password.* There are no passwords. PRD §7.2 chose Better Auth with email
  OTP + Google, so a sign-in is a six-digit code to the address on file, valid ten minutes. There is
  no credential to lose, reset or leak. `apps/api/src/modules/auth/auth.ts` has no
  `emailAndPassword` block and no route accepts one.
- *Email verification.* The OTP **is** the verification, on every sign-in rather than once at
  signup. An account cannot exist unverified: nobody reaches a session without reading mail sent to
  that address. There is nothing separate to build.

**Built and working:** sign-in, sign-up, sign-out, Google sign-in (needs credentials, above),
per-IP and per-user rate limiting on the auth endpoints (20/min, `common/rate-limit.ts`), the
account page (plan, usage meter, invoices, cancel), the settings page, and the FR-8.6 AI-usage log
export.

**Gaps:**

- [x] **Account deletion.** Built 2026-09-14. `DELETE /account` (the address typed back to confirm)
      marks the row and signs every device out; `DeletionScheduler` erases seven days later;
      `POST /account/deletion/cancel` undoes it in between. Migration `0012_account_deletion`.
      Content is hard-deleted; the `User` row survives stripped so the billing records §12.2
      requires can still point at something, and the address is freed for a fresh signup. 16
      integration tests, one of which walks `information_schema` so a table added later that is
      not erased fails the test. Driven end to end in a browser.
- [x] **Zero-retention on provider calls.** Set 2026-09-14: `store: false` on every OpenAI call.
      Before this the Responses API's default kept every chapter for 30 days while `/privacy` said
      otherwise. The privacy page now states the position.
- [x] **A code floor under chat.** Built 2026-09-14: `RELEVANCE_FLOOR` in `@tc/retrieval` refuses a
      question nothing in the library relates to *before* any provider call, and refunds the unit.
      The threshold is measured (see `docs/BUILD_LOG.md`), not chosen.
- [ ] **Widen the evidence under `RELEVANCE_FLOOR`.** It is placed from fifteen questions against
      four passages in one subject area, which is enough to find an obvious gap (off-topic tops out
      at 0.254, on-topic bottoms at 0.345) and not enough to know the gap holds for every
      discipline. A false refusal — a student told their library is off-topic when it is not — is
      the failure that matters, so the floor errs low and takes a per-call override. The five
      fixture papers are what would settle it.
- [ ] **An end-to-end test of the chat floor.** `isOffTopic` is unit-tested against the measured
      cosines and the service wiring is typechecked, but no test drives a real off-topic question
      through `chat.service.ts` and asserts no provider call was made. That needs a document with
      an embedded library, which needs the fixture papers.
- [x] **Changing the email on an account.** Built 2026-09-20, ADR-0015. `POST /account/email` sends
      a code to the *new* address and `POST /account/email/verify` spends it; Better Auth's own
      `changeEmail` flow does the OTP, and the service around it warns the address being left (with
      the destination masked), writes an `EMAIL_CHANGED` audit row carrying both addresses, and
      refuses while a deletion is pending. 12 integration tests.
      **Still yours to decide:** a student who is *already* locked out has no route, deliberately —
      moving an account without proving control of either mailbox would be a takeover feature. That
      stays a support matter, and there is no support process yet.

## Editor parity with general-purpose AI writing tools (audit 2026-09-21)

Prompted by the owner sending a screenshot of a competitor's editor. An inventory of our own
source against it found the product had **no formatting UI at all** — the schema supported most of
it, reachable only by keyboard shortcut, and three things were not reachable at all.

**Built the same day:** the formatting toolbar (text style, B/I/U/S, super/subscript, code, lists,
quote, link), tables with row/column controls, inline and display equations, figure upload, and a
live word count that also shows the AI share. Following the figure through to the export turned up
three separate faults that would each have silently dropped it from the submitted `.docx`; all
fixed. `docs/BUILD_LOG.md` → "Editor parity" has the account.

- [x] **Prove the toolbar in a browser.** Done 2026-09-21. Signed in, inserted a 3x3 table, an
      inline equation, a display equation and a figure, then exported the chapter and read the
      .docx XML: one PNG in word/media, the table present, both equations present, and zero
      [image] placeholders. It found two faults that no other test would have.
- [x] **Done 2026-09-25 (5cda268): equations are real Word equations** in the `.docx` and the PDF
      (matrices still print as LaTeX). The item as it stood: they went into the .docx as their
      LaTeX source in a monospace run. That is a deliberate floor, not the finish: before
      2026-09-21 an equation was simply absent from the submitted file, and carrying the source
      through at least means the content is there and visibly an equation. Doing it properly is
      LaTeX → MathML → OMML, which is a project rather than a patch, and the `docx` package has no
      OMML support to build on.
- [x] **Decided: web search returns candidate sources, not answers.** ADR-0016, 2026-09-21. The
      owner chose option (c). A web hit is searched from OpenAlex (and Semantic Scholar when a key
      exists), shown as a real work, and added through the same resolve path a pasted bibliography
      uses — after which it is an ordinary indexed, citable source. No prose is generated and the
      model is not called, so the scope is not metered.
- [x] **A manual `@`-cite picker.** Built 2026-09-21. Typing `@` lists the library with live
      citeproc labels; arrow keys and Enter insert. No model call, so it is free and cannot
      hallucinate — a student can only pick a source they already have.
- [x] **Chat scope.** Built 2026-09-21: Library / This thesis / Find papers. See ADR-0016 for why
      the third one behaves differently from the competitor it answers.
- [x] **In-editor review.** Built 2026-09-21. A Review tab draws the supervisor's comments on the
      passages they are about and accepts a suggested revision without leaving the chapter.
      ADR-0017 records why `commentAnchor` stays inert and the range is found in the browser.
- [x] **A setup checklist.** Built 2026-09-21 and built to disappear — it renders nothing once all
      five steps are done. Deriving "has an outline" honestly took two attempts; `docs/BUILD_LOG.md`
      has the account.
- [ ] **Publish the Chrome add-on** (ADR-0031 — built and tested 2026-09-25, `apps/extension`).
      Try it first: build it, then `chrome://extensions` → Developer mode → Load unpacked →
      `apps/extension/dist` (steps in `apps/extension/README.md`). To publish: create a Chrome Web
      Store developer account in your name (Google charges a one-time registration fee; the agent
      cannot pay or create accounts), zip `dist`, and paste the listing, permission reasons and
      privacy answers from `apps/extension/STORE.md`. Take two screenshots in a real Chrome
      window. Google reviews it before it is listed. The privacy page's add-on section goes live
      with the next release.
- [ ] **Video tutorials** — content, not code, so still yours: a two-minute recording of each of
      the main screens would do.

## Decisions and reviews

- [x] **Steps 2 and 4 approved and built (2026-09-30).**
- [x] **Approve the writing-quality prompt changes** (2026-09-30):
      `docs/proposals/2026-09-30-writing-prompts.md` has the exact before-and-after wording. Step 2:
      autocomplete writes nothing (and says what source is missing) instead of filler, no
      "this section will…" sentences, finished-thesis tense, and a review draft must cite every
      paragraph. Step 4: the citation-support check gains a "different material or setting"
      verdict. Nothing changes until you approve.
- [x] **Turned on "Find sources automatically"** (ADR-0037) on production, 2026-09-30, at the owner's request: the `autoSources` row did not exist there (flags are created by the seed, which production does not run), so it was inserted enabled; Admin → Settings → Feature switches shows and toggles it from now on.
      once the release is live. Off by default. Measured: ₹0.075 for two searches, 10 papers.
- [ ] **The Jenni benchmark** (step 4 of the plan): 20–30 identical topic prompts through both
      tools, scored on the reviewer's scorecard. Someone with a Jenni account runs the Jenni side;
      the agent runs ours after you approve its cost.

- [x] **The free trial never ended — now it does (2026-09-29, ADR-0036).** The owner chose to
      enforce 14 days, **for accounts created from the release on**: the five accounts that
      existed before it had their end date removed at the owner's request (one `TRIAL_EXEMPTED`
      log row each; backup `/root/backups/pre-trial-exempt-2026-09-29/`). New accounts see
      "Free trial: N of 14 days left" on the thesis list and account page from day one. After
      the end the theses stay and the AI features need a plan — **which needs the Razorpay keys
      above**. Optional follow-up: a reminder email a few days before the end.

- [ ] **Send the privacy notice to existing students — only after you approve the text.**
      ADR-0035: admins can now read a thesis (read-only, logged, the student emailed each time),
      and the privacy page says so from v0.1.17. Existing students should be told once. The text
      is in `privacyNoticeMail` (`apps/api/src/modules/admin/admin-mail.ts`):

      > Subject: A change to how we handle your thesis
      >
      > We have updated our privacy notice. Administrators can now open a thesis to read it, only
      > for support or to prevent misuse, never to change it. You will get an email every time this
      > happens. Read the full notice at thesis.rademics.ai/privacy.

      Once approved, on the VPS in the app directory: `docker compose -f docker-compose.prod.yml exec api node apps/api/dist/privacy-notice.js` prints
      the text and how many accounts it would reach; add `--send` to send. Each send is logged, so
      a second run only reaches whoever the first missed.

- [ ] **A.4 refuses in the wrong words when the question is about the student's own draft.**
      A prompt change, so it needs the owner: PRD §0.3 rule 6 says prompts are content, and
      `packages/ai/prompts/chat.md` is a verbatim copy of Appendix A.4. The agent has not touched
      it.

      What happens, from a browser run on 2026-09-21. A chapter containing "Adoption of drip
      irrigation ... The subsidy was announced in 2017." Chat, scope **This thesis**, question
      "What have I written about the subsidy?". The answer:

      > Your library does not contain enough on this. Try adding sources on: subsidy details in
      > Chapter 1.

      The passage was right there in the draft, and the library has nothing to do with this scope.
      A.4's system block says "answer the student's question using only the provided passages from
      their library" and gives that exact refusal sentence, which was written before the document
      scope existed (ADR-0016, the same day). The model is obeying it.

      **Proposed change, for approval:** make the two library-specific lines of A.4 take the scope
      — "the provided passages" rather than "passages from their library", and a refusal worded
      for whichever set was passed. Nothing else in the prompt changes. Alternatively a second
      prompt file for the document scope, which needs an ADR like 0010 did.

      Fixed in code meanwhile, because it is ours and not the prompt's: the chat panel no longer
      prints "Add sources from the Discover tab, then ask again." under a refusal in the document
      scope, where it is advice for a different question.


- [ ] **Settle the price and the caps together.** `docs/COSTING.md` gives the cost side:
      ₹25.34 per fully active student since viva preparation (ADR-0030; ₹14.18 before it), ₹299
      charged, 92% margin. `docs/PRICING-REVIEW.md` reviews
      `RADemics_Thesis_Copilot_Pricing.docx` and its ₹349 / ₹2,999 proposal — but that review was
      written on Haiku + Sonnet, and §1 and §4 of it are superseded by the OpenAI move; the
      addendum and §"The caps are now far tighter" below carry the current numbers. The code still
      has ₹299 / ₹2,499 in `packages/config/src/billing.ts` and PRD §11.6 still marks the price
      `DECISION PENDING`.
- [ ] **Amend PRD §11.2's token profiles to the measured figures, or decide not to.**
      `pnpm ai:shakedown` (2026-09-14) measured real output tokens for every action for the first
      time. Some are above §11.2's estimate and some below, and repricing the whole STUDENT plan
      at the measured numbers lands back on **₹14.18** — so nothing is broken and nothing is
      urgent. But three lines are out by more than double and the table now disagrees with
      reality: Outline 2,000 → 3,394, Style profile 400 → 1,018, Command 600 → 272.
      `docs/BUILD_LOG.md` → "Real-provider shakedown" has the whole table. §0.3 rule 3 keeps the
      agent out of the PRD's own numbers.
- [ ] **The budget proof prices a coherence run without the citation-support check** (ADR-0023,
      corrected 2026-09-24). The check adds up to six Fast calls, about 45,000 input tokens: ₹0.3
      on `gpt-5-nano`, about ₹4–5 at the reference prices Appendix E.2's test uses. That test
      prices a coherence run from §11.2's profile (₹5.87) and has ₹1.08 of headroom, so at
      reference prices a student who runs coherence on a heavily cited chapter is budgeted a few
      rupees short. It was already true in a smaller way: D.1.1 lets a run cost up to ₹12 before
      it narrows itself, twice what §11.4 budgets. Nothing is at risk in real money (₹0.9 a run
      all in); the question is whether the proof should price a run at D.1.1's ₹12 bound, which
      needs room taken from another cap. Proofreading was sized to its unit instead (ADR-0026);
      the same could be done here by lowering `maxSupportChecks` from 60, at the cost of fewer
      sentences checked.
- [ ] **`pnpm ai:shakedown` does not cover the free-text paths.** It runs 19 structured calls and 2
      stream-then-parse ones; a third shape exists and has no case — a plain `complete()` with no
      schema, which today is `buildChapterSummaryRequest` inside the coherence run. Noticed
      2026-09-20 because the script still imported that builder and never used it, which is
      somebody having reached for it once. Worth a case: it asks for 400 tokens, and a cap sized
      for a non-reasoning model is exactly the shape that returned empty strings before
      `REASONING_HEADROOM` (see `docs/BUILD_LOG.md`). Not urgent — the headroom fix already covers
      it and coherence has run end to end — but the script claims to shake down every path and
      currently does not.
- [ ] **Decide whether the inert per-action temperatures matter.** Reasoning models reject
      `temperature`, so on `gpt-5-nano`/`gpt-5-mini` every builder's setting does nothing —
      `queries` asks 0.7 for varied search terms, `extract` asks 0 for none, and both now run at
      the model's default. Nothing observably broke, and the only lever left is the prompt. Worth
      a look once the Appendix C.5 golden set exists.
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

`pnpm audit --prod` found five moderate advisories. Three are settled: `fastify` 5.11.3 → 5.12.1
(schema-validation bypass, and X-Forwarded spoofing under `trustProxy` — the app sets
`trustProxy: true` behind nginx now, so that one was live), and a pnpm `override` for
`decode-uri-component` ≥ 0.5.0, transitive under `minio@8.0.7`.

- [x] **`stream-json` — fixed, then found broken, then fixed properly.** ADR-0013. The audit's own
      fix (`stream-json` ≥ 3.5.0 workspace-wide) was never run against a real MinIO and crashed the
      API and worker containers on module load the first time they were — during the first
      production deploy, 2026-09-19. No 1.x release carries the fix (checked against the registry),
      so there is no version satisfying both "patched" and "minio's compiled code can import it".
      Scoped to `minio>stream-json: 1.9.1` instead of a blanket override; nothing else in the
      workspace depends on `stream-json` at all, so this is the whole fix, not a narrower stand-in.
      The advisory is formally still open at that version — ADR-0013 has the exploitability
      argument for why that is an acceptable, not merely convenient, place to leave it.

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

- [x] **The prompt cache engages — observed in production, 2026-09-20.** A real Assist call on
      `thesis.rademics.ai` came back `cachedInputTokens: 1024` against 72 fresh, billed at
      ₹0.0022 against the ₹0.0097 the model budgets. The mechanism is no longer an assumption.
      **What is still unmeasured is the *size*.** The model assumes a 4,000-token cached prefix;
      1,024 is OpenAI's floor and all this prompt could offer, because the chapter had no pinned
      sources. A full chapter with six pinned passages is still the case that matters and still
      needs the fixture papers — but it is now a question of how much caching, not whether.
- [ ] **A cancelled suggestion is billed by OpenAI and logged as ₹0.** Observed 2026-09-20: cutting
      an Assist stream off mid-token logged `AiCallLog` with 0/0/0 tokens and zero cost, because the
      usage arrives on the finish chunk that a cancelled stream never sends. `assist.service.ts`
      handles the abort deliberately and says so — "the cap unit stays consumed: tokens were
      generated" — so the *cap* is right and only the *money* is missing. Bounded by the cap, so
      worst case is roughly ₹2 of real spend per student per month invisible to the ₹100 runtime
      ceiling. Small, but it is the ceiling's one blind spot, and cancelling mid-suggestion is
      normal behaviour rather than an edge case.
- [ ] **Prove the prompt cache engages at the size the model assumes.**
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

- [ ] **Proofreading shares the AI-edits allowance, and four is not enough to use it** (ADR-0026).
      One proofreading run reads 2,000 words for one `COMMAND` unit, the same unit section
      commands, outline regeneration and "Suggest fix" draw on — four a month on STUDENT, two on
      the trial. That is 8,000 words a month; a 50,000-word thesis needs **25 runs** to be
      proofread once.

      Measured 2026-09-24 on `gpt-5-nano`: 5,004 words took 9 calls, 12,578 input and 5,518
      output tokens, **₹0.25** — so a whole thesis is about ₹2.50 at real prices. The run is
      2,000 words, not more, because of the budget proof: at the reference prices the E.2 test
      uses, the same tokens cost fourteen times as much, and 2,000 words is what one Commands unit
      (₹1.41) pays for there. A test holds the run to the unit.

      Two ways, both yours: raise `COMMAND` (the table above already shows 100 fits the money), or
      give proofreading its own action and cap, priced in `packages/config/src/cost.ts` and paid
      for in §11.4. Either is a small change once decided; the run size would then follow the new
      unit.


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
