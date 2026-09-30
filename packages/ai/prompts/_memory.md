<!--
  Thesis Copilot prompt, owned by the product (ADR-0038). It started as docs/PRD.md, "### A.0.1 Document memory block — `_memory.md` (cached block, part 2)".
  Change it only when a candidate wins the side-by-side evaluation on the real models
  (packages/ai/eval/run.ts), and record the result in docs/BUILD_LOG.md.
-->

### A.0.1 Document memory block — `_memory.md` (cached block, part 2)

Rendered by the prompt builder from `DocumentMemory`. Trimmed in this order until ≤ 3,200 tokens: (1) other chapters' scope notes → titles only, (2) glossary entries not appearing in the current chapter's text, (3) style profile samples.

```
<document_memory>
<scope>
Working title: {{scope.workingTitle}}
Problem statement: {{scope.problemStatement}}
Objectives:
{{#each scope.objectives}}- {{this}}
{{/each}}
Why this is not yet fully answered: {{scope.whyOpen}}
</scope>
<outline current_chapter="{{chapter.outlineNodeId}}">
{{outline_rendered}}   <!-- current chapter and its neighbours in full (title + scope note + subheadings); all other chapters as "N. Title" only -->
</outline>
<glossary>
{{#each glossary}}- {{term}}: {{definition}}{{#if usageNote}} ({{usageNote}}){{/if}}
{{/each}}
</glossary>
{{#if styleProfile}}
<style_profile>
{{styleProfile.voiceNote}}
Typical sentence length: {{styleProfile.avgSentenceLen}} words. Register: {{styleProfile.register}}. Voice: {{styleProfile.voice}}.
Transitions the student uses: {{styleProfile.transitions}}.
</style_profile>
{{/if}}
</document_memory>
```
