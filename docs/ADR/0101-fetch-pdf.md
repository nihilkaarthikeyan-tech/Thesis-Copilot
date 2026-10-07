# 0101 — Fetch PDF

Date: 2026-10-07
Status: accepted (Jenni build plan Round 2, R14; inventory §4, §13.2)

## Context

Jenni fetches a missing PDF in one click and shows how many papers have none. Ours looked for an
open-access copy once, when a paper was added (`index-source`: arXiv, every copy Unpaywall lists,
CORE, then Europe PMC's full text), and a paper that came back abstract-only stayed so — the
library offered only "Add the PDF", and said why in general terms.

## Decision

- `POST /documents/:id/sources/fetch-pdfs` (free): queues `index-source` again for each paper of
  the thesis with a DOI and no file (all of them, or the ones named), up to 60 a press. The job id
  carries the minute: a second press in the same minute adds nothing, a later one is a real retry
  (CLAUDE.md's rule — key a job on what it reads; here, the outside world at that moment). Papers
  without a DOI are counted and the student is told to add those PDFs. Embedding a found full text
  is metered as any indexing is (EMBED, the site budget check).
- The library: a banner — "N papers have no PDF, so only their abstracts can be quoted. **Fetch
  open-access copies**" — and **Fetch PDF** on each such paper in the "Without full text" view; the
  list keeps refreshing for four minutes after a press.
- `Source.fullTextNote` (migration 0041): what the last try found, in the library's words, cleared
  once a full text is read; the per-paper reason now starts with it and ends "If you have the
  paper, add its PDF."
- **Not done: getting past a publisher that refuses automated downloads.** Nature answers its own
  open-access PDFs to curl but sends Node's request to a sign-in hop and answers 406 to one that
  names itself; Wiley and ESS Open Archive answer 403. Passing ourselves off as a browser or as curl
  would be dodging the publisher's rule, so the student is told and can add the PDF.

## Evidence

`apps/api/test/fetch-pdfs.spec.ts` (2): only DOI'd papers without a file queued, the rest left or
counted; the same minute gives the same job ids, none containing ":"; one paper alone; another
student's thesis not found. `library-hygiene.spec.ts`: the reason with the note.

Browser, real stack: 7 papers without a PDF; one press queued all 7; the one in Europe PMC was read
in full (35 passages); the other six now say why — "The open-access link led to a page rather than
a PDF" (two Nature papers: the publisher's bot check), "did not work" (Wiley, 403), "No open-access
copy was listed" (two) — each with its own Fetch PDF.
