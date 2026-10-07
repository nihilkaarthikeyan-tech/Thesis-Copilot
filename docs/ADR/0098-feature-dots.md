# 0098 — Feature hints on the screen

Date: 2026-10-07
Status: accepted (Jenni build plan Round 2, R11; inventory §13.1)

## Context

Jenni marks a feature the student has not tried with a dot; pressing it gives one line and Try
now / Dismiss. Our hints were blocks above the page (the setup checklist, the first-session guide,
`FirstRunHint`), away from the thing they describe.

## Decision

- `FeatureDot` (`components/onboarding/FeatureDot.tsx`): a dot on the right panel's tabs for four
  features — **Sources** (your library is cited), **Citations** (type @ to cite, free), **Chat**
  (ask about your papers), **Check** (an examiner's reading). Pressing it shows the line, **Try
  now** (opens the tab; for Citations it also puts "@" where the student is writing, which opens
  the library picker; for Chat the caret goes to its box) and **Dismiss**.
- A dot goes for good, in this browser, when the student dismisses it, tries it, or opens that tab
  any way at all. Stored with `FirstRunHint`'s keys (`tc.hint.feature-…`): a sentence of guidance
  needs no server, and a new device showing them again is right.
- No dots while the first-session guide is on screen: one teacher at a time.

## Evidence

Browser (dev stack): no dot marked used on load (React runs effects twice in development; the
first version's "skip the first run" marked the starting tab used on every load — now the tab is
compared with the one before); the guide put away, four dots; Chat's Try now opened Chat, opening
Check by its tab and dismissing Library each removed theirs; after a reload only Cite's remained.
