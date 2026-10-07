# 0108 — The cited passage, open beside the chapter

Date: 2026-10-07
Status: accepted (Jenni build plan Round 2, R21; inventory §5)

## Context

Jenni opens a citation's quote beside the writing with the passage marked. Ours opened the PDF
beside the chapter at the passage's page (ADR-0068's pdf.js view) — the reader page could mark a
passage (`?chunk=`), the pane could not, so the student still had to find the sentence on the page.

## Decision

- The citation hover card's **Read beside** now sends the passage's text with its page
  (`ReadBesideTarget.quote`, `@tc/ui` `readBeside`). The pane, once its PDF is ready, finds the
  passage's opening words from that page on and marks them — eight words, then four (the PDF's text
  and the extracted text differ by ligatures and line-end hyphens), then the page alone — the
  reader page's own steps.
- Found in the browser: marking from inside the view's "ready" callback called a controller from
  before the document loaded, whose search saw no pages, so nothing was ever marked. The pane marks
  from an effect once "ready" is in state, as the reader page does.

## Evidence

Browser, real stack: Gadekar 2026's cited passage (page 2) opened beside the chapter with "INTRODUCTION
Rapid urbanization has profoundly transformed local temperatures," marked, 5.5 s after asking (most
of it the PDF loading). The same passage marks on the reader page by `?chunk=`.
