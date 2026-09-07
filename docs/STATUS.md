# Thesis Copilot — status report

**Date:** 2026-09-07 · **Period covered:** 2026-09-04 → 2026-09-07 · **Prepared for:** management

---

## Headline

**Development is effectively complete — 58 of 61 in-scope requirements. A line-by-line audit on
2026-09-07 found three small gaps, listed below; they are ~1 day of work. The launch blockers are
not code.**

| | |
|---|---|
| Requirements built | **58 of 61 in scope (95%)** |
| Gaps found by audit | 3, all P2/P3, ~1 day (see "Audit findings") |
| Deferred by the spec itself | 2 (LaTeX export, annotated-PDF import — both marked post-launch in the PRD) |
| Automated tests passing | **994** unit/integration + **28** browser |
| Build, lint, type-check | Clean |
| **Ready for paying users** | **No** — three external dependencies, listed below |

---

## Audit findings (2026-09-07)

A requirement-by-requirement audit against the specification, rather than against the project plan,
found three features that were specified and never built. All three fell between the specification
and the phase plan — the phase plan never scheduled them, so no task was ever marked incomplete.

| Ref | Feature | Priority | Impact |
|---|---|---|---|
| FR-5.6 | Rewrite a citation between narrative and parenthetical form on request | P3 | Convenience. The citation already stores which form it is; what is missing is the button that rewrites the sentence around it. |
| §2.2 | Separate on/off switch for automatic citation, independent of automatic suggestions | P2 | A student who wants suggestions without citations cannot have that today. |
| §2.2 | Suggestions follow the document's language setting | P2 | The language is stored and ignored, so a non-English thesis gets English suggestions. Not a pilot blocker — the pilot is English — but a real limit on the market. |

Estimated to close: about one day. Recommend closing before the pilot rather than after, since the
second and third are both visible to a student.

A fourth, non-functional finding: three screens in the specification were merged into other screens
during the build (citations and coherence flags became panels inside the editor; export became the
submission screen). These are sound design decisions and the product is complete without them, but
they were never written down as deviations. Now recorded in `docs/BUILD_LOG.md`.

---

## What was built

Every phase of the plan (`docs/PHASES-version-2.md`) is closed:

| Phase | Scope | State |
|---|---|---|
| Phase 0 | Scaffold, CI, infrastructure | Done |
| Phase 1 (weeks 1–5) | Editor, paper ingestion, grounded suggestions, citations, draft mode, metering | Done |
| Phase 2 (weeks 6–11) | Literature search, outlines, style profile, chat, citation styles, billing | Done |
| Phase 3 (blocks 1–4) | Coherence engine, supervisor feedback cycle, submission bundle, institution admin | Done |
| Verification | Full test batch | Done |

**By the numbers:** 20 application screens, 115 API endpoints, ~59,700 lines of TypeScript,
10 database migrations, 70 test files, 72 commits.

---

## What is not done, and why

Nothing on this list is engineering work. Each item is an input the business must supply.

### 1. No AI provider account — **blocks launch**

Every AI call built so far has run against a simulator. The product works, but no real model has
ever been called.

- **Impact:** the running-cost model is arithmetic, not measurement. We have designed to a ceiling
  of ₹100 per student per month; we cannot yet prove we meet it.
- **Needed:** an Anthropic API key and a Voyage embeddings key.
- **Then:** one command (`pnpm ai:verify`) makes a real call and recomputes the budget from actual
  token counts. Same day.

### 2. No test corpus — **blocks quality measurement**

Three accuracy measurements are built and cannot run: extraction accuracy, retrieval accuracy, and
suggestion quality.

- **Needed:** five open-access papers in the pilot field, and thirty questions written against
  them by someone who knows the subject.
- **Why we cannot produce these ourselves:** the measurements would be marking our own work. The
  specification forbids it deliberately, and it is the right call — a benchmark we wrote would tell
  us nothing.
- **Effort for the business:** roughly half a day of a domain expert's time. Checklists are written
  (`fixtures/papers/README.md`, `fixtures/retrieval/README.md`).

### 3. No server — **blocks deployment**

- **Needed:** one VPS, a domain, and payment-gateway credentials.
- **Then:** deploy, load test, error monitoring and the backup drill. Every procedure is written
  in `docs/RUNBOOK.md`; none has been rehearsed against real hardware.

---

## The one commercial risk to flag

The unit economics are **tight and unverified**.

We committed to serving a student for **₹100 per month, all in**. The current design computes to
**₹98.92** — about **₹1** of headroom. That number comes from published list prices, not from a
bill we have received.

- If real prices are higher than assumed, we are over budget on day one.
- No further AI-powered feature will fit inside the ceiling as it stands.
- **There is a known lever:** running the drafting feature on the cheaper model tier frees about
  ₹19 per student. This costs some output quality and is a business trade-off, not a technical one.

**Recommendation:** get the provider key first, run the verification, and take this decision on
measured numbers rather than estimates. It is a one-day exercise once the key exists.

---

## Path to launch

| Step | Owner | Depends on | Effort |
|---|---|---|---|
| 1. Obtain provider keys | Business | — | Hours |
| 2. Verify the cost model, settle the ₹100 decision | Engineering | Step 1 | 1 day |
| 3. Supply five papers + thirty questions | Domain expert | — | Half a day |
| 4. Run accuracy measurements, fix what they show | Engineering | Step 3 | 2–3 days |
| 5. Provision the server, deploy, load test | Engineering | VPS + domain | 2–3 days |
| 6. Recruit five pilot students, run the pilot | Business | Step 5 | 2–4 weeks |

Steps 1 and 3 are independent and can start immediately and in parallel. **Nothing in this table
is blocked on further development.**

---

## Summary for the record

The software was built to specification and is tested to a standard we can defend: 994 automated
tests and every user-facing screen exercised in a real browser. An audit against the specification
found three small gaps, listed above and now scheduled; they were found by re-reading the
requirements rather than by trusting the project plan, which is the check worth having done.

What stands between us and a live product is not code. It is three purchases and half a day of
subject-matter input. The honest position is that we have finished building and have not yet
finished proving — and the proving cannot begin until the business supplies the keys, the papers
and the server.

*Supporting detail: `docs/BUILD_LOG.md` (what was built and what broke), `docs/PENDING.md` (every
outstanding item with its exact steps), `docs/RUNBOOK.md` (operations).*
