# 0070 — A first session without a queue

Date: 2026-10-05
Status: accepted
Follows: ADR-0037 (automatic sources), ADR-0062 (Start writing now).

## Context

Feedback from the owner's manager: with Jenni a new writer goes straight to the page and is moved
on step by step; with Thesis Copilot they "get stuck in a queue". Measured on the real models
(`apps/web/e2e/_measure/first-session.spec.ts`, run with `MEASURE=1`), a new student's first
**cited** suggestion came:

- 78.8 s after Create thesis (46 s after reaching the editor) on the proposal path;
- 47.9 s after Start writing now.

Every press of Suggest in between returned nothing and said nothing.

The causes:
1. Papers were searched only when the student first asked for a suggestion in the editor.
2. A paper became citable only after its open-access copy had been hunted for. That means three
   services, each with its own time limit.
3. With an empty library, A.1 can only answer `[[NEEDS SOURCE]]`. Each press spent a model call
   to say nothing.
4. The editor gave no sign that anything was happening.
5. Nothing told a new student what to do next.

## Decision

1. **Writing comes first.** On the thesis list and on `/app/new`, "Start writing now" is the
   filled button and Enter submits it. The proposal is the second button ("Create thesis with a
   proposal"), and the guide below offers it again.
2. **The search starts when the thesis is created.**
   - `POST /documents` starts the ADR-0037 search on Chapter 1, with the title as the query. The
     usual checks apply: the site flag, the student's setting and the monthly cap.
   - A placeholder title ("Untitled thesis", or fewer than three real words) starts nothing.
   - This search is waited on, so its index budget is shorter: 8 s per call and 12 s per index.
     The student-run search keeps ADR-0050's budget.
3. **Abstract first.**
   - `index-source` embeds the abstract at once when the paper has nothing stored yet, then looks
     for the full text, which replaces it.
   - "Nothing stored" means no chunks. `resolve-reference` already shows the ABSTRACT badge as soon
     as it finds an abstract, before anything is embedded. The first build tested the badge, so
     the step never ran. Measuring caught this.
   - Cost: one abstract embedded a second time, about 300 tokens.
4. **The editor says what is happening while the library fills.**
   - When retrieval finds nothing while a search runs or papers are being read, Assist still asks
     the model, which may write a sentence that needs no source, and marks the answer
     `papersLoading`.
     - If the model wrote something, the editor shows it with "cites nothing yet; citations will
       follow".
     - If it wrote nothing, the unit is refunded as before. The editor says the papers are still
       being read, and asks again by itself when the first one is citable. If a suggestion is
       still in flight, it retries for a few seconds.
   - A line above the page shows progress, drawn from counts only through
     `GET /documents/:id/sources/progress`:
     - "Finding papers on your topic…"
     - "Found 5 papers · reading 3…"
     - "5 papers ready".
   - A first version skipped the model call altogether while the library was empty. The browser
     specs and an earlier real-model run showed that this took away the uncited sentence the model
     sometimes writes, which is the "suggestion straight away" this work set out to give.

5. **A next-step guide** sits above the page: Write → Take a suggestion → See your papers → Plan
   your chapters. The current step is highlighted with its one action, and each step ticks itself
   off from what the student does. It is hidden with "Hide" and disappears when all four are done.
   The first-run hint stays below it, with the walkthrough link. No model call is involved.

"Ready" in the progress line also means "has chunks", for the same reason as in item 3.

## Result

Same harness, real models, two runs each:

| | before | after |
|---|---|---|
| Start writing now → first cited suggestion | 47.9 s | 13.7 s, 14.2 s |
| Proposal path → first cited suggestion | 78.8 s (46 s in the editor) | 21.9 s, 19.4 s (3–5 s in the editor) |

## Not changed

- The outline is still built from the proposal in the background. The chapter rail can say
  "Building your chapters…" for a minute or more. That is separate work.
- No new prompt and no new metered action. The paper search was already metered (ADR-0037).

## Tests

- **Worker:**
  - the abstract is stored before Unpaywall is asked;
  - it is not embedded twice when no full text is found;
  - a paper that already has chunks is left alone.
- **API (testcontainers):**
  - a suggestion on an empty library that is being filled is marked `papersLoading`;
  - a real title starts the search when the thesis is created, and `/sources/progress` reports it;
  - a placeholder title starts nothing.
