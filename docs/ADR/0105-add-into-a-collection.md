# 0105 — Add straight into a collection

Date: 2026-10-07
Status: accepted (Jenni build plan Round 2, R18; inventory §4, §13.9)

## Context

Jenni lets a student pick (or create) the collection a paper goes into as it is added. Ours had
collections (2026-10-04) but filing was a second step: add, find the paper, tick it, Add to.

## Decision

- The library's add row starts with **Add into**: "The library only", each collection, or **New
  collection…** (named inline, made, and chosen). Every add on the screen — a .bib/.ris file, Zotero,
  a PDF, Paste an ID (R16) — files into it.
- One mechanism for all of them, in the page: the library's ids before an add are compared with
  the list after it, and the new rows go to the collection (`POST /collections/:id/sources`); an
  add that names its paper by id (an ID already in the library) is filed too. No route changed, so
  a new way in files the same way by calling `fileInto`. The notice says "Filed in <name>".
- Not covered: papers added from the Discover tab and from the editor (chat's Add, Find papers),
  which have their own screens; those keep the two steps for now.

## Evidence

Browser, real stack: "New collection…" → "R18 test shelf" made and chosen; Paste an ID with an ISBN
→ "… added. … Filed in R18 test shelf."; the collection's count 1. Removed afterwards.
