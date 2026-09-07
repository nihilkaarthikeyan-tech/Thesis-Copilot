# Thesis Copilot

A writing environment for a postgraduate thesis. It reads the papers a student is working from,
helps them plan and write against their own sources, checks the thesis against itself and against
their university's formatting rules, and hands them a file they can submit.

The whole product is built around one rule: **the model flags, the student fixes.** Nothing an
AI produces enters the thesis without the student explicitly putting it there.

---

## Status

**The build is complete, and the test batch is complete.** Every unit of
[`docs/PHASES-version-2.md`](docs/PHASES-version-2.md) is done — Phase 1 weeks 0–5, Phase 2 weeks
6–11, Phase 3 blocks 1–4, and the VERIFY batch.

| | |
|---|---|
| Unit + integration tests | **967 passing** (Vitest, 69 files) |
| Browser tests | **28 passing** (Playwright, against the dev stack) |
| `pnpm lint`, `pnpm typecheck` | clean |
| Migrations | 0001 → 0010, `pnpm db:check` agrees with the schema |
| Decisions logged | [9 ADRs](docs/ADR/) |

**What that does not mean.** Two things are true at once, and the second is the one that matters
for planning:

1. Every feature works end to end, driven in a real browser, and is covered by tests.
2. **Every AI call so far has gone to the mock provider.** There is no Anthropic key and no Voyage
   key in this repo. Token counts, cache ratios and the ₹0 cost column are the mock's simulation,
   not measurements. Nothing has been deployed to a server.

So the product is finished as *software* and unproven as a *service*. The gap between those two is
[`docs/PENDING.md`](docs/PENDING.md), which lists 43 items, every one of which needs a person: an
API key, a server, a price confirmation, or a judgement nobody else can make.

The three that block everything else:

- **A provider key.** `pnpm ai:verify` makes one real call, reads the real token counts, and
  recomputes the ₹100 budget from them. Until that runs, the cost model is arithmetic, not evidence.
- **Five fixture papers** (`fixtures/papers/p01.pdf … p05.pdf`). Extraction accuracy, retrieval
  recall and the prompt golden set are all measured against them, and they cannot be invented —
  see the checklist in [`fixtures/papers/README.md`](fixtures/papers/README.md).
- **A VPS.** Deploy, the k6 load test, Sentry's first event and the backup restore drill all wait
  on a server. [`docs/RUNBOOK.md`](docs/RUNBOOK.md) has every procedure written; none has been
  rehearsed.

One open decision, in `docs/PENDING.md`: the ₹100-per-student-per-month ceiling has about **₹1**
of headroom left (the STUDENT plan computes to ₹98.92). No further Strong-tier feature fits, and
the lever the PRD already names is running drafts on the Fast tier, which frees about ₹19. Settle
it after `pnpm ai:verify`, not before — the numbers today come from an estimate.

---

## What it does

| Stage | What the student gets |
|---|---|
| **Start** | Either a topic (a short conversation that becomes a proposal skeleton) or 1–3 of their own papers (uploaded, read, cross-checked for contradictions) |
| **Library** | Literature search across OpenAlex and Semantic Scholar, grouped into a gap map that marks thin themes; BibTeX/RIS import from Zotero or Mendeley; every source resolved to a real DOI with a grounding badge |
| **Outline** | A chapter tree from a template, editable in place, bound to the same record the prompts read; per-section regeneration |
| **Writing** | A TipTap editor with inline suggestions over SSE, citations that resolve to real passages, draft mode, section commands shown as a diff, and chat over the student's own library |
| **Checking** | A coherence engine: term drift, contradictions, unsupported claims, citation integrity, outline drift — each flagged in place, none fixed automatically |
| **Feedback** | Share with a guide, who comments in the browser or marks up the exported `.docx`; a review queue; a response-to-committee table |
| **Submission** | The university's formatting template, ten compliance checks, and a `.docx` or PDF with real front matter, numbered headings and a working contents page |

Two things it will never do, by design: **generate a thesis**, and **help anyone evade an AI
detector** (PRD §12.3).

---

## Getting started

Requires Node 22+, pnpm 9, and Docker.

```bash
pnpm i
cp .env.example .env          # then fill in the required variables below
docker compose -f infra/compose/docker-compose.dev.yml up -d
pnpm db:migrate && pnpm db:seed
pnpm dev
```

`pnpm dev` starts the web app on **:3000**, the API on **:3001**, and the worker. The Compose
services sit on shifted ports so they do not collide with anything else on the machine: Postgres
**5434**, Redis **6381**, MinIO **9002/9003**, Gotenberg **3002**.

**Required in `.env`:** `DATABASE_URL`, `REDIS_URL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`,
`AUTH_SECRET` (32+ characters), `AI_FAST_MODEL`, `AI_STRONG_MODEL`, `AI_EMBED_MODEL`. The app
refuses to start if one is missing, and says which — that is deliberate.

**Without provider keys** everything still runs: set `AI_PROVIDER=mock` and `EMBED_PROVIDER=mock`.
The mock answers from the data in each request and invents nothing, so the whole product is
usable and every cost is ₹0. That is how the entire build was developed and tested.

Signing in without a mail provider: the one-time code is printed to the API console outside
production, and is also readable at `GET /api/v1/auth/dev/last-otp?email=…`.

---

## Commands

```bash
pnpm dev            # web :3000, api :3001, worker
pnpm test           # Vitest — 967 unit and integration tests
pnpm e2e            # Playwright — needs the dev stack already running
pnpm lint           # Biome; CI fails on findings
pnpm typecheck      # tsc across all 19 workspaces
pnpm build          # production build of every package and app

pnpm db:migrate     # apply migrations
pnpm db:seed        # SUPERADMIN, feature flags, the EXAMPLE_IN_UNIVERSITY template
pnpm db:check       # assert the migrations and schema.prisma agree
pnpm ai:verify      # one real provider call; recomputes the ₹100 budget (needs a key)
pnpm pilot:report   # per-student usage, cost, latency and acceptance
```

On Windows, stop **both** the API and the worker before `prisma generate` — each holds the engine
DLL open and a running worker fails the rename with `EPERM`.

---

## Repository

```
apps/
  web         Next.js 15 (App Router, React 19, Tailwind v4)
  api         NestJS 11 on Fastify — HTTP and SSE
  worker      BullMQ consumers; no inbound port
packages/
  db          Prisma schema, migrations, seed
  ai          provider abstraction, prompt builders, prompts/, cost tables
  retrieval   chunking, embeddings, pgvector queries, scholarly API clients
  citations   CSL-JSON mapping, citeproc rendering, 22-style registry
  export      docx builder, template engine, compliance checks
  config      Zod env schema, plan and cap tables, cost constants
  ui          shared components and the five TipTap extensions
  types       Zod DTOs shared by web and api
infra/        Docker, Compose, deploy/backup/restore scripts
fixtures/     papers, prompts, thesis — human-authored test material
docs/         PRD, PHASES, BUILD_LOG, RUNBOOK, PENDING, ADR/
```

### Stack

Postgres 16 with pgvector (HNSW), Redis, MinIO, Gotenberg (LibreOffice, for every PDF),
Better Auth (email OTP + Google), the Vercel AI SDK behind `packages/ai`, Voyage `voyage-3`
embeddings at 1024 dimensions, `@citation-js` for citations, `docx` for export, Caddy 2 in front.

Model ids are **never** hardcoded — `AI_FAST_MODEL`, `AI_STRONG_MODEL` and `AI_EMBED_MODEL` come
from the environment and are verified by `pnpm ai:verify`.

---

## The rules the code is built to

Four constraints shape almost every design decision, and breaking one is a bug even when the
feature works:

- **₹100 per student per month, all in.** A feature that cannot be metered and capped does not
  ship. The cap check and its increment happen in one atomic SQL statement, before any provider
  call — never after.
- **Flag, don't fix.** No AI output reaches the thesis without an explicit student action. Every
  suggestion, revision and draft is shown first and applied only on request.
- **Grounding.** The model may only cite passages present in the request. Anything else is
  stripped and counted as a `HALLUCINATED_CITE`.
- **Never assert a fact the code has not observed.** Grounding levels, abstracts and citation
  counts are written only when something was actually fetched and read.

---

## Documentation

| File | What it is |
|---|---|
| [`docs/PRD-version-2.md`](docs/PRD-version-2.md) | The build spec and the single source of truth |
| [`docs/PHASES-version-2.md`](docs/PHASES-version-2.md) | The running order, with a status table |
| [`docs/BUILD_LOG.md`](docs/BUILD_LOG.md) | Per-unit record: what was built, what broke, what the evidence was |
| [`docs/PENDING.md`](docs/PENDING.md) | Everything that needs a human, with the exact steps |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Deploy, rollback, key rotation, backups, restore, scaling |
| [`docs/ADR/`](docs/ADR/) | Nine decisions that departed from the PRD, each with its reasoning |
| [`CLAUDE.md`](CLAUDE.md) | Agent brief — a summary for speed, not an authority |

`docs/PRD.md` and `docs/PHASES.md` are v1, kept for the units finished before v2. If the PRD and
PHASES ever disagree, **the PRD wins** and the difference is logged in `BUILD_LOG.md`.

---

## Contributing

- TypeScript everywhere, `strict: true`. No `any` without a comment saying why.
- Conventional Commits, one logical change per commit.
- Never delete or skip a test to make CI pass.
- Never invent an API — check the package's own types first.
- A changed decision gets an ADR before the change, not after.
- Prompts in `packages/ai/prompts/*.md` are content, not code: they are verbatim from PRD
  Appendix A and are not edited to fix a bug in the code around them.
