# 0122 — The limit message on every screen

Date: 2026-10-08
Status: accepted (Jenni build plan Round 2, R31; inventory §13.6)

## Context

Jenni's limit wall opens "Upgrade your account" and never says which allowance ran out or when it
comes back. Ours said more, but only in one place: the editor's suggestion strip named the
allowance and the reset date when Assist was refused. Everywhere else a refused action printed
the API's `detail` as a bare error line ("You have used all 2 of this month's section commands."),
with no date and nowhere to go, or said nothing: citation suggestions ignored the ₹100 ceiling and
the site budget, and the chat turned the refusal into a plain `Error` before any screen could read
it. The refusal itself (`CapExceededError`) carried `action`, `cap` and `resetsAt`, but not how many
had been used.

## Decision

- **The API carries what the message needs.** Every refusal (`CAP_EXCEEDED`, the ended trial,
  `CEILING_EXCEEDED`, `PLATFORM_CEILING_EXCEEDED`) adds `allowance`, the student's name for it from
  `ALLOWANCE_NAMES`. A cap refusal adds `used`: this month's count from the ledger row, read after
  the refusal with the row's `bonus` (the read that was already there). `cap` stays this month's
  total including an admin's extra allowance. The atomic statement in `UsageService.consume` is
  unchanged; only what the refusal says is. The title plan's own cap (`OUTLINE_FROM_TITLE`)
  passes its count too. `detail` is unchanged, for any other client.
- **One message, built on the web** (`lib/limit.ts`): `limitRefusal(error)` reads an `ApiError`,
  a problem body or the suggestion stream's error event, and `limitText` says it in one of five
  ways: an allowance used up ("Section commands: 2 of 2 used this month. Resets on 1 Nov 2026.
  Writing, editing and exporting still work." + **Usage and plans**, `/app/account`); an allowance
  the plan does not include ("…: none included in your plan." + **See plans**, `/pricing`); the
  trial over (the date it ended, the theses safe + **See plans**); the ₹100 ceiling ("It resets
  on …" + **Usage and plans**); the site budget ("AI features return on …", not the student's
  allowance, no link, since a plan would not help). Built from the members, never from `detail`.
- **The date is the student's own.** Caps reset at 00:00 UTC on the 1st, which is the 1st in
  India (05:30); west of Greenwich it is the evening of the 31st, and there the time is added so
  the date is not read as a day early (`formatResetDate`). The usage menu's "Renews …" uses the
  same function, so the two never disagree.
- **`<LimitNotice>`** draws it: a tinted box, title, sentence and link, no fixed width,
  `overflow-wrap:anywhere`, so it wraps in a 288 px side panel and on a 390 px phone. `useLimit()`
  holds the last refusal for a screen; in a `catch`, `if (limit.take(e)) return;` and every other
  failure is handled as before. Inside the editor's message strip it is drawn without its own
  frame, and a limit notice stays up as long as one with an action (15 s).
- **Where it is used** (every web call to an action `consume` or `spendAllowed` can refuse):
  Assist suggestions (the editor strip), citation suggestions, Draft, the edit panel and section
  commands, the citation role rewrite, proofreading and the tone review, equations from words
  and from a photo, the coherence check, the examiner review of a chapter and of a selection, a
  revision from a comment (the editor's Comments tab and the review page), a chapter plan from
  the title (the section guide and the start questions), the chapter build, viva questions and
  viva feedback, and chat (including deep research). The chat panel's change is a few lines: the
  refusal is kept as an `ApiError` instead of a plain `Error`, and the message sits under the
  thread where its errors already did. The citation suggestion box also
  gets `max-w-[calc(100vw-2rem)]`, as the message now sits in it on a phone.
- **English only**, like the panels it appears in and the API sentence it replaces. The editor
  strip's other notices are translated (ADR-0061); this one joins the catalogue when the Hindi
  sheet is next reviewed.

No new prompt, no migration, no new allowance.

## Evidence

`apps/api/test/limit-refusal.spec.ts` (5, real Postgres): a COMMAND refusal is 429
problem+json with `action`, `allowance: "Section commands"`, `used: 2`, `cap: 2` and `resetsAt`
the next 1st at 00:00 UTC, and the counter did not move; an admin's extra unit makes it 3 of 3;
the trial's zero coherence checks are 0 of 0; an ended trial is 402 with `allowance` and
`trialEndedAt` and no `resetsAt`; the ₹100 ceiling is `CEILING_EXCEEDED` with `allowance` and
`resetsAt`. `plan-from-title.spec.ts` and `admin-controls.spec.ts` assert the count too.
`apps/web/test/limit.spec.ts` (14): each kind read from an `ApiError`, a body and a stream event;
other failures are not limits; an older API without `used`; the date in India and in New York;
every sentence and link. `e2e/limit-message.spec.ts` (written, not yet run): proofreading
refused in the 288 px Check tab, and a chat question refused on a 390 px phone, each with the
allowance, the count, a real date and the link, and no layout fault around it.
`e2e/states.spec.ts`'s fifty-first Assist now asserts the new words.
