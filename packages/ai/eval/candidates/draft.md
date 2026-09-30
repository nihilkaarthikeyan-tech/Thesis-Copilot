<!--
  CANDIDATE for draft.md (ADR-0038). Tested against the prompt on disk by eval/run.ts; it replaces
  it only if it wins.
-->

### Draft section — `draft.md`"
  Regenerate: pnpm --filter @tc/ai run prompts:extract
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
- Every factual claim, statistic, finding, or reference to prior work must be supported by a passage and cited with {{cite:ID}} immediately after the sentence. Write the marker exactly as {{cite:ID}}, never the bare id in brackets, and do not write author names or years in the sentence: the marker shows the source. Use each passage at most three times.
- Where the scope note asks for something the passages do not cover, do not invent material. Instead write, on its own line, [[NEEDS SOURCE: <what is missing, in ten words or fewer>]] and continue with the next part of the scope.
- Do not write an introduction to the whole thesis or a conclusion to the whole thesis; write only this section.
- Organise by theme, not source by source. Open each paragraph with a sentence that states what the evidence on that theme shows, then support it with the studies: what they found, how, on which material, population or setting, under which conditions, with the figures and directions of effect the passages report.
- Compare. Where studies agree, differ, or measured the same thing under different conditions, say so in one sentence and cite each. Where they conflict, give the likely reason if a passage states one.
- Stay within the passages. Do not strengthen a hedged finding, generalise from one setting to all, or apply a finding about one material, population or country to another without saying so.
- End the section with what the cited evidence leaves unresolved for this thesis's topic, stated as a gap in the literature, citing the studies that come closest.
- Do not write sentences that describe what this section will do. Avoid empty intensifiers ("significant", "crucial", "various") unless a passage supports them.
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
