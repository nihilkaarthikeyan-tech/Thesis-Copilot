# Side by side with Jenni — five everyday tasks

**Who:** one person with a Jenni account (Free is enough for tasks 1–4; task 5 needs export) and a
Thesis Copilot account. **Time:** about an hour. **Why:** we have never measured the two tools on
the same work. Every decision about "beating Jenni" should come from this sheet, not from opinion.

Do every task in **both** tools, Jenni first, with the same inputs. Record what is asked in the
table under each task and save screenshots into `fixtures/benchmark/tasks/<date>/` as
`<task>-jenni.png` and `<task>-ours.png`. Paste any AI text exactly, unedited. Then tell the agent
the folder: it scores both and fixes what loses.

Use a phone stopwatch. "Time" is from the action to the first useful thing on screen.

## The shared thesis

- **Title:** Solar drying of marine fish in coastal Tamil Nadu: a forced-convection dryer for
  small-scale fishers
- **Field:** Mechanical / Agricultural engineering
- **Five papers to add.** Find them once on [openalex.org](https://openalex.org) (both tools search
  OpenAlex), write down the five DOIs below, and add the same five to both tools — by DOI, or by
  uploading the PDF where it is open access:
  1. The first open-access result for "solar drying fish review"
  2. The first open-access result for "forced convection solar dryer fish"
  3. The first result for "post-harvest fish loss India"
  4. The first result for "drying kinetics anchovy"
  5. The first result for "open sun drying fish spoilage"

  DOIs used: 1 ________ 2 ________ 3 ________ 4 ________ 5 ________

Note in the table if a DOI did not resolve in either tool; that itself is a result.

## Task 1 — Autocomplete

In a new document under a heading "Introduction", type exactly:

> Post-harvest loss is the main constraint on income for small-scale fishers on the Coromandel
> coast.

then stop typing and wait. Accept the first suggestion. Do this **three times** (delete and retype).

| | Jenni | Ours |
|---|---|---|
| Seconds until a suggestion appears (3 tries) | | |
| Did each suggestion carry a citation? (y/n × 3) | | |
| Was the citation a paper you added? | | |
| Suggestion text (paste all three) | | |
| Would you keep it? (1–5) | | |

## Task 2 — Find a citation for a sentence

Type: *"Open sun drying loses up to a quarter of the catch to spoilage."* Then use the tool's own
"cite" action on that sentence (Jenni: select → @ Cite; ours: wait for the citation suggestion
under the sentence, or type `@`).

| | Jenni | Ours |
|---|---|---|
| Clicks from sentence to citation inserted | | |
| Seconds | | |
| Did it find a paper that actually supports the claim? | | |
| Label as shown (e.g. "(Kumar et al., 2021)") | | |
| Hover/click the citation: does it show the passage and page? | | |

## Task 3 — Draft a section

Ask each tool for a ~300-word section titled **"Drying technologies"** from your library (Jenni:
the AI chat / generate; ours: Draft mode on that heading).

| | Jenni | Ours |
|---|---|---|
| Seconds to the full section | | |
| Number of citations | | |
| Any citation to a paper NOT in your library? | | |
| Any sentence with no citation that states a fact? (count) | | |
| Overall quality (1–5) | | |
| Text (paste) | | |

## Task 4 — Chat with a PDF

Upload one of the papers as a PDF if you have not, then ask: *"What drying time did the forced
convection dryer achieve, and at what final moisture?"*

| | Jenni | Ours |
|---|---|---|
| Seconds to answer | | |
| Correct? | | |
| Does it point to the page/passage? | | |
| Answer (paste) | | |

## Task 5 — References and export

Switch the citation style to **IEEE**, then **APA 7**, then export to Word.

| | Jenni | Ours |
|---|---|---|
| Did every in-text label change correctly with the style? | | |
| Reference list complete and in the right order? | | |
| Any wrong author, year or missing DOI? (list) | | |
| Does the .docx open cleanly in Word, equations and citations intact? | | |

## Last: first impression

Starting from each tool's home page **signed out**, time how long it takes a new user to reach
their first AI suggestion in a document. Count the screens on the way.

| | Jenni | Ours |
|---|---|---|
| Screens from home page to first suggestion | | |
| Minutes | | |
| What was confusing? | | |
