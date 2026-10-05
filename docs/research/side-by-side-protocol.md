# Side by side, landing page to submission — protocol (2026-10-05)

Asked by the owner after v0.1.26. The study of 2026-10-04 counted features and so missed the
first-session wait (ADR-0070). This one measures **how the product feels to use**: time, clicks,
moments of doubt, dead ends, and the quality of what comes out. It also checks the "Groww test":
one obvious next action on every screen, plain words, instant feedback, nothing that looks stuck,
and an easy way back.

## Rules

- Jenni is observed only, through the owner's own signed-in session in the built-in browser:
  - its free allowance is used sparingly;
  - no probing of its servers, no attempt to extract its prompts, no copying of its code;
  - no new accounts; never sign out of the owner's session;
  - never get around a bot check.
- Ours is used on production (thesis.rademics.ai, v0.1.26) with a fresh account. A brand-new
  student's experience is the point.
- The same topic on both: **"Barriers to rooftop solar adoption among rural households in
  Karnataka"**, the same opening sentence, and the same requests.
- Every task records:
  - wall-clock time;
  - clicks and keystrokes beyond the content itself;
  - each moment a new student would ask "what now?";
  - each dead end;
  - each word a student might not know.

## The journey

| # | Task | Done when |
|---|---|---|
| 1 | Land on the home page and understand what it is | can say what it does and what it costs |
| 2 | Sign up | inside the product |
| 3 | Start a thesis on the topic | a page to write on |
| 4 | Write the first sentence and get help | a suggestion with a real citation is kept |
| 5 | Find and add papers | 5 relevant papers in the library |
| 6 | Read a paper and use a passage | a quoted, cited passage in the text |
| 7 | Write a section ("Literature review on cost barriers") | ~300 cited words in the document |
| 8 | Ask a question about the papers | an answer citing the papers |
| 9 | Fix and improve text (paraphrase, shorten, academic tone) | the edit is in |
| 10 | Check the work (citations, claims, review) | a list of real problems to fix |
| 11 | Share with a supervisor and take their comments | a comment answered |
| 12 | Format and export (references style, Word/PDF) | a file that opens correctly |
| 13 | Account: plan, limits, what happens when they run out | knows what they have left |
| 14 | Come back the next day | back where they left off in one click |

## Output quality

Tasks 4, 7, 8 and 9 produce text. The outputs of both tools are saved verbatim and judged on:

- **Accuracy:** is every claim supported by the cited paper?
- **Citations:** real, relevant, correctly placed?
- **Academic quality:** precise, hedged where needed, no filler.
- **Effort to fix:** how many edits a careful student would make before keeping it.

Each judgement is made against the cited papers themselves, not against the other tool.

## Output of the study

`docs/research/side-by-side-2026-10-05.md` holds:
- a table per task;
- the outputs side by side;
- where Jenni is better and where we are;
- a ranked list of improvements with the effort for each.

Nothing is built until the owner chooses.
