# ADR-0049 — Diagrams drawn from the student's own structure

**Status:** accepted · **Date:** 2026-10-03 · **Builds on:** ADR-0027 (charts from the student's
numbers).

## Context

From the Rademics Copilot comparison: it draws method and architecture figures by having the model
write Graphviz DOT and sending it to quickchart.io. That is a figure the model invented, drawn by a
third party that receives the thesis's content. We rated it "low / caution: only safe if the
student supplies the structure". A methodology chapter does need a process or framework figure,
and students were drawing them elsewhere and pasting screenshots.

## Decision

The student supplies the structure; the product only lays it out and draws it, in the browser.

- **The source is plain lines**: `A -> B`, a chain `A -> B -> C`, a labelled link `A -> B : words`,
  a box on its own line, `#` comments. The same words are the same box. `parseDiagram`
  (`@tc/types`) names the line of any problem; at most 30 boxes and 60 links.
- **Layout and drawing are ours** (`packages/ui/src/diagrams`): layers by longest path (a link that
  closes a loop is drawn as a curve bowing out to the side and does not push its target down),
  ordering by barycentre, a waypoint slot for every layer a long link crosses so it never runs
  through a box, and a slot as wide as its label for the one that carries it. Black on white; the
  canvas takes the diagram's own proportions.
- **A diagram is a figure**, exactly as a chart: drawn at 1600 px wide, uploaded through the figure
  path, inserted as an `image` node with the source on a `diagram` attribute. Selecting it turns
  the toolbar's *Diagram* into *Edit diagram*, which reopens the text. Every export treats it as a
  captioned figure.
- **No model, no outside service, no metered unit.**

## Consequences

- What is drawn is what was typed; nothing is suggested or completed.
- Layout quality is that of a small hand-written layered algorithm: right for the process and
  framework figures a thesis uses (proven in a browser with a loop, a layer-skipping link and
  labels), not for large graphs, which the limits refuse.
