# 0086 — The claims map: a gap analysis over claims, beside the gap map over counts

Date: 2026-10-05
Status: accepted (agent, under ADR-0059; the partial list, round two)
Follows: row 63 of `docs/research/coverage-map.md`; ADR-0041 and ADR-0046 (the living gap map,
which reasons over counts and density); A.16 (`xpaper.md`, the cross-paper pass whose family
this joins).

## Context

Jenni's research gap analysis lists about fifteen claims the literature makes, each marked
under-explored, contested or well-supported, with supporting and contrasting citations, a
direction, and a note on the limits. Our gap map says which themes are thin and how dense the
field is, which is a different question. "Why is this open?" was left to the student.

## Decision

- **A new prompt, `claims.md`** (not an Appendix A section). One strong-tier structured call
  over the library's papers — up to thirty, each as its title, year and abstract or first
  passage, with the thesis's scope — returning up to fifteen claims: the claim in the model's
  words, a status, supporting and contrasting paper ids, a direction for the thesis, and what the
  evidence cannot say.
- **Grounding in code** (`postProcessClaims`): an id not sent is stripped and counted; a claim
  with no supporting paper is dropped; a status that is not one of the three is set from the
  evidence (any contrasting paper: contested; three or more supporting: well-supported; else
  under-explored); each claim once; fifteen at most.
- **Logged as `CROSS_PAPER`, not metered per unit.** It is one pass over several papers, as A.16
  is; the cost is bounded by thirty papers and by **once an hour per thesis** (a Redis key), and
  the ₹100 hard stop counts the row. About ₹0.30–0.45 a pass on `gpt-5-mini`.
- **Stored on `Document.meta.claims`** with the papers it was read from, and shown on the
  Sources page's Discover tab under the gap map: grouped under-explored first, each claim with
  "For", "Against", "A direction" and "Limits". Three readable papers are the minimum.
- **What it is not.** Not a source of thesis text: nothing on this screen enters a chapter. The
  claims are the model's reading of the abstracts, labelled as such, with the papers to check
  beside each.

## Tests

`packages/ai/test/claims.spec.ts` (request, rules, mock), `apps/api/test/claims-api.spec.ts`
(the map, ids whitelisted, stored and read, the CROSS_PAPER row and no unit, the cooldown, the
minimum, another student's thesis unseen).
