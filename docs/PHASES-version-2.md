# Thesis Copilot — PHASES version 2 (running order for PRD v2)

This file splits `docs/PRD-version-2.md` into build units. Each unit says what to read, what to
build, and in what order. The PRD is the source of truth; if this file appears to contradict it,
the PRD wins. `docs/PHASES.md` (v1) is kept for reference; the units it lists as done are done.

## How to run a unit

- One unit is one week of PHASES work. Build the whole unit — code, `pnpm typecheck`, `pnpm lint` —
  then commit and push. Each task gets a line in `docs/BUILD_LOG.md`; anything only a human can
  do (keys, fixtures, VPS, sign-offs, decisions) goes in `docs/PENDING.md` and the agent moves on.
- Prompts (`packages/ai/prompts/*.md`) are used verbatim. New tables or enum values that the PRD
  does not name get a short ADR in `docs/ADR/` and a migration.
- Start prompt for a session:

```
Read docs/PRD-version-2.md §0.3 and the "Read" list of unit <UNIT> in docs/PHASES-version-2.md.
Build every task of <UNIT> in order. Keep the tree compiling (typecheck + lint), commit per unit,
push, and keep docs/PENDING.md current. Then continue with the next unit.
```

## Status (2026-09-05)

| Unit | Content | State |
|---|---|---|
| PHASE-0 | Scaffold | done |
| PHASE-1 W1–W5 | Editor, Path B ingestion, grounded Assist + citations, Draft mode + metering, pilot hardening | done (VPS half in `docs/PENDING.md`) |
| PHASE-2 W6 | Path A conversation, multi-paper, chooser | done |
| PHASE-2 W7 | Literature search, gap map, curation, import | done |
| PHASE-2 W8 | Templates, outline, document memory, multi-chapter | done |
| PHASE-2 W9 | Style profile, section commands, automatic-suggest, chat | done |
| PHASE-2 W10 | Citations done properly (CSL, styles, checks, paste-parse, docx upgrade) | done |
| PHASE-2 W11 | Billing, plans, marketing | done |
| PHASE-3 B1 | Coherence engine | done |
| PHASE-3 B2 | Guide and committee cycle | done |
| PHASE-3 B3 | Institution templates, compliance, PDF, polish | done |
| PHASE-3 B4 | Institution admin and hardening | done |
| VERIFY | Test batch and pilot report | tests done; the pilot report needs students |

`docs/BUILD_LOG.md` has the per-task record of the finished units.

---

## PHASE-2 — Complete the loop

### W7 — Literature search, gap map, curation, import

**Read:** PRD v2 §5.2 (FR-2.5–2.9), A.7, A.8, §9.2, §8 (`SearchCandidate`, `Source.subTheme`), §10.4.

1. **Query generation + search job.** A.7 (`queries.md`, Strong, one call per run) from the saved
   scope, with the library's titles as `<existing_sources>` for Path B. Job `search-literature`
   (queue exists): each query hits OpenAlex `/works?search=` (filter `type:article|preprint|book-chapter`,
   year ≥ current−15), Semantic Scholar secondary when `SEMANTIC_SCHOLAR_API_KEY` is set; merge by
   DOI then normalised title; drop what is already in the library; embedding-similarity filter
   against the scope (keep top 60); store `SearchCandidate` rows under a `runId`; log counts per
   stage. `POST /documents/:id/search { mode }` starts a run; `GET /documents/:id/search/:runId`
   returns it.
2. **Theme labelling.** A.8 (`themes.md`, Fast) over the kept candidates → ≤ 8 themes; thin = < 4;
   gap map JSON on `DocumentMemory.gapMap`; `GET …/search/:runId` returns candidates grouped by
   theme with thin flags.
3. **Curation UI.** Sources screen "Discover" tab: run a search, per-theme lists as a grid (thin
   flagged), select candidates → `POST …/search/:runId/select { candidateIds }` → `Source` rows
   (`subTheme` = theme) → the resolve/index pipeline. Nothing is selected automatically.
4. **Path B expansion (FR-2.8).** `mode: 'expand'`: for each resolved source with an OpenAlex id,
   `cited_by` (top 10) and `related_works`, merged into a run under the theme "Related to your
   citations".
5. **BibTeX/RIS import (FR-2.9).** `POST /documents/:id/sources/import` (multipart `.bib`/`.ris`)
   → parse entries → the same resolve pipeline (raw reference string + DOI when present); the
   Sources screen gets an "Import" control.
6. **Sub-theme on sources.** `Source.subTheme` from the candidate's theme; chunk `subTheme`
   propagated at index time; the §10.4 rerank bonus is already active.

### W8 — Templates, outline, document memory, multi-chapter

**Read:** §5.3 (FR-3.1–3.5), §5.4 (FR-4.2), A.9, §9.1 (`/memory/outline`, `/outline/generate`), §10.7.2.

1. **Templates.** `STEM_EMPIRICAL`, `QUALITATIVE`, `COMPILATION` chapter skeletons in
   `packages/config/templates.ts`; a picker with the system's suggestion from `Document.field`;
   `PATCH /documents/:id` sets `template`.
2. **Outline generation.** A.9 (`outline.md`, Strong) with `<gap_map>` and `<extraction>` (Path B:
   map the paper's sections, add what a thesis needs) → `OutlineNode[]` validated →
   `DocumentMemory.outline`; `Chapter` rows created/updated per top-level node, idempotent by
   `outlineNodeId`; `POST /documents/:id/outline/generate` → job; `mappedFromPaperSection` set where
   it applies.
3. **Editable tree.** Drag/reorder, rename, merge, add, delete (confirm when a chapter has
   content); every edit → `PUT /documents/:id/memory/outline` → `Chapter` sync; the cached prompt
   block changes after an edit (FR-3.4).
4. **Scaffold panel (FR-4.2).** The chapter's scope note and subheadings, collapsible, in the
   editor; shown, never inserted as text.
5. **Multi-chapter navigation.** Left rail from the outline; switching chapters preserves autosave
   state; word counts per chapter.
6. **Glossary editor.** View/edit terms in memory (add, rename, delete, usage notes; the
   conflict-flagged entries from W6 shown with both definitions); an added term appears in the
   next cached block.

### W9 — Style profile, section commands, automatic-suggest, chat

**Read:** §5.4 (FR-4.6–4.9), A.10, A.11, A.4, §11.3 (`CHAT`, `COMMAND` caps).

1. **Style profile.** A.10 (`style.md`, Strong) when `HUMAN` words ≥ 1,500 across the document
   (counted from provenance on save; `ASSIST`/`DRAFT` words excluded); one call; stored on
   `DocumentMemory.styleProfile`; part of the cached block; a "Re-learn my style" button.
2. **Section commands.** A.11 (`command.md`): selection toolbar with expand / formalise / simplify /
   shorten / consistency; result shown as a word-level diff with Apply/Discard; provenance
   `COMMAND`; cap `COMMAND`; citation nodes inside the selection survive.
3. **Automatic-suggest opt-in (FR-4.6).** Per-user setting; the 800 ms idle trigger with the B.3
   conditions (no request while typing continuously); same cap; the setting screen states the
   cost in cap units; flag `automaticSuggest` gates it.
4. **AI chat.** A.4 (`chat.md`): right-panel tab; SSE; retrieval top 8 with filters (year range,
   minimum citations, exclude preprints); cited answers whose `{{cite}}` keys open the passage;
   cap `CHAT`; last 4 turns kept; the "library does not contain enough" reply on off-topic
   questions.

### W10 — Citations done properly

**Read:** §5.5 (FR-5.2–5.5), A.15, Appendix B.5, §5.8 (FR-8.1 upgrade).

1. **CSL rendering.** `packages/citations`: `Source.cslJson` → citeproc via `@citation-js/core` +
   the CSL plugin; 20 bundled styles (APA 7, IEEE, Harvard, Chicago author-date, Vancouver, MLA,
   ACM, Springer, Elsevier Harvard, Nature + 10 more; two placeholder `IN_UNIVERSITY_*` variants
   derived from IEEE/APA until real ones are named); the rendered map (key → label) recomputed on
   save and on style change; numeric ordering across chapters.
2. **Style switcher.** Document-level; instant re-render through the `citationsRerender` meta;
   export uses the same style.
3. **Mechanical checks (FR-5.4).** Orphan / unused / untagged-string checks as a list on
   `/citations`.
4. **Paste-parse.** A.15 (`cite_parse.md`) + Crossref verification: a pasted reference string
   becomes a verified citation node; an unverifiable one is shown as "unverified — check manually"
   and not inserted. On chapter import (`.docx` → ProseMirror) the untagged-citation regex offers
   "Convert to citation" per match.
5. **`.docx` export upgrade.** Heading styles, numbered headings, citeproc bibliography, grounding
   notes removed from the source list.

### W11 — Billing, plans, marketing

**Read:** §5.9 (FR-9.5), §11.6, §2.5, §12.

1. **Razorpay subscriptions.** Plans `STUDENT_MONTHLY`, `STUDENT_ANNUAL`; UPI autopay + cards;
   webhook handler idempotent by event id → `Subscription`; plan → caps; trial → paid upgrade
   immediate; downgrade at period end; past-due handling (3-day grace, then `FREE_TRIAL` caps,
   documents preserved). Keys are a `docs/PENDING.md` item; build against the SDK's test mode.
2. **Billing hygiene (§2.5).** Renewal reminder email T−3 days; cancel button on `/app/account`
   that works at 375 px; cancellation confirmation email; refund policy page linked from pricing;
   invoice PDF per charge.
3. **Pricing page + marketing site.** Plans (§11.6), caps table, integrity statement (§12.3), FAQ
   (Jenni comparison in plain words), privacy page (§12.2).
4. **Usage meter polish.** Per-action bars, reset date, "what counts" tooltip.

**Cut order if late:** BibTeX/RIS import → cited-by expansion → automatic-suggest → styles beyond 8.

---

## PHASE-3 — Thesis-grade

**Read first:** PRD v2 Appendix D. The human items for this phase (a real university guideline PDF
and its `template.json`, the C.6 fixture thesis, a guide willing to test) are in `docs/PENDING.md`;
build with the example template and a synthetic fixture until they arrive.

### B1 — Coherence engine

**Read:** §5.6, D.1, A.12.1–A.12.4, C.6, §11.3 (`COHERENCE` cap).

1. **ChapterChunk indexing.** Paragraph-aligned ~300-token chunks with ProseMirror positions;
   re-index changed chapters only (the HNSW index exists).
2. **Run lifecycle (D.1.1).** Trigger endpoint + autosave debounce (≥ 15 min); changed/related
   chapter detection; cost pre-estimate with scope reduction above ₹12; flag fingerprinting
   (replace OPEN, keep RESOLVED/IGNORED, suppress IGNORED fingerprints); SSE progress;
   `lastCheckedAt`; cap `COHERENCE`.
3. **CITATION_INTEGRITY** (mechanical): orphans, unused, retracted, duplicate DOI, untagged strings.
4. **TERM_DRIFT** (A.12.1): term selection (≤ 12 by frequency in changed chapters), sentence
   gathering (≤ 40, plural/possessive variants), flags with ranges.
5. **CLAIM_CONTRADICTION** (A.12.2, two-step): claim extraction ≤ 25 with spans, retrieval top 5
   per claim from other chapters, one comparison call per changed chapter, `relatedChapterId`.
6. **UNSUPPORTED_CLAIM** (A.12.3, Fast): heuristic pre-filter, batches of 40, chapter-role
   exemptions from the template.
7. **OUTLINE_DRIFT** (A.12.4): 150-word summary (Fast) + comparison; whole-chapter range.
8. **Sidebar UI (D.1.3).** Grouping, filters, jump with position remapping through versions,
   Resolve / Ignore / Suggest fix (→ scoped revision, cap `COMMAND`).

### B2 — Guide and committee cycle

**Read:** §5.7, D.2, A.13, A.14, §8 (`GuideShare`, `Comment`), §12.1.

1. **Share + guide role (D.2.1).** `GuideShare` creation and email; `/guide/:token` → OTP sign-in
   bound to the share email → `GUIDE` role scoped to that document; read-only editor with comment
   mode; revocation; a guide gets 404 on every other document, endpoint and AI action.
2. **Comments (D.2.2).** `commentAnchor` mark + `Comment` row with `quotedText`; chapter-level
   comments; re-anchoring on load (exact → whitespace-normalised → 0.85 similarity);
   pasted-feedback splitter and assignment UI.
3. **Classification** (A.13) on create; stored `class`; `needsHumanRewrite`.
4. **Scoped revision (A.14).** Target = anchored range → paragraph bounds ± 1; passages top 6;
   output replaces only the range; `[[NEEDS INPUT]]` handling; snapshot before apply; provenance
   `COMMAND`; cap `COMMAND` (`SCOPED_REVISION` action label). Substantive comments: button present,
   never bulk.
5. **Review queue (D.2.4).** Ordering, diff view, Accept / Edit / Reject (reason ≥ 10 chars),
   `j/k/a/e/r`, "Suggest for all mechanical" with cap preview, "Mark round complete" email,
   coherence re-run enqueue (`triggeredBy: FEEDBACK`, not cap-counted).
6. **Resolution log + export (D.2.5).** `.docx` table sorted by chapter with header fields.
7. **Notifications.** Guide digest (max 1/hour) when comments arrive from pasted-feedback
   attribution; student email when the guide comments.

### B3 — Institution templates, compliance, PDF, polish

**Read:** §5.8, D.3, C.7, §5.3 (FR-3.6), FR-9.7 (living gap map), §9.4.

1. **Template spec + seed (D.3.1).** Zod-validated `InstitutionTemplate.spec`; the human's
   `template.json` from C.7 seeded alongside `EXAMPLE_IN_UNIVERSITY`; an export banner when the
   example template is selected.
2. **Thesis details form.** `Document.meta` fields for the front matter.
3. **Export pipeline (D.3.2).** Front matter, styled body, heading/figure/table numbering,
   citeproc in the template style, TOC/LOF/LOT fields, appendices, Gotenberg PDF, last-5 retention.
4. **Compliance checklist (D.3.3).** All ten checks; blocks PDF (not docx) until fixed or
   overridden with a logged reason.
5. **Per-section outline regeneration (FR-3.6).** Sibling context; A.9 constrained to one node.
6. **Living gap map** (flag `livingGapMap`): recomputed on library change; a panel in Sources.

### B4 — Institution admin and hardening

**Read:** §5.9 (FR-9.6), §8 (`Institution`), §11.3 (`INSTITUTION_SEAT`), §7.5.

1. **Institution admin.** Create institution, invite students by email (seat count enforced),
   usage by student (no document content), invoice PDF per period, default template per
   institution.
2. **`.docx` comment import (FR-7.3).** Parse `word/comments.xml` + anchors → `Comment` rows via
   re-anchoring.
3. **Hardening.** `docs/RUNBOOK.md` (deploy, rollback, restore, rotate keys, scale the worker to a
   second VPS per §7.5 step 2); dependency audit; the load test and backup drill reruns are VPS
   items in `docs/PENDING.md`.

**Cut order if late:** living gap map → `.docx` comment import → per-section regeneration →
institution invoices (manual invoicing for the first institutions).

---

## VERIFY — after the build

One batch, not per task: run the full Vitest suite and Playwright suite, add the specs listed under
"Tests owed" in `docs/BUILD_LOG.md` (one per unit from W6 on: the Path A E2E, discovery, outline
tree, commands diff, chat, CSL golden strings for 5 styles, billing webhooks, coherence fixture,
guide cycle, compliance negatives), fix what fails, then run `pnpm pilot:report` once the pilot
students have used it and write `docs/PILOT-1.md` (numbers by the script, reading by the human).
The VPS items (deploy, k6, Sentry, Uptime Kuma, backup crons) stay in `docs/PENDING.md`.
