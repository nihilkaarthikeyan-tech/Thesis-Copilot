# 0089 — Refine presets for citations, novelty and plain language

Date: 2026-10-07
Status: accepted (owner, 2026-10-07 — Jenni build plan Round 2, R3)

## Context

Jenni's "Refine suggestion" menu has three groups: Write (stay on topic, complete this paragraph),
Refine (increase novelty, simplify language) and Citations (re-write without citations, validate
supporting evidence, cite from my library) — `docs/JENNI-FULL-INVENTORY.md` §10, §13.3. Round 1 of
`docs/JENNI-BUILD-PLAN.md` marked the citation presets done on 2026-10-04; the code check of
2026-10-07 found they had never been added (`SuggestionBar.tsx` had five presets). In Jenni, "Cite
from my library" with nothing suitable returned the same suggestion with no message.

## Decision

- Five presets added and the menu grouped as Jenni groups it (Write / Refine / Citations): Increase
  novelty, Simplify language, Validate supporting evidence, Cite from my library, Re-write without
  citations. Like the five before them they are instructions on the existing guided A.1 path — no
  new prompt (CLAUDE.md rule 6).
- Two of them must hold **in code**, not only in the instruction, so the request gains
  `citeMode` (`@tc/ui` `GhostRequestPayload`, `POST /assist/suggest`):
  - `none` — "Re-write without citations": citing is off for this one suggestion
    (`postProcessAssist` with `autoCite: false`), so a citation the model writes anyway is
    stripped and is not counted as a hallucination.
  - `library` — "Cite from my library": retrieval is limited to the papers the student added
    themselves (`ContextService.ownSourceIds`, `autoAddedAt IS NULL`), and no automatic search
    for new papers is started. When none of them is about the sentence (`isOffTopic`, the chat's
    measured `RELEVANCE_FLOOR`), the model is not called, the ASSIST unit is refunded and the
    student reads why (`NO_LIBRARY_MATCH`).
- A refinement that brings nothing back — refused, empty or failed — puts the suggestion it
  replaced back on screen (`SuggestionBar` `fallbackRef`), so refining never costs the student
  the suggestion they had.

## Cost

None new: each preset is one guided suggestion, one ASSIST unit, as before; the refused "Cite
from my library" costs nothing.

## Evidence

`apps/api/test/refine-cite-mode.spec.ts` (real Postgres/Redis): citations stripped under `none`;
the student's own paper cited under `library`; with only automatically found papers, the
`NO_LIBRARY_MATCH` message, no model call and no unit spent. Browser, real models, local stack:
the grouped menu; "Cite from my library" on a thesis with only found papers → the message, the
counter unchanged at 5/50, the earlier suggestion back on screen; "Re-write without citations"
→ the same point with no citation (4.1 s); "Validate supporting evidence" → the claim reworded to
what the cited passage says, citation kept (3.1 s).
