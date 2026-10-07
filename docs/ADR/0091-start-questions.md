# 0091 — A few questions at the start, with answers the AI suggests

Date: 2026-10-07
Status: accepted (owner, 2026-10-07: "we need to ask the prompts like questions, 3–4, from the
user, and the AI must give the suggestion; they can take this or not" — Jenni build plan R4)

## Context

The proposal conversation (A.6, `proposal.md`, evaluated 2026-09-30) already asks up to three
questions, each with 2–4 options the student taps or "something else", and drafts a working title,
problem statement and objectives. Only "Create thesis with a proposal" reached it; "Start writing
now" (ADR-0062, ADR-0087) planned the chapters from the title alone.

## Decision

- **Start writing now with Smart headings** now creates the thesis with `askFirst: true`
  (`POST /documents`), which holds back the plan-from-title, and shows `StartQuestions` on the
  same screen: the proposal conversation (`PathAChat`, now able to send the title as the first
  message itself, `autoStart`), then the drafted title, problem and objectives.
  - **Use this and start writing** saves them as the proposal (`PUT /memory/scope`) and plans the
    chapters from it (`POST /outline/generate`).
  - **Skip and start writing**, at any moment, plans from the title as before
    (`POST /outline/plan-from-title`).
- Standard and No headings are unchanged (no questions: there is nothing for the AI to plan).
- No new prompt: A.6 as evaluated. No new cost line: the conversation is bounded per thesis
  (`PROPOSAL.maxModelTurns`, ADR-0005) and logged under `PROPOSAL`, as on the proposal path.

**Found on the way.** The proposal model wrote a citation marker into the problem statement
("…among rural and disadvantaged women in India. {{cite:gap_check}}"), shown raw. A proposal has
no passages to cite; `stripProposalMarkers` (`@tc/ai`) now removes any marker when a skeleton is
parsed, when a stored conversation is read back, and when a scope is saved from any screen.

## Evidence

Real models, local stack: "Mobile banking adoption among women self-help groups in Tamil Nadu" →
setup → Start → the first question with three directions to tap and "something else" (~15 s) →
one tap → the drafted title, problem and objectives (7 s) → Use this → the editor in 1.5 s; within
30 s six chapters, Chapter 1's sections laid out ("Problem statement and motivation", "Objectives
and research questions", "Significance and study boundaries"). Tests: `apps/api/test/
start-setup.spec.ts` (smart plans at once; with `askFirst` it does not), `packages/ai/test/
proposal.spec.ts` (markers stripped from every field); the browser specs that start a thesis now
press Skip.
