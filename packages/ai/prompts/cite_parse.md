<!--
  VERBATIM COPY OF PRD APPENDIX A — DO NOT EDIT BY HAND.

  PRD §0.3 rule 11: prompts are content, not code. If this prompt performs badly, record
  examples of the bad output in docs/BUILD_LOG.md and propose a change for the human to
  approve. Do not rewrite it here.

  Source: docs/PRD.md, "### A.15 Citation parse — `cite_parse.md`"
  Regenerate: pnpm --filter @tc/ai run prompts:extract
-->

### A.15 Citation parse — `cite_parse.md`

**Tier:** Fast. **Temperature:** 0. **Structured output.**

```
Task: parse a citation string into fields. Output JSON only:
{"type": "article-journal"|"book"|"chapter"|"paper-conference"|"thesis"|"report"|"webpage"|"unknown", "title": string, "authors":[{"family": string, "given": string}], "year": number|null, "container": string, "volume": string, "issue": string, "pages": string, "doi": string, "url": string}

Rules: empty string / null for anything absent. Do not correct spelling. Do not guess a DOI.
```

Code then verifies against Crossref; unverified results are shown as "unverified — check manually" and never auto-inserted.
