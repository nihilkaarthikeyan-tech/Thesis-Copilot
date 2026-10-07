# 0087 — Jenni's start (preferences with indexing, structure, headings in the page) and a wider paper pool

Date: 2026-10-07
Status: accepted (owner's instruction, 2026-10-07: "build all 5 fixes and release", with Jenni's
start flow as shown in their screenshots — indexing in place of impact factor and cited-by)
Follows: ADR-0037 (automatic sources), ADR-0070 (first session), ADR-0072 (plan from title),
ADR-0078 (opener, per-source cap for drafts), ADR-0085 (pins per section).

## Context

The owner's manager: the writing "revolves around three papers" — the pool of papers was too
small and the same citation followed sentence after sentence. The demo video showed it
("(Mathivathana & Alagulakshmi, 2025)" again and again). Causes, in the code: the automatic search
added 5 papers and stopped once anything matched; a suggestion's 6 passages could all come from
one paper; nothing preferred a paper not yet cited.

Separately, Jenni's start — prompt, citation preferences (style, web/library search, year, impact
factor, cited-by, preprints), headings (IMRaD / Smart / none), then a document with its headings
and a first suggestion — was recorded in the Jenni study (rows 4–6 of the coverage map) and
marked MATCH when ours had only a style choice. That was rounding up; this builds it.

## Decision

The paper pool:

1. **A starting library of fifteen** (`AUTO_SOURCES.initialPerRun`), from the search made when a
   thesis is created (`initial: true`, its own job id `initialSourcesJobKey`). Later searches still
   add five.
2. **At most two passages per paper in a suggestion** (`PER_SOURCE_CAP.ASSIST = 2`), the draft
   rule of ADR-0078 applied to autocomplete; a library of one paper still fills the request.
3. **Papers the chapter already cites step back** (`spreadCitations`: −0.03 per citation, at most
   −0.15), so the next-best paper comes through when the two are close and an off-topic paper
   never overtakes an on-topic one.
4. **A section is covered by three papers, not one** (`AUTO_SOURCES.minPapers`): fewer, and the
   search starts again for that section; the job id carries the section, so each heading searches
   once per cooldown.

The start (after the title, on both new-thesis screens):

5. **Sources and citations**: style, Web search (automatic sources for this thesis), Library
   search (cite the student's own papers), Publish year (All / Last 5 years / Custom), **Indexing**
   (Core international journals = CWTS core, PubMed/MEDLINE, DOAJ, ABDC, ERIH PLUS, SciELO — the
   journal lists OpenAlex records as `listed_in`, verified 2026-10-07), Include preprints. Stored on
   `Document.meta.sourcePrefs` (`@tc/types` `sourcePrefsSchema`). They filter what is found *for*
   the student — in the OpenAlex query itself (`primary_location.source.listed_in`, publication
   years, types) and again on every merged result (`meetsSourcePrefs`); an index that cannot say
   where a paper is listed fails an indexing filter. Papers the student adds are never filtered.
   Library search off restricts suggestions and drafts to the papers found for them (`@` mentions
   excepted). Both off is refused.
6. **Structure**: Smart headings (ADR-0072's plan, the default), Standard thesis chapters (the
   empirical template's six chapters with their notes, made at once, no model) or No headings.
7. **Headings in the page**: a planned chapter's sections become level-2 headings in its body, each
   with a line under it — by the worker for chapters nobody has open, and by the editor for the open
   one (whose save would otherwise overwrite the worker's), only while the chapter is blank. The
   cursor goes under the first heading, where ADR-0078's opener offers a first sentence by itself.
   The "What this chapter is for" box folds once the headings are laid out (the rail lists them).

Not offered: impact factor and cited-by (the owner's call). **Scopus, Web of Science and UGC-CARE**
are not in OpenAlex; they need list files only the owner can obtain under their terms
(`docs/PENDING.md`), and the step says they are coming.

## Cost

The creation search reads up to fifteen papers instead of five: candidate abstracts as before,
plus the full texts of ten more papers — within the ~90k-token bound of ADR-0037 (under ₹0.50 at
voyage-4), once per thesis. Per-section searches are bounded by the existing monthly count
(5 trial / 20 paid). No new model call.

## Evidence

Real models, local stack, 2026-10-07: title → preferences (Last 5 years) → Smart headings → editor.
15 papers, all 2022–2026; Chapter 1's three sections appeared as headings 33 s after Start; a
cited first sentence appeared under the first without typing at 40 s; four citations across three
different papers. Tests: `rank.spec.ts`, `openalex-search.spec.ts`, `source-prefs.spec.ts`,
`find-sources.spec.ts`, `generate-outline.spec.ts`, `start-setup.spec.ts`, `auto-sources.spec.ts`,
`start-writing-now.spec.ts` (browser).
