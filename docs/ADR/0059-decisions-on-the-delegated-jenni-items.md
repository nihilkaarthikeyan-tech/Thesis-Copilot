# 0059 — Decisions on the Jenni-study items the owner delegated

Date: 2026-10-04
Status: accepted

## Context

The Jenni study (docs/research/coverage-map.md) left 17 rows marked "needs the owner's decision":
new prompts, a vision model, changes to the spec, and business choices. On 2026-10-04 the owner
replied: "you know which is best, so do it yourself and start building the remaining things, step
by step." This records what was decided for each, and why, so none of it is a silent change.

The constraints that still bind every decision: ₹100 per student per month all-in (§11), grounding
enforced in code (§10.6), flag-don't-fix, no humanise or detector-evasion feature (§12.3), and a
new prompt gets its own ADR and an evaluation round against the real models (precedent ADR-0010).
Releases and production changes still wait for the owner's word.

## Decisions

| Row | Item | Decision |
|---|---|---|
| 39–41 | Chat beyond the library, with steps; Off / Ask / On per source | **Build, without a new prompt.** "Ask beyond my library" runs the existing scholarly search (no model), reads the open abstracts it returns, and answers through the existing A.4 chat prompt with those abstracts as the passages, so grounding holds exactly as it does today. The steps are shown (searching, reading N abstracts, answering). Each cited paper is marked "not in your library" with an Add button. A per-user setting chooses Off / Ask first / On. One CHAT unit, as any question. |
| 49 | More edit actions | **Build a bounded set:** hedge a claim, make a claim more direct (only where it is already cited), active voice, past tense, present tense, turn a paragraph into a list, and a counter-argument drawn from the library's passages. New command names need prompt text that A.11 does not have: a new prompt file, its own ADR, an eval round. Metered as COMMAND. |
| 70 | Equation described in words | **Build.** The student writes "x squared over two plus mean" and gets LaTeX they can see rendered and edit before inserting. A new prompt (fast tier, a few hundred tokens), ADR, eval. Metered as COMMAND. The output is LaTeX validated by KaTeX before it is offered; nothing is inserted without the student pressing Insert. |
| 53 | Review just a selection | **Build with the existing examiner prompt** (ADR-0056 builder) over the selected text as one section: no new prompt. One COMMAND unit, since it is one examiner call (~₹0.23), not the eight of a chapter review. |
| 57 | Tone of voice | **Not now.** The writing profile (ADR-0024) already shapes Assist to the student's own voice; a second "tone" control would compete with it, and imitating another author's PDF style brushes §12.3. Revisit after the pilot. |
| 63 | Gap analysis by claim | **Later, after 39–41.** It needs a claim-extraction prompt over many abstracts and is the most expensive item here; it is built after the beyond-library chat proves the abstract-reading path, with its own ADR and cost check. |
| 71 | Equation from a photo | **Build** with the strong tier's image input (gpt-5-mini accepts images). One image per request, size-capped, metered as COMMAND; the cost per call is added to docs/COSTING.md and checked against ₹100 before release. Output is LaTeX the student edits and confirms, as row 70. |
| 42 | Images in chat | **Not now.** A figure from a paper is already in the library's text extraction; general image questions have no grounding to check against. Revisit with evidence that students need it. |
| 36 | Live Zotero / Mendeley | **Build Zotero, not Mendeley.** The student pastes a Zotero API key and library id; the import reads their items once (CSL-JSON) into the normal resolve pipeline and the key is not stored. This departs from FR-2.9 ("via file upload, not OAuth") only in transport — nothing is linked or synced afterwards. Mendeley needs an app registered with Elsevier: listed in PENDING. |
| 18 | Instant citations from papers not in the library | **No.** Citing a paper the system has not read is the exact failure grounding exists to prevent; ours adds the paper first and cites only what it holds. Recorded as a deliberate difference. |
| 2 | One-click new thesis | **Build "Start writing now"** beside the existing start: it creates the thesis with a working title the student can change, one empty chapter, and opens the editor; the proposal stays one click away and is offered again on the thesis list. FR-1's proposal paths are unchanged; this adds a third way in for a student who already knows what they are writing. |
| 89 | Interface languages | **Build the mechanism and Hindi first,** for the student's main screens, marked "Hindi (beta)" with English as the fallback for any string not yet translated. Every translated string is listed for a native speaker's review in PENDING before Hindi leaves beta. Tamil and others follow the same route once Hindi is reviewed. |
| 94, 98 | Live chat support, community | **Not built by the agent:** both need accounts and a person to answer. The in-app feedback form (admin feedback inbox) is the support route today; PENDING lists the choice. |
| 95 | Video tutorials | **Not built:** a person records them. The help pages (/help) carry the steps meanwhile. |
| 101 | Live demo on the home page | **Build a scripted demo** — no model call, no account — that types a sentence, shows a cited suggestion, opens its evidence card and accepts it, from fixed text. A screenshot goes to the owner before release, per the owner's rule on the landing page. |
| 38, 80 | Springer full text; live co-editing in production | **Unchanged:** need the Springer Nature key and a change on the production nginx — both in PENDING. |
| — | Count only kept suggestions against the allowance | **No.** Every shown suggestion costs a model call; counting only kept ones would let spend run past the ₹100 ceiling with nothing to stop it. |

## Consequences

Four new prompts follow, each with its own ADR and eval round (edit actions, equation in words,
equation from a photo) or reusing an existing prompt (beyond-library chat, selection review). The
cost model in docs/COSTING.md is re-run as each lands. The coverage map marks rows 18 and 57 as
deliberate differences.
