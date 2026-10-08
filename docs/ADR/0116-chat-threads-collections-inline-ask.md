# 0116 — Chat threads, a chat on one collection, and web search asked in the chat

Date: 2026-10-08
Status: accepted (Jenni build plan Round 2, R30; inventory §8, §11, §13.5; Round 1 left "chat by
collection" undone)
Follows: ADR-0016 (chat scopes), ADR-0060 (chat beyond the library, "Ask first"), ADR-0074
(research when the library is thin), ADR-0080 (deep research), ADR-0081 ("On" searches on every
question), ADR-0083 (attachments), ADR-0105 and the 2026-10-04 collections.

## Context

Jenni keeps a history of chat threads, starts a new one, and lets a thread follow the student
from document to document. Its "+ Add context" takes a collection. With web search on "Ask" it
asks in the conversation: "Search the web?" — Skip, Always allow, Allow this time.

Ours had one conversation per thesis, on `Document.meta.chat`, and kept only its last four
exchanges (all A.4 sends the model). Searching beyond the library was a single button under a
refused question ("Search beyond your library for this?") or the Settings switch. A collection
could not be asked on its own.

## Decision

1. **Any number of chats per thesis: a `ChatThread` table** (migration `0045_chat_threads`:
   thesis, title, collection, the collection's name, a question count, the turns as JSON,
   created, updated). The migration made each thesis's existing conversation its first thread,
   turn for turn — ids, citations and thumbs included — and only then removed `chat` from
   `Document.meta`; an empty conversation became no thread. A thread is titled by its first
   question (80 characters; the service cuts at a word). It keeps the last 60 turns, thirty
   questions, so a reopened chat reads back; A.4 still sends the model only the last four
   (`CHAT.keepTurns`, applied by the builders, unchanged).
2. **The panel.** A bar above the chat: **Chats** (the thesis's chats, the one used last first,
   each with when, how many questions and its collection; open one, or delete it after a confirm
   on its row), the open chat's title, and **New**. A new chat is not a row until its first answer
   is stored, so a refused or abandoned one leaves nothing in the list. The panel remembers the
   open chat for the browser tab (`sessionStorage`), because it is rebuilt each time the Chat tab
   opens; without that, leaving the tab put the student back in the chat used last.
   A thumbs on an answer does not move its chat up the list.
3. **The API.** `POST /chat` takes `threadId`, or `newThread` (with `collectionId` to start on a
   collection), and answers with `threadId` in `done`. A question that names no chat continues the
   thesis's latest whole-library chat — what "the chat" was before — so an old tab open during a
   release, and every existing test, keep working. `GET /chat/:documentId?threadId=` (else the one
   used last), `GET /chat/:documentId/threads`, `DELETE /chat/:documentId/threads/:threadId`;
   rating and clear take an optional `threadId`. Owner only, 404 for anything else.
4. **A chat on one collection** is chosen as it starts: New ▸ a collection (an empty one is shown
   and disabled). Retrieval searches only the collection's papers — the same `sourceIds` path `@`
   uses (`ContextService.retrieve` applies ADR-0087's found-only rule only when no `sourceIds` are
   passed, and chat has always passed them) — and `@` names only papers in it. It **never reaches past the collection**: no research
   top-up (ADR-0074), no "Ask first" offer, no "On" search (ADR-0081), and the deep research
   switch is not offered (the server treats `deep` there as an ordinary question). Refused before
   the unit is taken, as JSON that costs nothing: another scope (`document`, `beyond`), an empty
   collection, an `@` paper outside it. Its two refusals name the collection
   (`collectionOffTopicReply`, `collectionEmptyReply`, in the API, not the prompt). A chat whose
   collection is deleted keeps its conversation and the name it started with
   (`ON DELETE SET NULL` plus `collectionName`): it can be read, and asking in it is a 409 that
   says to start a new chat, rather than quietly answering from the whole library.
5. **Web search asked in the conversation.** The "Ask first" offer under a library question the
   relevance floor refused is now Jenni's three choices. **Allow this time** sends the same
   question beyond the library (ADR-0060, unchanged). **Always allow** first saves
   `searchBeyondLibrary: 'on'` where the setting has always lived (`User.settings`, the Settings
   page shows it), then searches, and says under the answer what On means — every library
   question also searches the literature (ADR-0081) — with a link to change it. **Skip** leaves
   the refusal: nothing searched, nothing charged. The thin-library top-up under "Ask first"
   (ADR-0074) still runs without asking, as that ADR decided: it rides on a library answer the
   student is already getting, and every search is shown as a step.

## What stays as it was

- **Grounding** (§10.6): the same request builders, the same `postProcessChat` whitelist and
  `HALLUCINATED_CITE` count. A collection only narrows what is retrieved into the request.
- **No new prompt and no prompt change.** The refusals for a collection are server text beside
  A.4's own scripted replies, as `BEYOND_NOT_ENOUGH_REPLY` is.
- **Cost:** one CHAT unit a question, taken in the one atomic statement before any provider call,
  refunded where it was refunded before (the relevance floor, an empty search, a failed answer).
  Every refusal added here comes before the unit. No new action, allowance or model call;
  `docs/COSTING.md` is unchanged. Storage: one JSON row per chat, at most 60 turns.
- **A copy of a thesis** (ADR-0057) does not copy its chats; until now the one chat rode along
  inside `meta`. Chats are the original's history, like comments and version history.
  `DocumentEraser` removes them with the thesis.

## Not done, and why

- **A chat across theses, and a chat with no thesis** (Jenni's thread that follows the student,
  and New ▸ AI chat). Both need more than this item: a chat with no thesis has no library to be
  grounded in, so it could only answer from search abstracts, and every piece of the chat path
  (the memory block, attachments, the call log, the usage row's thesis) is keyed to a thesis; a
  thread that follows the student would carry one thesis's answers into another's request. Done
  safely it needs a thread owned by the student rather than the thesis, grounding that switches
  with the open thesis, and the New menu — so it goes with R32 ("one New menu").
- Renaming a chat, and searching the list. The title is the first question; the list holds 100.
- A paper named from the reader (ADR-0068's handoff) while a chat on a collection is open, and the
  paper is not in that collection, is refused by the server in plain words; the panel does not
  switch chats for the student.
- The new strings are in English and partly in Hindi (the agent's translation, as ADR-0061's).

## Evidence

- `apps/api/test/chat-threads-api.spec.ts` (14, Testcontainers): no chat until the first answer;
  a question with no chat named continues the last whole-library chat; New, reopen, the order;
  thumbs in a named chat and found by id, the order kept; another thesis's chat 404, a bad id 400,
  `threadId` with `newThread` 400, all without a unit; delete; a chat on a collection cites only
  its paper (1 passage against 2 on the whole library) for one CHAT unit and never searches, even
  under "On"; continues on it; `deep` is ordinary there; the five refusals before a unit; its
  off-topic refusal in its own words, free, no offer; the whole-library offer unchanged and a
  refused new chat not stored; a deleted collection: readable, named, asking 409.
- `apps/api/test/chat-threads-migration.spec.ts` (3, Testcontainers): the migrations before 0045,
  three theses written the old way, then 0045 — the conversation is the thread word for word
  (title, count, UUID v7), `meta` keeps its other keys, an empty or absent chat makes no thread.
- `apps/api/test/chat-threads.spec.ts` (8), `chat-rating.spec.ts` (3, now on the thread),
  `apps/web/test/chat-threads.spec.ts` (8).
- `apps/web/e2e/chat-threads.spec.ts` (written, not run here): the list, reopen, New ▸ a
  collection with the request body, the title after the first answer, the chat kept across tabs,
  delete; Allow this time / Always allow (the real Settings API reads "on") / Skip; the list, the
  New menu and the ask at 390 px measured with `measureLayout`. `chat-beyond.spec.ts` updated to
  the three buttons.
- `prisma migrate diff` against a database migrated from the files (the CI check,
  `packages/db/scripts/migrate-diff-check.mjs`): migrations and schema agree.
