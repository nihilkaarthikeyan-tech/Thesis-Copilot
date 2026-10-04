# ADR-0054 — Full text from Europe PMC when the publisher's PDF cannot be fetched

**Status:** accepted · **Date:** 2026-10-04 · **Changes:** FR-2.2's full-text chain (Unpaywall →
CORE) gains a third, keyless step.

## Context

Side by side with Jenni (2026-10-04, `docs/JENNI-FINDINGS.md`), the same gold open-access paper
(*Discover Food*, Springer) reached FULL_TEXT in Jenni in about 40 s and stayed ABSTRACT in ours.
Chat then could not answer from its Table 1. The cause: Unpaywall lists only Springer's PDF URL,
and Springer answers a server with a cookie redirect and then a JavaScript bot check (Fastly
`_fs-ch`). Carrying the cookie is now done (`fetchFollowingCookies`), but the bot check is not
something we may get past: that would be detection evasion.

## Decision

- After every open-access PDF has failed, the index job asks **Europe PMC**. A DOI search finds the
  PMC id; an exact DOI match, `isOpenAccess: Y` and `inEPMC: Y` are required. `/fullTextXML`
  returns the article as JATS. Both responses were read live first (§0.3 rule 1) and are recorded
  as fixtures.
- `jatsToText` turns the body into text with one span per top-level section, keeping **tables
  row by row** (cells joined with " | ") and figure captions. References, graphics and
  supplementary files are dropped. Maths keeps its MathML text.
- The result is FULL_TEXT, `from: 'open-access-xml'`, `via: 'europepmc'`. No file is stored,
  because none was downloaded. A re-index asks again.
- Keyless and two requests a second at most; a failure falls back to the abstract as before.

## Consequences

- Live (dev stack, real models): a Springer review in PMC was FULL_TEXT 10 s after adding it by
  DOI. Chat answered a question from its Table 3 with both figures cited, in 1.8 s.
- Covers the life sciences and anything else deposited in PMC. It does **not** cover the
  *Discover Food* paper of the comparison, which is not in PMC. For Springer Nature's own gold
  open access, the Springer Nature Open Access API (free key, JATS) is the sanctioned route. It is
  not built, because its contract cannot be read without a key (`docs/PENDING.md`).
- A source grounded this way has no "Open PDF" link.
