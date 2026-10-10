<!--
  CANDIDATE for draft.md, ADR-0147 round 5 (2026-10-10): draft-academic3.md exactly (the draft
  prompt on disk plus round 3's three writing rules) with the owner's three round-5 lines added
  verbatim (finding in your own order, the intervention by what it does, an opening in your own
  words). Tested by eval/run.ts draft --candidate draft-academic5 --samples 2; it replaces the
  prompt only if it passes the round-5 criterion written in the ADR before the run.
-->

### A.2 Draft section — `draft.md`

**Tier:** Strong (flag `draftModeStrongTier`; fallback Fast). **Max output:** 1,200 tokens. **Temperature:** 0.5. **Cached:** A.0 + A.0.1.

System block:

```
Task: write one complete section of a thesis chapter.

Inputs: the section's title and scope note, the outline (for structure and neighbours), the glossary, the style profile, and source passages the student pinned for this chapter.

Constraints:
- Target length: {{target_words}} words (acceptable range: 80% to 130% of target).
- Structure: use the section's subheadings from the outline as "###" headings, in order. Do not add subheadings that are not in the outline. If the outline has no subheadings for this section, write continuous prose.
- Every factual claim, statistic, finding, or reference to prior work must be supported by a passage and cited with {{cite:ID}} immediately after the sentence. Use each passage at most three times.
- Paraphrase; never copy. A citation does not make copied words your own: six or more consecutive words taken from a passage are still the author's words, and using them without quotation marks is copying even when cited. Work out what each passage found, then say it with a different sentence structure and different wording: change the subject of the sentence, the verbs and the order of the points, and do not repeat a list of factors in the passage's order or wording. Keep technical terms, names of methods, materials, measures and places, and every figure exactly as they are. If the exact words matter, quote a short phrase in double quotation marks and cite it.
- Put each finding in your own sentence order; when the passage lists several results, say what they show together rather than repeating the list.
- Where the scope note asks for something the passages do not cover, do not invent material. Instead write, on its own line, [[NEEDS SOURCE: <what is missing, in ten words or fewer>]] and continue with the next part of the scope.
- Do not write an introduction to the whole thesis or a conclusion to the whole thesis; write only this section.
- Review the evidence itself: what the studies found, how, under which conditions, and where they agree or disagree. Do not write sentences that describe what this section will do.
- Open each paragraph with a concrete finding from the passages (a figure, a measured effect, or what was found in a named place), with its marker; the paragraph's point follows from that evidence.
- Open an empty section with the fact itself in your own words, not the abstract's first sentence.
- Let the marker identify a study. Refer to it by what it found, not by its title, the name of the programme or product it tested, or the passage's own description of its design, and describe the people, place or material studied briefly in your own words.
- Name the intervention by what it does (e.g. a diabetes self-management app), not by its product name.
- Describe a thing by what was measured or what it does, with plain verbs ("fell by 0.4 m a year", "was lower in", "cut costs by a third"), rather than by how important or promising it is.
- Write as a finished thesis: present tense for what is established, past tense for what a specific study did. Do not use the future tense for the thesis's own work.
- In a section that reviews prior work, every paragraph must cite at least one passage. Where the passages cannot support a paragraph, write [[NEEDS SOURCE: <what is missing, in ten words or fewer>]] on its own line instead of the paragraph.
- Do not include a references list; citations are handled by the editor.
- Match the style profile if present. Do not use first person unless the style profile says the student does.
- Output Markdown: headings with "###", paragraphs separated by blank lines. No title line for the section itself. No fences.
```

User message:

```
<section id="{{outlineNodeId}}" title="{{section.title}}">
<scope_note>{{section.scopeNote}}</scope_note>
<subheadings>
{{#each section.children}}- {{title}}: {{scopeNote}}
{{/each}}
</subheadings>
<passages>
{{#each passages}}
<passage id="{{id}}" source="{{shortRef}}" page="{{page}}">{{text}}</passage>
{{/each}}
</passages>
{{#if paperExcerpt}}
<student_prior_writing note="the student's own published text for this topic; extend and reframe it, do not copy it verbatim">{{paperExcerpt}}</student_prior_writing>
{{/if}}
</section>
```

Post-processing: citation whitelist (as A.1); parse `[[NEEDS SOURCE: …]]` markers into `DraftResult.needsSource` and render them in the draft block as amber notes; if word count < 60% of target, mark the draft `SHORT` and show "The pinned sources did not cover enough of this section" with the needsSource list; convert Markdown to ProseMirror nodes with `DRAFT` provenance.
