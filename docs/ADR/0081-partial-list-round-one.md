# 0081 — The partial list, round one: edit actions, flags, claims with no source, "On"

Date: 2026-10-05
Status: accepted (agent, under ADR-0059; the owner asked, after v0.1.27, to "fix all the partial
ones" in the Jenni coverage map)
Follows: `docs/research/coverage-map.md`; ADR-0066 (edit actions), ADR-0074 (research chat),
ADR-0023 (citation support), ADR-0056 (examiner flags).

## Context

After the two studies and v0.1.27, the coverage map still held twenty rows marked PARTIAL and
three MISSING. Some are the owner's (a free plan, a Discord, videos, the nginx location, keys);
some were stale (rows fixed by ADR-0070 and ADR-0078); the rest are built in rounds. This ADR is
the first round: the ones that fit the existing shapes.

## Decisions

1. **Row 49, edit actions: `translate` and `table`** (`edit.md`, `command.ts`; ADR-0066 left
   them out). `translate` has exactly one target, the thesis's language (§2.2), sent as
   `<target_language>`; a selection already in that language comes back unchanged. The §12.3
   worry in ADR-0066 was humanising; translating a student's own draft into the language their
   thesis is written in is not that, and refusing it only hurts the student who thinks in Tamil
   and writes in English. `table` answers with a Markdown pipe table of the facts the selection
   compares — a header row, one row per thing compared, a Source column with the citation
   markers — and the editor inserts it as a real table node (`table-from-markdown.ts`), each cell
   through the same fragment builder a rewrite uses, so the markers become citation nodes.
   Both run on the COMMAND allowance through the same diff-and-Replace screen and grounding
   (`postProcessCommand`: no citation added, none dropped). Thirteen of Jenni's seventeen now.
2. **Row 59, flags: Y / N and "all".** The Flags tab takes Y and N as proofreading does (R and I
   stay), and offers *Resolve all* and *Ignore all* over the flags shown, confirmed first, as the
   student's explicit action.
3. **Row 54, a claim with no source: "Find a source".** An `UNSUPPORTED_CLAIM` or
   `CITATION_SUPPORT` flag opens the Papers tab searching for the flagged sentence, where a paper
   can be added and cited. No model call, no allowance. The check itself still judges against the
   library only; proposing a source is a search the student runs, not a claim the model makes.
4. **Row 39, scopes combined: "On" searches on every library question.** Under ADR-0074 the
   search ran only when the library was thin, whatever the setting. "On" now means what the
   Settings page says: every library question also searches the literature and the answer
   combines both, with the step saying so ("…searching the literature too, as your settings
   ask…"). "Ask first" is unchanged (thin libraries only); "Off" never. `shouldResearch` holds
   the rule, tested. Cost: one embedding call per question under "On" (under ₹0.04), inside the
   CHAT unit as ADR-0074 priced it.
5. **Stale rows corrected**: 6 and 18 (ADR-0070's first session and ADR-0078's opener), 23 (the
   Papers tab shows the matching passage), 41 (ADR-0080).

## Not in this round (next rounds, or the owner's)

- Attachments and images in chat (row 42), a tone review of written text (57), context per
  section (10), copying prevented rather than flagged, and the deep research evaluation round:
  the next rounds.
- Claims-based gap analysis (63): a new prompt and a new screen; after the rounds above.
- The owner's: the free plan and limits, Mendeley/Zotero live sync (ADR-0059 chose read-once),
  the Springer key, co-editing's nginx location, the extension's store listing, languages
  beyond Hindi and a native reviewer, support chat, videos, a community.

## Tests

`packages/ai/test/edit-actions.spec.ts` (translate's target, the table mock),
`apps/web/test/table-from-markdown.spec.ts`, `apps/api/test/chat-research.spec.ts`
(`shouldResearch`, the step), `apps/web/e2e/flags-keys.spec.ts` (Find a source, the N key).
