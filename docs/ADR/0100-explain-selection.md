# 0100 — Explain selection: a box on a PDF page, asked about in chat

Date: 2026-10-07
Status: accepted (Jenni build plan Round 2, R13; inventory §13.2)

## Context

Jenni's reader has **Explain selection**: draw a box on the page, and AI Chat opens with the box
as a picture attached, the paper as a chip, and questions for that paper. A figure, a table or an
equation is exactly what text selection cannot take. Ours could select text and ask about it, and
chat has taken pictures since ADR-0083, but nothing joined the two.

## Decision

- **The reader** (`PaperReader.tsx`, `PdfView.tsx`): an **Explain selection** button over the PDF;
  in box mode a drag on a page draws a box (Esc leaves). On release the box is cut from the page's
  own canvas at its drawn resolution (so small print stays legible), uploaded as a chat attachment
  (`POST /chat/attachments`, ADR-0083's limits and storage), and handed to the chapter as the
  existing "ask" hand-off, now with the picture and the questions.
- **The chat** (`ChatPanel.tsx`): the picture arrives on the next question, the paper as its
  mention (answers come from it only, as for a text passage — ADR-0068), and the questions as
  chips; pressing one puts it in the box.
- **The questions are written in code**, not by a model: "Explain what this part of the page
  shows", how it supports the paper's main finding, the paper's limitations, a five-sentence
  summary — each naming the paper (`boxQuestions`). Jenni's are model-written; a model call to
  write four questions would cost a unit for what fixed wording does.
- No new allowance: the question is a chat question (CHAT), the picture an attachment.

## Evidence

`apps/web/test/reader.spec.ts` (the questions). Browser, real stack: box drawn on page 1 of Gadekar
2026 → the chapter opened on Chat with "Gadekar 2026 p1.png" attached and the four questions;
"Explain what this part of the page shows" answered about exactly what the box covered (the
article header and licence, the abstract's aims and findings), cited, answering only from that
paper. Two faults found on the way: four pointer events in one tick left the release reading the
box from before the last render (the box is now kept in a ref too), and `setPointerCapture` can
throw for a pointer the browser no longer tracks (now caught).
