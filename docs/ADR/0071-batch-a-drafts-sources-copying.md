# 0071 — Drafts know their section, sources are prose, copying is flagged

Date: 2026-10-05
Status: accepted
Follows: the side-by-side study (`docs/research/side-by-side-2026-10-05.md`), batch A.

## Context

The side-by-side run on production v0.1.26 found faults in what we ship:

1. **"Draft a section" wrote 303 words that were not about the section.**
   - Ctrl+Shift+D sent only `{chapterId, outlineNodeId}`, so the heading under the cursor was
     never read.
   - A "Start writing now" thesis has no outline, so the draft was for "Chapter 1" with no scope,
     and the retrieval query was "Chapter 1.".
   - The nearest chunks to that are runs of headings and contents pages. The model, told to cite
     every claim, described them as findings.
2. **Retrieval kept chunks that are not prose**: heading runs, contents pages, reference lists,
   running headers, ISSN lines. 27% of the dev library's chunks.
3. **A suggestion reused its cited passage almost word for word.** Our own "Too close to a
   source?" check passed it, because it skipped every sentence carrying a citation.
4. The needs-source note showed as raw `[[NEEDS SOURCE: …]]`.
5. The thesis list and the Flags panel moved while loading, and clicks landed on the wrong thing.
   The list showed a blank screen for ~3 s. The Flags panel showed students our AI cost in rupees.
6. The draft panel kept saying "Draft inserted" after the draft was discarded.

## Decision

1. **Draft mode drafts the section the cursor is in.**
   - The editor sends the nearest heading above the cursor (below the chapter's own level-1 title;
     a literal `## …` line counts) and the student's text under it (`sectionUnderCursor`).
   - The worker drafts for that heading. Its scope comes from the outline when the outline has
     that section, else from the chapter. The search query is heading + scope + the student's text.
2. **A section that names no topic is not drafted** (`isGenericSectionTitle`: "Chapter N",
   "Section N", "Untitled", empty).
   - Draft mode asks for a heading instead (`SECTION_NEEDS_TOPIC`, 422).
   - The API refuses before the unit is taken; the worker has the same guard.
3. **Chunks that are not prose are dropped at indexing** (`isProseChunk`):
   - the references, acknowledgements and contents sections;
   - fragments under 12 words;
   - runs of short lines (6 words or fewer) with no sentence in them;
   - blocks dominated by reference entries.
   - If that would leave a source with nothing, it keeps what it had.
   - The six-word bar was measured: at ten, PDF-wrapped prose was dropped too.
   - `pnpm --filter @tc/api prune-chunks [-- --apply]` removes such chunks from libraries indexed
     before this change. No re-embedding is needed.
4. **Copying is flagged, never rewritten** (§12.3 stands: no rewording to get past a checker).
   - Assist and Draft check their own output against the passages they cited
     (`closeToPassages`, the same shingle test as "Too close to a source?").
   - The editor says "this follows Bagla 2026's wording — put it in your own words, or quote it,
     before keeping it". The draft panel lists such paragraphs.
   - "Too close to a source?" now also reports a **cited** sentence that copies 8+ words verbatim
     outside quotation marks. A citation does not make copied words a quotation. A sentence with
     its quotation marks in place stays silent.
5. The needs-source note reads "Needs a source: …" in the editor. The prompt-facing text and the
   exports keep their markers.
6. Layout:
   - the setup checklist and the next-action line hold their space while loading;
   - the Flags panel does not swap its button after load;
   - the student is told "uses one coherence check from your plan", not "about ₹8.4 of AI";
   - a spinner replaces the blank screen;
   - the draft panel closes once its draft is accepted or discarded.

**Not changed:** `## ` → heading. The input rule works with real key presses in every repro,
including straight after accepting a suggestion. The production miss came from the browser
automation inserting text in one go, which bypasses input rules. IME keyboards can do the same;
the style menu remains the way in for them.

## Consequences

- A student who starts writing without a plan and asks for a draft is asked for a heading first.
  That costs one more step, and avoids a confidently wrong draft.
- Existing libraries need one `prune-chunks --apply` after release. On the dev library: 2,818 of
  10,444 chunks in 46 of 553 sources, before the six-word fix.
- One test changed meaning: a cited sentence that copies a long run verbatim is now reported. The
  test now pins that, and that a quoted one is not.

## Tests

- **retrieval:**
  - `prose-chunks.spec.ts` (8);
  - `paraphrase.spec.ts`: cited-verbatim reported, cited-close and quoted silent, and
    `closeToPassages` on the production case.
- **ui:** `section-under-cursor.spec.ts` (4).
- **worker:** drafting under a heading; refusing "Chapter 1"; `draftCloseTo`.
- **api:** `draft-topic.spec.ts` (refused with no unit taken; a generic heading refused; a
  heading reaches the job).
- **Playwright:** the draft refusal now asks for a heading first, then (with one) refuses for
  having no sources; 19 related specs pass.
