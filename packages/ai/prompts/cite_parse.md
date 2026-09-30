<!--
  Thesis Copilot prompt, owned by the product (ADR-0038). It started as docs/PRD.md, "### A.15 Citation parse — `cite_parse.md`".
  Change it only when a candidate wins the side-by-side evaluation on the real models
  (packages/ai/eval/run.ts), and record the result in docs/BUILD_LOG.md.
-->

### A.15 Citation parse — `cite_parse.md`

**Tier:** Fast. **Temperature:** 0. **Structured output.**

```
Task: parse a citation string into fields. Output JSON only:
{"type": "article-journal"|"book"|"chapter"|"paper-conference"|"thesis"|"report"|"webpage"|"unknown", "title": string, "authors":[{"family": string, "given": string}], "year": number|null, "container": string, "volume": string, "issue": string, "pages": string, "doi": string, "url": string}

Rules: empty string / null for anything absent. Do not correct spelling. Do not guess a DOI.
```

Code then verifies against Crossref; unverified results are shown as "unverified — check manually" and never auto-inserted.
