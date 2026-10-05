# Thesis Copilot — agent brief

`docs/PRD-version-2.md` is the build spec and the single source of truth (v1.1, `docs/PRD.md`, is
kept for reference; v2 is the same product with the build-process gates removed).
`docs/PHASES-version-2.md` is the running order (v1 `docs/PHASES.md` stays for the finished units). If they ever disagree, **the PRD wins** and the difference goes in
`docs/BUILD_LOG.md`. This file is a summary for speed, not an authority.

## Agent rules (PRD v2 §0.3)

1. Never invent an API — check `node_modules/<pkg>` types first.
2. Never fabricate fixture data. The agent may write `*.expected.draft.json`, never `*.expected.json`.
3. Never silently change a decision — write `docs/ADR/NNNN-<slug>.md`, then continue.
4. Never guess model IDs, prices or limits — `pnpm ai:verify` (Appendix E) settles them.
5. Prefer boring over clever.
6. Prompts are content, not code — `packages/ai/prompts/*.md` are verbatim from Appendix A.
7. Never delete or skip a test to make CI pass.

How to work: build a whole unit of `docs/PHASES-version-2.md` at a time (code + typecheck + lint), commit
and push per week, keep `docs/PENDING.md` current for anything only a human can do, and one short
`docs/BUILD_LOG.md` note per week. Verification runs come as a separate batch, not per task.

## Conventions (PRD v2 §0.2)

- TypeScript everywhere, `strict: true`. No `any` without a comment.
- pnpm workspaces + Turborepo. Biome for lint+format; CI fails on lint errors.
- Conventional Commits, one logical change per commit.
- Env via Zod in `packages/config`; the app refuses to start on a missing required variable.
- Errors: typed classes; API returns RFC 9457 problem-details.
- IDs: UUID v7. Dates: store UTC; caps reset 00:00 UTC on the 1st.
- Money: integer micro-rupees (₹1 = 1,000,000). Never float.
- Tests: Vitest (unit/integration), Playwright (editor E2E). Every metered AI action has a cap test.
- Feature flags: DB-backed `FeatureFlag`, read at request time, cached 60 s.
- No vendor SDK in product code — all LLM/embedding calls go through `packages/ai` (§10.2).

## Stack (PRD §7.2 — final; substitutions need an ADR)

| Layer | Choice |
|---|---|
| Monorepo | pnpm + Turborepo |
| Frontend | Next.js 15 App Router, React 19, Tailwind v4, shadcn/ui, TanStack Query, Zustand |
| Editor | TipTap v2 (ProseMirror) + `ghostText`, `citation`, `draftBlock`, `provenance`, `commentAnchor`; KaTeX |
| Backend | NestJS 11 on Fastify |
| Jobs | BullMQ on Redis; separate `worker` process |
| ORM / DB | Prisma 6 + PostgreSQL 16 + pgvector (HNSW); vector queries via `$queryRaw` |
| Object storage | MinIO (S3 API) |
| Auth | Better Auth (email OTP + Google) |
| AI SDK | Vercel AI SDK (`ai`) + `@ai-sdk/openai` + `@ai-sdk/anthropic`, behind `packages/ai`; vendor per tier from the model id (ADR-0011) |
| Embeddings | Voyage `voyage-4` (1024-d, ADR-0032); dimension is a config constant |
| Citations | `@citation-js/core` + `plugin-csl` |
| Export | `docx` → Gotenberg for PDF |
| Parsing | `unpdf` (PDF), `mammoth` (DOCX), GROBID optional behind a flag |
| Proxy / CI | nginx — the host's, shared with the server's other sites (ADR-0012, was Caddy 2); GitHub Actions → GHCR → SSH deploy |

Model IDs are **not** hardcoded: `AI_FAST_MODEL`, `AI_STRONG_MODEL`, `AI_EMBED_MODEL` come from env
and are verified by `pnpm ai:verify` before the cost model can be trusted (Appendix E).

## Where things live (PRD §7.3)

```
apps/web      Next.js            apps/api    NestJS HTTP + SSE       apps/worker  BullMQ consumers
packages/db          Prisma schema, migrations, seed
packages/ai          provider abstraction, prompt builders, prompts/, cost tables
packages/retrieval   chunking, embedding, pgvector queries, scholarly API clients
packages/citations   CSL-JSON mapping, citeproc rendering, style registry
packages/export      docx builder, template engine, compliance checks
packages/config      zod env schema, plan/cap tables, cost constants
packages/ui          shared shadcn components, editor extensions
packages/types       shared zod DTOs used by web + api
infra/{docker,compose,scripts}   fixtures/{papers,thesis}   docs/{PRD,PHASES,BUILD_LOG,ADR}
```

## Commands (PRD §13.6)

```bash
pnpm i
docker compose -f infra/compose/docker-compose.dev.yml up -d   # postgres, redis, minio, gotenberg
pnpm db:migrate && pnpm db:seed
pnpm dev            # turbo: web :3000, api :3001, worker
pnpm test           # vitest
pnpm e2e            # playwright
pnpm ai:verify      # Appendix E.1 — real provider call, recompute the budget
pnpm ai:shakedown   # every structured-output path against the real models (costs ~INR 2.40)
pnpm lint           # biome check .
```

Dev Compose ports are shifted off the defaults (Postgres 5434, Redis 6381, MinIO 9002/9003,
Gotenberg 3002) so the stack does not collide with other projects on the same machine.

## Hard constraints

- **₹100 per user per month, all-in** (PRD §11). A feature that cannot be metered and capped does not ship.
- **Flag, don't fix**: no AI output enters the thesis without an explicit student action.
- **Grounding**: the model may only cite passages present in the request; anything else is stripped
  and counted as `HALLUCINATED_CITE` (§10.6).
- **No humanise / detector-evasion features, ever** (§12.3).
- Cap check and increment happen in one atomic SQL statement (§10.2), before any provider call.

## Current state

**The build is complete** (2026-09-07). Every unit of `docs/PHASES-version-2.md` is done:
Phase 1 weeks 0–5, Phase 2 weeks 6–11, Phase 3 Blocks 1–4. `docs/BUILD_LOG.md` has the per-unit
record and the end-to-end evidence for each; ADRs 0001–0013 record every decision that departed
from the PRD.

Working end to end against the dev stack: sign-in, the thesis list, the
proposal screen, the library with grounding badges, literature search with the living gap map, the
outline tree and per-section regeneration, the TipTap editor with Assist, citations, draft mode,
chat and section commands, the style profile, the coherence engine, the guide and committee cycle
(shares, comments, scoped revisions, the review queue, the response-to-committee table, `.docx`
comment import), the submission bundle (template spec, ten compliance checks, thesis `.docx`/PDF
with a real contents page, the override with a reason), billing, institution admin with seats and
invoices, the SUPERADMIN dashboards, §14 alerts, feature flags and `pnpm pilot:report`.

**The VERIFY batch is done too.** 1,166 unit and integration tests (Vitest, 75 files; 2 skipped,
both conditional on fixture papers that do not exist yet) and 28
Playwright specs pass; `docs/BUILD_LOG.md` → "VERIFY" lists what was added and the seven real
defects writing them found. `pnpm test`, `pnpm lint` and `pnpm typecheck` are clean; `pnpm e2e`
needs the dev stack up (web on :3000, API on :3001, worker, and Compose).

**A requirement-by-requirement PRD audit (2026-09-07) found five things the phase plan never
scheduled, all built the same day:** FR-5.6 citation-role rewrite (ADR-0010: the one prompt not
from Appendix A), the §2.2 auto-cite toggle, §2.2 document language, the FR-2.2 CORE full-text
fallback, and real outbound email (Resend / SMTP — before it, production would have printed every
sign-in code to the log). `docs/BUILD_LOG.md` → "Specification audit" has the account. Before
saying anything is "done", audit the PRD's FR lines, not the phase plan; the owner has been told
"finished" prematurely more than once and it is the one thing they have objected to.

**Account deletion exists** (2026-09-14, PRD §12.2). `DELETE /account` marks the row and signs
every device out; `DeletionScheduler` erases seven days later; the student can cancel in between.
The `User` row survives stripped so the billing records §12.2 requires still have something to
point at. Sign-in is an emailed code by default and the OTP is the email verification; since
2026-09-26 (ADR-0033) an account *may* also have a password — added under Account, chosen at
sign-up (a link then confirms the address), or set by the reset link at `/forgot-password`, which
also serves someone who never set one. A reset revokes every session.

**A student can move the account to another address** (2026-09-20, ADR-0015). Because the address
*is* the credential here, "change my email" is how someone keeps a thesis after a university
mailbox closes. `POST /account/email` then `/account/email/verify`: Better Auth's own `changeEmail`
OTP goes to the **new** address, and the service around it warns the old one (destination masked),
audits both, and refuses while a deletion is pending. Deliberately no route for someone *already*
locked out — that would be a takeover feature.

**The second Jenni list is built too** (2026-09-25): pasted screenshots, merged table cells,
footnotes and the ~700 note citation styles (ADR-0029), equations as real Word equations (with our
own `tc-gotenberg` image, because the stock one drew them blank), a pre-submission citation report,
viva preparation (ADR-0030, its own `VIVA` allowance) and a live progress view for supervisors.
**Released as v0.1.5 through v0.1.9 on 2026-09-25, v0.1.10 (passwords, ADR-0033) on 2026-09-26, v0.1.11 (Google sign-in double-press fix) v0.1.12 (redesigned landing, sign-in and sign-up; `components/marketing/`) v0.1.13 (logo `components/LogoMark.tsx`, favicon and icons in `src/app/`) and v0.1.14 (existing-account email) on 2026-09-28, and v0.1.15 (one look ADR-0034, rate limits, pagination, CSP, `S3_PUBLIC_URL` download links) and v0.1.16 (superadmin lands on /admin) v0.1.17 (superadmin controls, ADR-0035) v0.1.18 (the trial ends after 14 days, ADR-0036) and v0.1.19 (trial shown throughout; new accounts only) on 2026-09-29, and v0.1.20 (writing quality after a Jenni comparison: filters, approved A.1/A.2 wording, automatic sources ADR-0037, different-material check) on 2026-09-30**, at the owner's go-ahead, with a backup
taken first each time (`/root/backups/pre-vX/` on the VPS). v0.1.6 also moved embeddings
to `voyage-4` (ADR-0032), fixed Google sign-in linking, added admin role management and a
site-wide budget (₹2,000, editable in Admin, alerts to `ALERT_EMAILS`), and an admin screen
written for its owner; v0.1.9 gates the admin screens (`apps/web/src/lib/admin-gate.ts`): a
signed-out visitor goes to sign-in and comes back, a student is told plainly.
The agent releases only when asked.

**The superadmin has real controls** (2026-09-29, ADR-0035): overview, users with filters,
suspend (blocks every sign-in route), sign out everywhere, extra monthly allowance
(`UsageLedger.bonus`, inside the atomic cap check), thesis delete, account deletion, an activity
log, background jobs with retry and a feedback inbox. An admin may **read** a thesis, openly:
logged every time, the student emailed, the privacy page says so. Never add a secret or writable
way into a student's work. `DocumentEraser` is the one place a thesis is removed (student,
admin, account erasure). **The free trial ends 14 days after sign-up** (ADR-0036,
`User.trialEndsAt`, enforced in `UsageService.consume`; theses stay, AI stops, admin can extend).
Still waiting on the owner: sending the privacy notice (`docs/PENDING.md`).

**A chapter can be built whole (2026-10-01, ADR-0039)** from Ranjith's developer specification:
`/app/d/:id/build` plans the chapter from the discipline blueprint and the key terms of the
objectives, writes each section from the library through the A.2 draft path, joins and checks it
(`packages/ai/src/checks/`, the spec's S/E/L/T/D checks in code), has the strong model review it
as an examiner, fixes flagged sentences once, and delivers every section as a **pending draft
block** with the QA report. Flag-don't-fix holds: nothing is thesis text until the student accepts
each block. Discipline and university profiles are data in `packages/config/src/profiles/`; the
pitfall bank is the `Pitfall` table (Admin → Pitfall bank; seeded from the spec). One
`CHAPTER_BUILD` unit is one build (₹9.04; caps 3/1). The student confirms the key terms and answers
intake questions before the unit is taken; the build searches for sources it lacks, proofreads, and
the QA report downloads as PDF or HTML. **Released as v0.1.23 on 2026-10-01** (backup `pre-v0.1.23`). The university profiles are
unconfirmed and the new prompts unevaluated — `docs/PENDING.md`.

**The Jenni study build (2026-10-04/05, ADRs 0054–0067), released as v0.1.25 on 2026-10-05** (backup `/root/backups/pre-v0.1.25/`; CI and release green; migrations 0031–0038 applied). Studied Jenni
end to end (docs/JENNI-*.md, docs/research/coverage-map.md: now 63 match, 15 ours better, 20
partial, 3 missing), then built what it showed, the owner having delegated the product calls
(ADR-0059). Among it: suggestion bar (Accept/One word/Refine presets/thumbs/‹ › history), evidence
card, Papers tab with Cite here, "/" menu, equation from words (ADR-0063) and from a photo (ADR-0064:
`Message.images`, the first image input in the product), more edit actions (ADR-0066), examiner
review of a chapter (ADR-0056) and of a selection (ADR-0067), chat beyond the library (ADR-0060,
no new prompt), sharing roles/link/copy (ADR-0057), Word import, collections, read-beside, Zotero by
key, Start writing now (ADR-0062), Hindi interface beta (ADR-0061), citation locale (ADR-0065),
long-job email (ADR-0058, `@tc/mail`), help/changelog, home-page demo. **A real fault found on the
way: a library PDF a student uploaded was never read** (pdf.js refuses a Buffer; fixed 26a3974) —
after release, re-index them (PENDING). The mock e2e stack (`api-mock`) runs without `--watch` and
with mail blanked. Still the owner's: the usage-limit rebalance (option 1 recommended); re-indexing previously uploaded PDFs; the host nginx `X-Frame-Options` change that "read beside" needs (until then it falls back to a new tab).

**v0.1.26 (2026-10-05): a first session without a queue, the paper reader, the add-on 0.2.0.**
- **ADR-0070.** The owner's manager said a new student is "stuck in a queue".
  - Measured with `apps/web/e2e/_measure` (`MEASURE=1`, real models). First cited suggestion:
    47.9 s → ~14 s on Start writing now, and 78.8 s → ~20 s on the proposal path.
  - Start writing now is the primary button.
  - The paper search starts when the thesis is created.
  - Abstracts are indexed first.
  - A `papersLoading` answer, with the editor's progress line and an automatic retry.
  - A four-step guide.
  - Readiness means "has chunks". `resolve-reference` sets the ABSTRACT badge before anything is
    embedded.
- **ADR-0068, the reader** (`/app/d/:id/sources/:sourceId`).
  - pdf.js draws on the page, so nothing is framed. The host nginx header change is no longer
    needed.
  - Pinned to `pdfjs-dist` 6.3.289, because 5.x has a high advisory that CI's audit refused.
- **ADR-0069, the Chrome add-on 0.2.0.** Publishing it is the owner's, by
  `apps/extension/PUBLISHING.md`.

**Chat refuses off-topic questions in code, not just in the prompt.** `RELEVANCE_FLOOR`
(`@tc/retrieval`) stops a question nothing in the library relates to before any provider call and
refunds the unit. The threshold is measured; `docs/BUILD_LOG.md` has the cosines.

**Real providers are live** (2026-09-13). `AI_PROVIDER=anthropic` means "not the mock"; the vendor
is derived per tier from the model id (ADR-0011, `packages/ai/src/providers/routing.ts`). Today
`AI_FAST_MODEL=gpt-5-nano` and `AI_STRONG_MODEL=gpt-5-mini` — both OpenAI. The Anthropic key is
still in `.env` and still valid, but the owner asked that it stay unused, and no configured model
routes to it. Embeddings are Voyage `voyage-4` (1024-d; ADR-0032 — a model switch needs
`pnpm ai:reembed`, or every stored vector is silently wrong). OTP mail goes out over Hostinger SMTP as
`no-reply@rademics.ai`, proven by a delivered message.

**The competitor gap list (2026-09-24, ADRs 0018–0026).** Built against Jenni.ai's feature set:
version history, library export, one-journal concentration, all CSL styles, the editor on a
phone, `@` a paper and `/` saved prompts in chat, arXiv and PubMed, LaTeX and HTML export,
journal citedness, the citation-support check, the writing profile with guidance, and
proofreading. Proofreading is the one that brushes §12.3: code, not the prompt, refuses any
correction that puts a different word in (`correctionSize`). `docs/BUILD_LOG.md` → "The
competitor gap list" has the faults it found in the shipped product. Charts followed the same
day (ADR-0027: drawn on a canvas from the student's numbers, no model, stored as a figure with
the numbers kept on it). Real-time co-authoring closed the list (ADR-0028: Yjs rooms served by
the API's own `y-protocols` handler, the database still the truth, a `canEdit` share for the
co-author, off by default and live only for a document with a co-author). The whole list is
built; production needs the v0.1.5 release and, for co-authoring, the host nginx `/collab/`
location and the flag — both in `docs/PENDING.md`.

**A fully active student costs ₹52.72/month** against the ₹100 ceiling (₹7 of it hosting; chapter
builds, ADR-0039, are ₹27.12 and viva preparation, ADR-0030, ₹11.16 of the rest). `docs/COSTING.md` shows the derivation, the sensitivity to user count, and the profit at
₹299. `pnpm ai:verify` reproduces it. The runtime hard stop at ₹100 of real spend is in
`UsageService.consume`.

Everything else that is not done needs a human, and `docs/PENDING.md` lists each with its steps:
the VPS and its deploy, k6, Sentry, Uptime Kuma, backup crons, Google OAuth credentials, the CORE
key, Razorpay keys and the §11.6 price confirmation, fixture papers, the C.3/C.4/C.5 sets, a real
university guideline to replace `EXAMPLE_IN_UNIVERSITY`, and the `@tiptap/core` v3 decision from
the B4.3 dependency audit.

The owner's standing instructions (2026-09-04/05): build every phase without stopping at a gate,
**build first and verify in batches**, and keep `docs/PENDING.md` listing everything that needs a
human. PRD v2 is the lean spec that reflects this; v1.1 (`docs/PRD.md`) is kept for reference.

`packages/ui` (and the other packages) are consumed from `dist`: after editing one, run `pnpm build`
in that package or the running web/API keeps the old code. `apps/api` likewise runs `dist/main.js`.

Start a session with: read `docs/PENDING.md` — nothing buildable is left, so new work comes from
the owner, from a key arriving, or from a fresh PRD audit. Before running
`prisma generate` on Windows, stop the API **and the worker** — both hold the engine DLL open, and
a running worker fails the rename with EPERM.

## Hard-won rules

These each cost a debugging session. `docs/BUILD_LOG.md` has the full account.

- **A job id must key on what the job will read, not what it will write.** Keying on the row id
  alone made BullMQ swallow every retry and re-index. Job ids also cannot contain `:`.
- **Prove a screen in a browser.** Four faults so far were invisible to every API and unit test and
  showed up only under Playwright: two CORS faults in week 1, the JSON content-type on multipart
  uploads, and a saved proposal that re-rendered as a fresh draft.
- **Check a third-party API's field list before selecting from it.** `subtype` is not
  Crossref-selectable and made every reference lookup a 400.
- **Kill a Node app by its wrapper path, not by `dist/main.js`.** Every app's process command
  line on Windows is the bare `node dist/main.js`; only the `dotenv-cli` parent carries
  `apps\worker` or `apps\api`. A pattern that misses leaves a stale process consuming the same
  BullMQ queue, and half the jobs run against the code you just replaced - which looks exactly
  like a bug in the new code.
- **A job's terminal state belongs to the worker, not to whoever is watching.** The coherence
  run was marked DONE by the SSE endpoint, so closing the tab wedged the document at "already
  running". The worker writes it now; the stream's copy is the idempotent second write.
- **Nest owns Fastify's JSON parser.** A second `application/json` parser fails at `listen()`
  with `FST_ERR_CTP_ALREADY_PRESENT`; for a raw body pass `{ rawBody: true }` to
  `NestFactory.create` and read `request.rawBody`.
- **Never assert a fact the code has not observed.** Grounding levels, abstracts and citation counts
  are only written when something was actually fetched and read.
- **Kill a process by its wrapper's path, not the bare command.** The API and worker both run as
  `node dist/main.js`, so a pattern matching that kills the wrong one. Match the `dotenv-cli`
  parent's path, or find the pid from the listening port.
- **The worker owns terminal job state.** Writing it only from the SSE watcher left a coherence run
  stuck at `RUNNING` whenever nobody was watching.
- **Nest installs Fastify's JSON parser itself,** at `init()`. Registering one first is
  `FST_ERR_CTP_ALREADY_PRESENT`; for raw bodies pass `{ rawBody: true }` to `NestFactory.create`.
- **Check the library's real API before hand-rolling one.** `fieldParagraph` built a Word field out
  of `TextRun`s with `{ type: 'begin' } as never`; `docx` has `TableOfContents`, and the hand-rolled
  version printed its own field codes into the PDF.
- **An adapter with no test is a file nobody has run, and the mock will hide that for months.**
  Twice now: the Anthropic adapter put its system blocks inside `messages` for the entire build,
  and the OpenAI adapter failed sixteen of nineteen structured calls the first time one was made.
  Both looked right in the arguments and were wrong on the wire, and both were invisible because
  every call went to a mock that answers correctly by construction. Assert the request **body**,
  through the SDK's `fetch` injection point — `packages/ai/test/{anthropic,openai}.spec.ts` — and
  run `pnpm ai:shakedown` after any change to a provider, a model id or a schema.
- **A cap that bounds the answer does not bound a reasoning model.** `max_output_tokens` is shared
  between thinking and answering, so every `maxTokens` written for a non-reasoning model silently
  became a combined budget, and several actions spent all of it thinking and returned an empty
  string. The adapter adds `REASONING_HEADROOM` on top; do not fold the two together again.
- **OpenAI's strict structured outputs refuses `.default()` and `z.tuple`,** and is also the only
  thing that makes a prompt saying "output only the sentence" return `{ text }`. The adapter tries
  strict and falls back on a schema rejection, which is free because it happens before generation.
- **Only OpenAI's strict mode holds an enum, and one `.default()` turns strict mode off.** The
  adapter falls back to JSON mode when strict refuses a schema, and in JSON mode the model names
  its own values: proofreading's `kind` came back "doubling" and one bad label failed a whole
  batch of forty sentences. Write a schema whose answer matters field by field without
  `.default()` or `.max()`, and normalise anything open-ended in code (ADR-0026).
- **Gate a commit on lint's exit code, never through a pipe.** `pnpm lint | tail` returns
  `tail`'s status, and twice a failing lint reached a commit that way. Use
  `if pnpm lint > log 2>&1; then git commit …; fi`.
- **A fixed date in a fixture is a test with an expiry.** `billing-webhook.spec.ts` defaulted a
  period end to the constant 2026-09-21; three days of grace later every CI run went red with
  no code change, and the browser job behind it stopped running. A fixture that means "still
  in the future" must say so relative to `Date.now()`.
- **A presigned link is only as reachable as the host it was signed for.** Production MinIO is
  `http://minio:9000`, a Compose-network name, and every download, figure and "Open PDF" link was
  signed for it until 2026-09-29 — invisible in dev and CI, where the browser reaches MinIO. Links
  are signed for `S3_PUBLIC_URL` and `edge` forwards `/thesis-copilot/`; test a link from outside.
- **A single-file bind mount keeps the old file after a checkout.** `edge.conf` changes never
  reached nginx; `deploy.sh` now recreates `edge` when the file differs.
- **No model call without a time limit.** The second real chapter build (2026-10-01) hung for an
  hour on one examiner call and seven and a half on the next, and took 8 h 34 min; every call
  before them had finished in 25 s. Pass `signal: AbortSignal.timeout(...)` on every `LlmRequest`
  a job makes, and treat a timeout as a failed call the job survives.
- **Never write a regex through a Python heredoc.** `\b` in a Python string is a literal backspace
  byte, so `/^(figure|table)\b/i` reached the file as `/^(figure|table)\x08/i` and silently never
  matched. Use a Python raw string (`r'...'`), or the Write/Edit tools, for anything with a
  backslash in it.
- **A TipTap extension keeps the options it was built with.** `useEditor` without deps calls
  `setOptions`, which never rebuilds plugins, so the automatic-suggest setting (fetched after the
  editor exists) stayed `false` and automatic suggestions never fired in the web app until
  ADR-0078. Anything that can change after the editor is built is read live (extension storage),
  and a unit test that builds the editor with the option already set cannot catch it.
