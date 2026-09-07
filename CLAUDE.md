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
| AI SDK | Vercel AI SDK (`ai`) + `@ai-sdk/anthropic`, behind `packages/ai` |
| Embeddings | Voyage `voyage-3` (1024-d); dimension is a config constant |
| Citations | `@citation-js/core` + `plugin-csl` |
| Export | `docx` → Gotenberg for PDF |
| Parsing | `unpdf` (PDF), `mammoth` (DOCX), GROBID optional behind a flag |
| Proxy / CI | Caddy 2; GitHub Actions → GHCR → SSH deploy |

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

**Phase 1 and Phase 2 are built** (2026-09-06). `docs/BUILD_LOG.md` has per-task evidence.

Working end to end: OTP sign-in; Path A (a 2–4 turn conversation with an OpenAlex gap check) and
Path B (upload 1–3 papers, extraction, cross-paper flags); the proposal screen; literature
discovery with a themed gap map, curation and BibTeX/RIS import; templates and generated outlines
with an editable tree; the editor with Assist ghost text over SSE, citations with passage popovers,
guided input, draft mode, section commands with a diff, chat over the library, and automatic
suggest behind a per-user setting; a style profile learned from the student's own 1,500 words;
citeproc citations in 22 styles with an instant switch, mechanical checks and paste-parse;
`.docx`/PDF export with numbered headings and a real bibliography; caps, the usage meter,
`/admin` and `/admin/users`; Razorpay subscriptions with T−3 reminders, one-click cancel and
invoice PDFs; and the marketing pages (`/pricing`, `/privacy`, `/refunds`).

Not done, and why:
- **Every AI call so far went to the mock.** Cost is ₹0 everywhere; token counts and cache ratios
  are the mock's simulation. `pnpm ai:verify` with a real key settles the cost model.
- **Tests for weeks 6–11 are owed** — the build-first instruction. `docs/PHASES-version-2.md` →
  VERIFY lists them; weeks 1–5 are covered (659 unit/integration, 21 Playwright).
- **Anything needing a key, a server or a human decision** is in `docs/PENDING.md`: provider keys,
  the VPS and deploy, k6, Sentry, Razorpay keys and price confirmation, fixture papers, the C.4/C.5
  sets, university templates.
- **Phase 3 is next** (`docs/PHASES-version-2.md` → PHASE-3): coherence engine, guide cycle,
  institution templates and compliance, institution admin.

The owner's standing instructions (2026-09-04/05): build every phase without stopping at a gate,
**build first and verify in batches** rather than PRD §0.3 rule 7's one-task-at-a-time cadence,
and keep `docs/PENDING.md` listing everything that needs a human. The deviation from rule 7 is
logged in `docs/BUILD_LOG.md`; the PRD itself is unchanged.

`packages/ui` (and the other packages) are consumed from `dist`: after editing one, run `pnpm build`
in that package or the running web/API keeps the old code. `apps/api` likewise runs `dist/main.js`.

Start a session with: read the status table in `docs/PHASES-version-2.md` and continue with the
next unit. Before running `prisma generate` on Windows, stop the API **and the
worker** — both hold the engine DLL open, and a running worker fails the rename with EPERM.

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
