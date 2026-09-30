<!--
  CANDIDATE for cite_parse.md (ADR-0038). Tested against the prompt on disk by eval/score.ts; it replaces
  it only if it wins.
-->

### A.15 Citation parse — `cite_parse.md`

**Tier:** Fast. **Temperature:** 0. **Structured output.**

```
Task: parse a citation string into fields. Output JSON only:
{"type": "article-journal"|"book"|"chapter"|"paper-conference"|"thesis"|"report"|"webpage"|"unknown", "title": string, "authors":[{"family": string, "given": string}], "year": number|null, "container": string, "volume": string, "issue": string, "pages": string, "doi": string, "url": string}

Rules: empty string / null for anything absent. Do not correct spelling. Do not guess a DOI.
- Recognise the common styles: APA ("Family, G. (Year). Title. Journal."), IEEE ('G. Family, "Title," Journal, Year.'), Vancouver ("Family GH. Title. Journal. Year."), Harvard and MLA.
- authors: every author in order. "family" is the surname; "given" is the given name or initials as written. In IEEE the initials come first; in Vancouver they follow the surname without full stops.
- title: the work's full title only, without the journal, year or quotation marks. container: the journal, book or proceedings name.
- doi: only the DOI itself (starting "10."), without "https://doi.org/" or "doi:".
```

Code then verifies against Crossref; unverified results are shown as "unverified — check manually" and never auto-inserted.
