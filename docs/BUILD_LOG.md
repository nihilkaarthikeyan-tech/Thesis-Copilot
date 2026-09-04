# Thesis Copilot — Build log

Append-only. One section per unit, one entry per task. Newest at the bottom.
Evidence is a pasted command and its trimmed output — never a description (PRD §0.3 rule 2).

---

## Unit: PHASE-0 — Scaffold
Started: 2026-09-04 · Sessions: 1

### Task 0.1 — Monorepo skeleton
- Status: DONE
- Evidence:
  ```
  $ pnpm install
  devDependencies:
  + @biomejs/biome 2.5.12
  + turbo 2.10.12
  + typescript 5.9.3
  Done in 1m 10.6s using pnpm v9.15.9

  $ pnpm biome check .
  Checked 31 files in 9ms. No fixes applied.

  $ pnpm -r list --depth -1
  thesis-copilot D:\Thesis Copilot (PRIVATE)
  @tc/api@0.1.0        apps/api
  @tc/web@0.1.0        apps/web
  @tc/worker@0.1.0     apps/worker
  @tc/ai@0.1.0         packages/ai
  @tc/citations@0.1.0  packages/citations
  @tc/config@0.1.0     packages/config
  @tc/db@0.1.0         packages/db
  @tc/export@0.1.0     packages/export
  @tc/retrieval@0.1.0  packages/retrieval
  @tc/types@0.1.0      packages/types
  @tc/ui@0.1.0         packages/ui
  ```
- Notes / deviations from PRD:
  - Toolchain checked before pinning (§0.3 rule 1). Node v24.18.0, pnpm 9.15.9, Docker 29.5.3.
  - Versions pinned to the newest release inside each major the PRD fixes in §7.2:
    Next 15.5.25, React 19.2.0, NestJS 11.2.3, Fastify 5.12.3, Prisma 6.19.3, TypeScript 5.9.3,
    Biome 2.5.12, Turborepo 2.10.12, Vitest 4.1.11, Tailwind 4.3.3, BullMQ 5.81.4, zod 4.5.4.
    Newer majors exist (TypeScript 7, Next 16, NestJS 12, Prisma 8, vitest 5) and were NOT taken:
    §7.2 fixes the majors and §0.3 rule 6 says prefer boring. Changing a major needs an ADR.
  - `ai` 7.0.92 + `@ai-sdk/anthropic` 4.0.49 declare peer `zod: ^3.25.76 || ^4.1.8`; zod 4.5.4 satisfies it.
  - Dev Compose ports are shifted off the defaults (Postgres 5434, Redis 6381, MinIO 9002/9003,
    Gotenberg 3002) because this machine already runs other projects' containers on 5432/6379/9000.
  - `pnpm install` prints a node-gyp warning for `ssh2` (an optional native crypto binding pulled in by
    testcontainers). It is optional, the install completes, and testcontainers falls back to pure JS.
- UNSURE: —
