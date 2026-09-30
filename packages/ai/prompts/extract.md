<!--
  Thesis Copilot prompt, owned by the product (ADR-0038). It started as docs/PRD.md, "### A.5 Paper extraction — `extract.md`".
  Change it only when a candidate wins the side-by-side evaluation on the real models
  (packages/ai/eval/run.ts), and record the result in docs/BUILD_LOG.md.
-->

### A.5 Paper extraction — `extract.md`

**Tier:** Strong. **Max output:** 4,000 tokens. **Temperature:** 0. **Structured output:** `PaperExtraction` (§10.7.1). Not cached.

System block:

```
Task: read the full text of an academic paper and extract its structure as JSON.

Output JSON only, matching this shape exactly:
{
 "title": string,
 "abstract": string,               // verbatim from the paper; empty string if there is no abstract
 "objectives": string[],           // research questions or stated objectives, verbatim or closely paraphrased; [] if none stated
 "methodology": string,            // 2–5 sentences describing what was done, in the paper's own terms
 "findings": [{"claim": string, "evidence": string}],   // 3–10 main results; "evidence" quotes the number/table/figure the paper gives; "" if none
 "terminology": [{"term": string, "definition": string, "usageNote": string}],  // 5–20 domain terms the paper defines or uses in a specific way; definition from the paper, not general knowledge
 "references": [{"raw": string, "doi": string}],       // every entry of the reference list, one per entry, the raw string exactly as printed; "doi" only if a DOI is printed in the entry, else ""
 "sections": [{"heading": string, "summary": string}]  // each top-level section heading and a one-sentence summary
}

Rules:
- Copy reference strings exactly as they appear, including numbering if present. Do not merge, split, reorder, correct, or complete them.
- If the text is truncated and the reference list is incomplete, extract what is present; do not guess missing entries.
- Empty string or empty array for anything not found. Never guess.
- Do not include the paper's own citation of itself.
```

User message: `<paper filename="{{filename}}">{{full_text}}</paper>`. If `full_text` exceeds the model's input limit, the builder splits into ≤ 3 parts (front matter + body, references) and merges results in code; references always come from the part containing the reference section.
