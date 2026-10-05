# 0083 — Attachments and pictures in chat

Date: 2026-10-05
Status: accepted (agent, under ADR-0059; the partial list, round two)
Follows: row 42 of `docs/research/coverage-map.md` (MISSING); ADR-0064 (the first image input,
an equation from a photo); ADR-0060 (citations that are not sources).

## Context

Jenni's chat takes a file or a picture with the question. Ours took text only. A student has a
figure, a table photographed from a paper, a page of field notes, a supervisor's PDF of comments —
things to ask about once, not to add to the library.

## Decision

- **`POST /chat/attachments?documentId=`** (multipart, one file; the same registration every
  upload uses) takes a picture (PNG, JPEG, GIF, ≤ 5 MB — the three formats the figure upload
  accepts, sniffed, never trusted by extension) or a document (PDF, Word, or plain text, ≤ 15 MB).
  A picture is kept in object storage under `chat-attachments/<documentId>/`; a document is read
  at once (`extractPdf`, `extractDocx`, or the bytes as text) and cut to 12,000 characters at a
  sentence end. The record lives in Redis for two hours, keyed to the student and the thesis.
  Three per question.
- **The question carries `attachmentIds`.** They are loaded before any unit is taken: a stale,
  foreign or other-thesis id is a 400 that costs nothing. A picture goes to the model as an
  image part of the user turn (`Message.images`, ADR-0064's shape; the strong tier reads it).
  A document goes as one more passage, `Satt<n>#c1`, labelled "Attached: <name>".
- **Grounding is A.4's.** The answer may cite the attachment like any passage; its citation
  carries `attachment: { name }`, an empty `sourceId`, and the panel shows it as a dashed chip
  that opens nothing — it is not a source and cannot become a thesis citation. "Add to
  document" is hidden on an answer that cites one, as it is for a found paper. Nothing joins the
  library.
- **A question with an attachment is about the attachment**: the library's silence on it is not
  the off-topic refusal. Deep research takes attachments too.
- **No prompt change.** A.4 already says the passages are "most" from the library; an attached
  document is a passage with a telling label. Images are not mentioned in the prompt; the model
  sees them with the question. One real run is in the build log; a prompt line for attachments
  joins the next A.4 round if the answers show they need one.

## Cost

Inside the CHAT (or RESEARCH) unit. A document adds up to ~3,000 input tokens (≤ ₹0.07 on
`gpt-5-mini`); a picture ~1,000–1,500 (≤ ₹0.03). Storage: pictures only, small, and a nightly
cleanup is not written — they are listed under their prefix for the admin's storage totals, and
the Redis record expires; a sweep of `chat-attachments/` older than a day belongs to the backup
container's housekeeping when it is next touched (`docs/PENDING.md`).

## Tests

`apps/api/test/chat-attachments-api.spec.ts` (Testcontainers with MinIO: a text file as a cited
passage, a picture as an image part, the refusals), `apps/web/e2e/chat-attachments.spec.ts`.
