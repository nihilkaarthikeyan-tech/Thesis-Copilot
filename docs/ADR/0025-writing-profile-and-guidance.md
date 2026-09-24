# ADR-0025 — the writing profile on a screen, and the student's own guidance

**Date:** 2026-09-24
**Status:** Accepted
**Extends:** FR-4.7 (style profile) and PRD §9.3's `POST /documents/:id/style-profile`
("Re-learn my style"), which had an endpoint and no screen.

## What prompted it

A competitor advertises "prompt guidance that learns as you write". The product already learned
as the student wrote: FR-4.7's style profile is inferred from the student's own words and rendered
into every prompt through A.0.1's `<style_profile>` block. But it was on no screen. The student
could not see what the model had concluded about them, correct it, re-learn it, or add to it.

## The decision

- **"What it has learned about your writing"**, in the editor's *How suggestions work* dialog: the
  voice note and the measurements exactly as the model receives them, when they were learned, and
  that AI-written text is never counted.
- **Re-learning, once a day.** It is a Strong-tier call behind one click, and nothing ships
  uncapped (§11); the first automatic inference (FR-4.7) is unchanged.
- **The student's guidance** — up to 300 characters in their own words ("British spelling", "call
  them farmers, not respondents"). It rides in A.0.1's existing `{{styleProfile.voiceNote}}` slot,
  appended after the model's reading as "The student asks: …", so **the verbatim template is
  unchanged**. It is stored beside the profile and survives every re-learn: the model's reading of
  the student is replaced, their own words are not.
- **Only with a learned profile.** The slot's other lines are measurements; printing them empty
  for a guidance-only profile would state things nobody measured. Before the threshold the
  guidance is saved and the screen says it is used once the style has been learned.
- **§12.3 still holds.** Guidance asking for detector evasion ("undetectable", "Turnitin", "AI
  detection", "humanise", "bypass", "sound more human") is refused with the reason, not stored.
  The filter is narrow on purpose: "use 'detector' consistently" is ordinary advice in a physics
  thesis.

## Consequences

- `PUT /documents/:id/style-profile/guidance`; `GET` now returns the guidance and when re-learning
  is next available. No new metered action, no migration (the profile is JSON on
  `DocumentMemory`).
- Proven in the browser against the real model: the profile learned from 1,700 words of the
  student's own text, an evasion request refused, guidance saved and kept.
