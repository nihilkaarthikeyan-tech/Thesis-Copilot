# Thesis Copilot

A writing environment for a postgraduate thesis. It reads the papers a student is working from,
helps them plan and write against their own sources, checks the thesis against itself and against
their university's formatting rules, and hands them a file they can submit.

The whole product is built around one rule: **the model flags, the student fixes.** Nothing an
AI produces enters the thesis without the student explicitly putting it there.

---

## Status

**The build is complete, the test batch is complete, and the product now runs on real providers.**
Every unit of [`docs/PHASES-version-2.md`](docs/PHASES-version-2.md) is done — Phase 1 weeks 0–5,
Phase 2 weeks 6–11, Phase 3 blocks 1–4, and the VERIFY batch.

| | |
|---|---|
| Unit + integration tests | **1,166 passing** (Vitest, 75 files; 2 skipped, both waiting on fixture papers) |
| Browser tests | **28 passing** (Playwright, against the dev stack) |
| `pnpm lint`, `pnpm typecheck` | clean |
| Migrations | 0001 → 0012, `pnpm db:check` agrees with the schema |
| Decisions logged | [11 ADRs](docs/ADR/) |
| AI providers | **live** — OpenAI (both tiers), Voyage (embeddings), Anthropic (configured, unused) |
| Outbound email | **live** — Hostinger SMTP, `no-reply@rademics.ai`, delivery confirmed |
| Cost per student per month | **₹14.18** worst case, against a ₹100 ceiling |

**What that does not mean.** Two things are true at once, and the second is the one that matters
for planning:

1. Every feature works end to end, driven in a real browser, covered by tests, and every AI call
   now goes to a real model whose token counts and cost are measured rather than simulated.
2. **Nothing has been deployed to a server**, and the prompt cache has not been proven on a full
   chapter — which needs the five fixture papers nobody has supplied yet. At our own caps that is
   worth ₹2.63 a month, so the ceiling is safe either way; at any larger tier it is the whole
   question.

So the product is finished as *software* and unrehearsed as a *service*. The gap between those two
is [`docs/PENDING.md`](docs/PENDING.md), which lists every remaining item, and every one of them
needs a person: a server, a price confirmation, five PDFs, or a judgement nobody else can make.

The two that block the most:

- **Five fixture papers** (`fixtures/papers/p01.pdf … p05.pdf`). Extraction accuracy, retrieval
  recall, the prompt golden set and the cache proof are all measured against them, and they cannot
  be invented — see the checklist in [`fixtures/papers/README.md`](fixtures/papers/README.md).
- **A VPS.** Deploy, the k6 load test, Sentry's first event and the backup restore drill all wait
  on a server. [`docs/RUNBOOK.md`](docs/RUNBOOK.md) has every procedure written; none has been
  rehearsed.

### What the models cost

Since ADR-0011 the fast tier runs `gpt-5-nano` and the strong tier `gpt-5-mini`. A fully active
student — one who spends every unit of every cap, every month — costs **₹14.18**, of which ₹7 is
their share of hosting and only ₹6.74 is AI. At ₹299/month that is a **95% gross margin**, and it
leaves ₹85.82 of headroom under the ₹100 ceiling.

That number moved a long way during the build: ₹98.92 → ₹86.03 (a mispriced Sonnet) → ₹26.40
(moving to OpenAI) → ₹16.68 (`gpt-5-nano` on the fast tier) → ₹14.18 (the one-time-ops line was
still being priced at the tier fallback rather than the configured model).

[`docs/COSTING.md`](docs/COSTING.md) shows the whole calculation, what happens at 50 users instead
of 500, and what the manager's proposed pricing tier would cost. `pnpm ai:verify` reproduces it
from the live configuration.

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

**Provider keys.** `AI_PROVIDER=anthropic` means "use real models"; which vendor is actually called
is derived from the model id, per tier (ADR-0011), and the env schema then demands the matching
key. What runs today:

```dotenv
AI_PROVIDER=anthropic         # "not the mock". The vendor comes from the model ids below.
AI_FAST_MODEL=gpt-5-nano      # -> OpenAI. Assist, citations, chat.
AI_STRONG_MODEL=gpt-5-mini    # -> OpenAI. Drafts, commands, coherence.
OPENAI_API_KEY=sk-proj-…
ANTHROPIC_API_KEY=sk-ant-…    # kept and valid, but no configured model routes to it

EMBED_PROVIDER=voyage
AI_EMBED_MODEL=voyage-3
VOYAGE_API_KEY=pa-…

SMTP_HOST=smtp.hostinger.com  # OTP delivery; RESEND_API_KEY works instead
SMTP_PORT=465
SMTP_USER=no-reply@rademics.ai
SMTP_PASS=…
SMTP_FROM=no-reply@rademics.ai
```

Putting a `claude-*` id on either tier moves that tier back to Anthropic with no code change; the
schema will then require `ANTHROPIC_API_KEY` and reject the boot if it is missing. Run
`pnpm ai:verify` after any change — it makes one real call per tier and re-derives the ₹100 budget
from the models you actually configured.

**Without provider keys** everything still runs: set `AI_PROVIDER=mock` and `EMBED_PROVIDER=mock`.
The mock answers from the data in each request and invents nothing, so the whole product is usable
and every cost is ₹0. That is how the entire build was developed, and how CI still runs.

Signing in without a mail provider: the one-time code is printed to the API console outside
production, and is also readable at `GET /api/v1/auth/dev/last-otp?email=…`.

---

## Commands

```bash
pnpm dev            # web :3000, api :3001, worker
pnpm test           # Vitest — 1,166 unit and integration tests
pnpm e2e            # Playwright — needs the dev stack already running
pnpm lint           # Biome; CI fails on findings
pnpm typecheck      # tsc across all 19 workspaces
pnpm build          # production build of every package and app

pnpm db:migrate     # apply migrations
pnpm db:seed        # SUPERADMIN, feature flags, the EXAMPLE_IN_UNIVERSITY template
pnpm db:check       # assert the migrations and schema.prisma agree
pnpm ai:verify      # one real call per tier + embeddings; recomputes the ₹100 budget
pnpm ai:shakedown   # every structured-output path against the real models (~₹2.40 a run)
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
embeddings at 1024 dimensions, `@citation-js` for citations, `docx` for export, and nginx in
front — the host's own, because the server already runs one for its other sites (ADR-0012).

Model ids are **never** hardcoded — `AI_FAST_MODEL`, `AI_STRONG_MODEL` and `AI_EMBED_MODEL` come
from the environment and are verified by `pnpm ai:verify`.

Two vendors are wired in, and which one serves a tier is derived from that tier's model id rather
than configured separately — the two cannot then disagree, which is a 404 from the wrong vendor
(`packages/ai/src/providers/routing.ts`, ADR-0011). `@ai-sdk/openai` and `@ai-sdk/anthropic` are the
only two files in the repo allowed to import a vendor SDK; everything else goes through the
`LlmProvider` interface. The two adapters are deliberately near-identical line for line, so a fix
to one is visibly needed in the other.

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
| [`docs/COSTING.md`](docs/COSTING.md) | What a student costs, what we charge, the profit, and how each number is derived |
| [`docs/PRICING-REVIEW.md`](docs/PRICING-REVIEW.md) | Review of the proposed commercial pricing, against the cost model |
| [`docs/DESIGN.md`](docs/DESIGN.md) | The Paper & Ink design system: tokens, light/dark, components |
| [`docs/API-AUDIT.md`](docs/API-AUDIT.md) | The API checked rule by rule, and the defects it found |
| [`docs/ADR/`](docs/ADR/) | Eleven decisions that departed from the PRD, each with its reasoning |
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
