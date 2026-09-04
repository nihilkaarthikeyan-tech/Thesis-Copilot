# Paper fixtures — human task

**Owner:** the human, not the agent. **Deadline:** before Phase 1 week 2 (PHASES `PHASE-1-W2`).
**Spec:** PRD Appendix C.1. The agent must never fabricate these files or their expected results
(PRD §0.3 rule 3).

Extraction accuracy (Appendix C.3) is measured against these five papers. Until they exist, the
week-2 Definition of Done is logged as `BLOCKED: fixture missing — fixtures/papers/pNN.pdf`.

## What to collect

Five open-access papers in the pilot field (default: engineering / computer science), named
`p01.pdf` … `p05.pdf`, plus `p05.docx` (the same paper as an author manuscript).

## Selection rules — tick each when the set as a whole satisfies it

| # | Requirement | Why | Met? |
|---|---|---|---|
| 1 | All five are PDF, English, with a proper reference list of 15–40 entries | Extraction and resolution metrics need real reference lists | ☐ |
| 2 | At least two use numeric (IEEE-style) references and at least two use author–year | Both styles must parse | ☐ |
| 3 | At least one is two-column layout | Column-order extraction is the common failure | ☐ |
| 4 | At least one contains equations and at least one contains tables | Text extraction must not choke | ☐ |
| 5 | One of the five is also available as `.docx` (an author manuscript) | Tests the DOCX path | ☐ |
| 6 | Preferably 2–3 are the pilot students' own published papers (with their consent) | Path B is built for exactly this | ☐ |
| 7 | All have a DOI | Needed for resolution ground truth | ☐ |

## Record each paper here

| File | Title | DOI | OpenAlex ID | Layout (1/2-col) | Reference style | Refs (count) | Equations | Tables | Provenance |
|---|---|---|---|---|---|---|---|---|---|
| `p01.pdf` | | | | | | | | | |
| `p02.pdf` | | | | | | | | | |
| `p03.pdf` | | | | | | | | | |
| `p04.pdf` | | | | | | | | | |
| `p05.pdf` | | | | | | | | | |
| `p05.docx` | (same paper as p05) | | | — | — | — | — | — | author manuscript |

"Provenance" is `student` (with consent) or `OpenAlex`.

## If students cannot supply papers

Use OpenAlex with the filter from Appendix C.1:

```
is_oa:true, type:article, publication_year:2019-2024,
open_access.oa_status:gold, <concept/topic in the pilot field>
sort: cited_by_count:desc
```

Download from `best_oa_location.pdf_url`, then record the OpenAlex ID and DOI in the table above.

## Expected extraction (Appendix C.2) — the three-step rule

1. **Agent** runs extraction once per paper and writes `pNN.expected.draft.json`.
2. **Human** opens the PDF beside the draft and corrects: `title` (exact), `abstract` (exact), and
   the count and text of `references` (add missed entries verbatim, fix merged or split ones), and
   marks each reference's `doi` where printed. Objectives, methodology, findings and terminology are
   reviewed for obvious errors but are **not** scored.
3. **Human** renames the corrected file to `pNN.expected.json` and commits it.

The agent never creates or edits `*.expected.json`.
