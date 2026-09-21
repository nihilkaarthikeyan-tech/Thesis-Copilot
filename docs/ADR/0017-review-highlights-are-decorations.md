# ADR-0017 — review highlights are decorations, and `commentAnchor` stays unused

**Date:** 2026-09-21
**Status:** Accepted
**Departs from:** PRD Appendix B.2, which lists `commentAnchor` as a mark in the editor schema.

## What prompted it

The supervisor cycle (§5.7, Appendix D.2) ships as a separate screen: a queue of comments with
accept, edit and reject. It works, and it is the wrong place to be when you are rewriting the
paragraph the comment is about. Putting the comments back on the words they refer to is the last
item on the owner's Jenni-parity list ("in-editor review / track-changes").

Appendix B.2 anticipated this and reserved a mark:

> Marks: … `provenance`, `commentAnchor`.

`packages/ui/src/editor/nodes.ts` has carried it since week 2, registered and explicitly inert.
Building the feature meant either finally using it or saying why not.

## The decision

**Highlights are ProseMirror decorations computed from the live document. The `commentAnchor`
mark stays registered and unused.**

The mark is kept in the schema rather than deleted because documents saved by any earlier build
may contain it, and a schema that cannot parse its own stored documents drops content silently.

## Why

A stored mark and a derived decoration answer the same question — *which words is this comment
about?* — and the product already has an answer, on the server. `CommentsService.list` re-finds
every comment's passage from its `quotedText` on every read, by similarity, because a student
keeps editing under a comment that is still open. `findAnchor` has been doing that since B2.2.

Against that, a stored mark has to be:

- **written** — on the save after a comment is created, meaning a comment cannot be anchored until
  the student's editor happens to be open and saving;
- **removed** — on resolve, reject, delete, and on a `.docx` re-import that supersedes a comment;
- **reconciled** — with the server's re-anchoring, which will disagree with it the moment the two
  differ, and there is no rule for which wins.

Each of those is a place for the document to end up carrying a mark for a comment that no longer
exists. A decoration cannot be left behind: it is recomputed from whatever the document says now,
and when the passage is gone it simply is not drawn.

## Why the range is found in the browser, not taken from the server

`CommentView.anchor` already carries `{ from, to }`, and the flags panel uses the equivalent
positions for "Go to". Those come from `sentencesOf`, which advances by *text* offsets inside a
block while ProseMirror counts an inline atom as one position and its text as zero. A sentence
after a citation is therefore off by one position per citation — invisible when you are scrolling
somewhere, visible when you are underlining words. They are also computed from the **saved**
chapter, so anything typed since the last autosave shifts them.

So the browser searches the live document for the quoted text (`findPassage` in
`packages/ui/src/editor/review.ts`): exact match first, then the quote's opening 40 characters for
a sentence whose end the student has rewritten, and nothing at all below that — a guess drawn on
the wrong sentence is worse than an honest gap. The server's position is still used, for the one
thing it is reliable for: breaking a tie when the quoted sentence appears twice in the chapter.

## Consequences

- No migration, no schema change, and nothing to clean up when a comment is resolved.
- A comment whose passage has genuinely been rewritten past recognition is **not** highlighted,
  and the panel says the passage has changed. That is the same honesty rule as the flags panel's
  "location moved — re-run".
- The highlights are only as good as `quotedText`. A comment created without one — a general note
  on the chapter — has nothing to anchor to and appears in the panel unanchored, which is correct.
- If a future feature needs an anchor that survives the text being rewritten (a threaded
  discussion pinned to a paragraph, say), this decision should be revisited: that is a different
  question, and a stored mark may well be the right answer to it.
