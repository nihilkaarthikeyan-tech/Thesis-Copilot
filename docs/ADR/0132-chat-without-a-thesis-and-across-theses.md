# 0132 — A research question with no thesis, and a chat across all theses

Date: 2026-10-09
Status: accepted (Jenni build plan R30/R32, the "(a)" item; the owner's scope addition of
2026-10-09: "All my theses" as a source next to the web search)
Follows: ADR-0060 (chat beyond the library, from search abstracts, through A.4), ADR-0074 (the
relevance floor and research steps), ADR-0116 (chat threads), ADR-0127 (theses beside, New ▾),
ADR-0128 (one thesis's chunks ranked exactly, never a global HNSW walk).

## Context

Jenni lets a student ask a research question before or outside any document, and a chat can
follow the student across documents. Ours lived inside a thesis: `ChatThread.documentId`, and
every passage came from that thesis's library (§10.6). R30 and R32 were left "partly done" with
both gaps written down as needing a decision. The owner decided on 2026-10-09: build the chat
with no thesis, and build the chat across theses into it.

## Decision

1. **Where.** "Ask a research question" on the thesis list (beside New ▾) and as the last item
   of New ▾ (so also in the editor's rail), opening `/app/ask`. The page lists past questions,
   starts a new one, and asks.
2. **Two sources, chosen under the box.**
   - **The literature** (default): ADR-0060's path unchanged — `WebScopeService.search` (no
     model), the abstracts as A.4's passages (`passagesFromWebResults`, `Sweb<n>#cabstract`),
     the existing `buildChatRequest` and `postProcessChat`. With no thesis there is no library,
     so every paper is "Not in your library". The setting "Search beyond my library" set to
     **off** refuses it (403, before the unit); "Ask first" is answered by the press itself.
   - **All my theses**: the question is embedded once (logged as `EMBED`), and each of the
     student's own theses — `ownerId` = the student, `archivedAt` null, with at least one read
     paper; at most 20, the most recently worked on — is ranked **exactly as ADR-0128 ranks one**:
     `findCandidates` with `perSource: CANDIDATE_PER_SOURCE` (the `ROW_NUMBER()` window per
     paper, fenced from the HNSW index). Each thesis's candidates are reranked (`rerank`), the
     lists merged by score, and A.4's top 8 kept (`topK(…, 'CHAT')`). Passage ids are numbered
     across the theses (`S<n>#c<m>`), so no two theses share one. **Every citation carries its
     thesis** (`thesis: { id, title }`); the page labels it "Rao 2022 · ‹thesis›", opens it in
     that thesis's reader, and the paper row says "In ‹thesis›". The setting does not apply (no
     search), and a student with no thesis holding a read paper is refused before the unit (400).
3. **No new prompt (rule 6).** Both sources use A.4 as it is. The memory block is A.0.1's own
   template rendered with nothing in it (`noThesisMemoryBlock`): no thesis to describe. The
   scripted replies that name "your library" are replaced in code, as ADR-0060 did
   (`BEYOND_NOT_ENOUGH_REPLY`; `ACROSS_NOT_ENOUGH_REPLY` across theses).
4. **The CHAT unit, as today.** One unit a question, taken by `UsageService.consume` — the one
   atomic check-and-increment — before any provider call (tested: the ledger already holds the
   unit when the model is called; at the cap the answer is 429 and neither the search nor the
   model runs). Refunded when the search has nothing with an abstract, when nothing is near the
   question, and when the search or the model fails (`ChatService.stream`, shared). The `AiCallLog`
   rows carry no `documentId`.
5. **The relevance floor and the off-topic refusal, as today.** `RELEVANCE_FLOOR` (0.30). Across
   theses it is `isOffTopic` on the passages' cosines, as a library question. From the
   literature, the question and the abstracts are embedded once and abstracts under the floor are
   dropped; when none is left the question is refused in the server's words
   (`NO_THESIS_OFF_TOPIC_REPLY`), for nothing. If that embedding fails the abstracts are kept, as
   ADR-0060's answer has always had them.
6. **Grounding.** `postProcessChat` whitelists exactly the passages sent; anything else is
   stripped and counted as `HALLUCINATED_CITE` (§10.6). Tested: an archived thesis's passage and
   another student's never reach the request.
7. **Storage: a new table, `ResearchChat`** (migration `0052_research_chats`: user, title,
   question count, turns as JSON, created, updated; `ON DELETE CASCADE` from `User`). Chosen over
   a nullable `ChatThread.documentId`: every `ChatThread` query reaches its owner through the
   thesis (`document: { ownerId }`), and a thread without one would need an owner column and a
   second ownership rule in every one of them. The new table leaves all of that untouched. The
   turn shape is `ChatThread`'s (`StoredTurn`), so the answer renderer is shared
   (`AnswerText`, exported from `ChatPanel`). A chat is a row once its first answer is stored; a
   refusal leaves nothing. Routes: `POST /research-chats/ask` (SSE; in the AI rate limit),
   `GET /research-chats`, `GET|PATCH|DELETE /research-chats/:id`. The student's own only; anything
   else is a 404.
8. **Nothing enters a thesis without a press.** "Add to a thesis…" under each cited paper sends
   that one paper to the thesis chosen, through the ordinary `/sources/resolve`. "Start a thesis
   from this" opens a dialog with the first question as the working title (editable, cut at a
   word under 300 characters) and the chat's cited papers ticked; Create makes the thesis as
   Start writing now does (`POST /documents`, `start: 'writing'`) and then resolves the ticked
   papers into its library.
9. **Erasure and admin.** `DeletionService.erase` deletes the student's `ResearchChat` rows (and
   the cascade covers a hard-deleted user). The admin user page shows how many research chats an
   account has — a count only: no new way to read a student's words (CLAUDE.md, ADR-0035).

## What it does not do

- It does not follow the student from thesis to thesis inside the editor's chat panel: the panel
  stays one thesis's (ADR-0116). The chat across theses is this page's "All my theses".
- It does not search the literature and the theses in one answer; the student picks one source a
  question.
- Its strings are English; the Hindi interface (ADR-0061) has the two entry labels only.

## Cost

The literature: one fast-tier A.4 call (8 abstracts at most, ADR-0060's 3,802-token worst case)
plus one embedding call over at most nine short texts. All my theses: one embedding of the
question, the exact rankings (no model), one A.4 call over 8 passages. Both inside
`ACTION_PROFILES.CHAT`; `docs/COSTING.md` is unchanged (₹0.0296 a question, the same caps).
