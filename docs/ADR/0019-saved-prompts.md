# ADR-0019 — saved prompts: a `SavedPrompt` table, used in chat with `/`

**Date:** 2026-09-24
**Status:** Accepted
**Extends:** FR-4.9 (chat over the library). Adds a table beyond PRD §8, as ADR-0004 did.

## What prompted it

A competitor's chat box reads "Ask AI, use @ to mention PDFs or / for prompts". A student asks
the same few questions of every new batch of papers — *what are the limitations*, *how do these
methods differ*, *what population was studied* — and retypes them each time.

## The decision

- **A saved prompt is the student's own text, and only ever fills the chat box.** Choosing one
  puts it where a typed question would be; the student can change it, and sends it with Ask. It
  reaches `/chat` as an ordinary message, so grounding (§10.6), the relevance floor, the refusals
  and the cap all apply to it unchanged. It is not a system prompt and changes nothing in
  `packages/ai/prompts/` — rule 11 of §0.3 is untouched.
- **A table, `SavedPrompt { id, userId, title, body, createdAt, updatedAt }`**, not a key in
  `User.settings` (ADR-0006). Settings are preferences read whole; these are content edited one at
  a time, and a JSON array rewritten whole loses a prompt whenever two tabs save.
- **Per student, not per thesis.** The questions a student reuses travel between theses.
- **Bounds:** a name of 80 characters, a body of 2,000 — the chat message limit, since it has to
  fit the box it is sent from — and 50 prompts per student. The count is a tidiness bound, not a
  cost one: saving costs nothing, and using one is metered as the chat it becomes.
- **Erased with the account** (§12.2): `DeletionService` deletes the rows with the rest of the
  student's content.

## Rejected

- **Sending a saved prompt straight to the model on selection.** One click would spend a unit on
  text the student has not reread, and a prompt saved in one thesis may not fit the next.
- **Shipping a set of starter prompts.** They would be our words presented as the student's
  shortcut; the empty state explains how to save one instead.
- **Saved prompts in Assist's guided instruction (Shift+→).** Possible later with the same table;
  chat is where the competitor has them and where students ask repeatable questions.

## Consequences

- Migration `0016_saved_prompt`. `/prompts` has GET, POST, PATCH and DELETE, all scoped by the
  session's user. Someone else's prompt is a 404, never a 403 (§12.1).
- The chat box gains keyboard control of both pickers (`@` and `/`): the arrow keys move, Enter
  picks, Escape closes. Enter never sends a `/query` as a question.
