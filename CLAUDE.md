# Thesis Copilot — agent brief

`docs/PRD.md` is the single source of truth. `docs/PHASES.md` splits it into execution units.
If they ever disagree, **the PRD wins** and the difference goes in `docs/BUILD_LOG.md`.
This file is a summary for speed, not an authority — when in doubt, open the PRD section named.

## Agent protocol (PRD §0.3 — read it in full before building)

1. Never invent an API — check `node_modules/<pkg>` types first.
2. Never claim a DoD is met without pasted command output.
3. Never fabricate fixture data. The agent may write `*.expected.draft.json`, never `*.expected.json`.
4. Never silently change a decision — write `docs/ADR/NNNN-<slug>.md` and ask.
5. Never guess model IDs, prices or limits — `pnpm ai:verify` (Appendix E) settles them.
6. Prefer boring over clever.
7. One task at a time: implement → verify → log → commit → next.
8. Build only the phase requested.
9. Stop when stuck; write what was tried and ask a specific question.
10. Never delete or skip a test to make CI pass.
11. Prompts are content, not code — `packages/ai/prompts/*.md` are verbatim from Appendix A.
12. Report uncertainty as `UNSURE:` in the log.

## Conventions (PRD §0.2)

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

**Phase 1 weeks 0–5 are built** (2026-09-05). `docs/BUILD_LOG.md` has per-task evidence. Working
end to end and driven in a real browser: sign-in, the thesis list, the proposal screen, the
library with grounding badges and manual DOI fix, the TipTap editor with Assist through the real
prompt pipeline (A.0/A.0.1/A.1 rendered from the prompt files, §10.4 retrieval, §10.6 whitelist),
citations that resolve to real sources with a hover passage, claim-triggered citation suggestion,
draft mode (grounded or refused, accepted or discarded), `.docx`/PDF export, the AI-usage log,
the SUPERADMIN dashboards, §14 alerts through a console mailer, live feature-flag toggles, the
§6.2 error/empty states, first-run hints and the "How suggestions work" panel, the §12.1
authorisation and rate-limit tests, `/admin/users` (per-student usage, logged cap reset and plan
change, ADR-0004 `AuditEvent`), the feedback link, Sentry behind `SENTRY_DSN`, and
`pnpm pilot:report`.

Not done, and why:
- **Task 2.9 (C.3 scoring)**, the C.4 recall set, the C.5 golden scenarios, the 3.4 thirty-run
  evidence and 3.9 prompt observations are all BLOCKED on things only the human can do: fixture
  papers, a provider key, hand-written scenarios. `docs/PENDING.md` lists each.
- **Every AI call so far went to the mock.** Cost is ₹0 everywhere; token counts and cache ratios
  are the mock's simulation. `pnpm ai:verify` with a real key settles the cost model.
- **Week 5's VPS half** — the k6 run, Sentry's first event, Uptime Kuma, the deploy (5.8), the
  backup crons — needs the server and keys. `docs/PENDING.md` has the exact steps.
- **Phase 2 is next** (`docs/PHASES.md` → PHASE-2).

The owner's standing instructions (2026-09-04/05): build every phase without stopping at a gate,
**build first and verify in batches** rather than PRD §0.3 rule 7's one-task-at-a-time cadence,
and keep `docs/PENDING.md` listing everything that needs a human. The deviation from rule 7 is
logged in `docs/BUILD_LOG.md`; the PRD itself is unchanged.

`packages/ui` (and the other packages) are consumed from `dist`: after editing one, run `pnpm build`
in that package or the running web/API keeps the old code. `apps/api` likewise runs `dist/main.js`.

Start a session with: read `docs/BUILD_LOG.md`, find the last completed task in `docs/PHASES.md`,
continue from the next one. Before running `prisma generate` on Windows, stop the API **and the
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
- **Never assert a fact the code has not observed.** Grounding levels, abstracts and citation counts
  are only written when something was actually fetched and read.
