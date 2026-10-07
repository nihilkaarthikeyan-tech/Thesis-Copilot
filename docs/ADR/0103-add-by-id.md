# 0103 — Add a paper by its identifier

Date: 2026-10-07
Status: accepted (Jenni build plan Round 2, R16; inventory §4, §12 E)

## Context

Jenni's Upload Sources has **Paste ID**: a DOI, PubMed id, arXiv id or ISBN, "Metadata found"
(title, authors, journal), then Import. Ours took pasted references as text, files, Zotero and
PDFs, and a DOI only as the fix for an unresolved reference.

## Decision

- `detectPaperId` (`@tc/retrieval`): the forms people copy — `10.…`, `doi:…`, doi.org links,
  `arXiv:2410.08098v2`, arxiv.org links, old-style arXiv ids, `PMID …`, pubmed links, ISBN-10/13
  (check digit verified). An arXiv DOI is an arXiv id.
- `GET /documents/:id/sources/lookup-id?q=` (free): Crossref by DOI, arXiv by id, PubMed by id
  (`byPmid`, new) or Open Library by ISBN (`OpenLibraryClient`, new; its fields checked against a
  real answer first), each within 15 s, as a preview. Something that is none of them is refused
  with examples.
- `POST /documents/:id/sources/import-id` (free) reads the record again on the server:
  - with a DOI (DOI, arXiv, most PubMed) it goes down the reference pipeline like any pasted
    reference, with its DOI — resolved, abstract and open copy found, indexed; a DOI already in the
    library is found, not added twice;
  - without one (a book by ISBN, a PubMed record without a DOI) it is created from the record — a
    book with its publisher and ISBN, PubMed's names read as "Surname Initials" — and an abstract,
    if there is one, indexed.
- The library's **Paste an ID** opens the box beside the other ways in; the preview, then **Add to
  library** or **Reset**. A book is told it has no abstract to read.

## Evidence

`packages/retrieval/test/paper-ids.spec.ts` (15: every form, wrong check digits, Open Library's
answer), `apps/api/test/paper-id.spec.ts` (3) and `paper-id-names.spec.ts`. Real services: a DOI
(Yu 2020), arXiv 1706.03762, PMID 31452104 and ISBN 978-0-262-03384-8 each previewed; the ISBN
imported as a book; the DOI already in the library said so; the arXiv paper imported, resolved and
read in full from its PDF within 25 s. Found on the way: PubMed's "Bitencourt-Ferreira G" read as a
display name made the initial the surname. The test papers were removed afterwards.
