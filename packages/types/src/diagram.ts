/**
 * A diagram from the student's own structure — ADR-0049.
 *
 * Rademics Copilot draws method and architecture figures by having the model write Graphviz DOT
 * and sending it to quickchart.io: a figure the model invented, drawn by a third party. Here the
 * student writes the structure — one step or link per line — and the product only lays it out
 * and draws it, in the browser, with no model and no outside service. The text is the spec, and
 * it stays on the figure so the diagram can be opened and changed like a chart (ADR-0027).
 *
 *     Raw fish -> Brining -> Solar dryer
 *     Solar dryer -> Packaging : below 15% moisture
 *     Weather data -> Solar dryer
 *
 * `A -> B` is a link, `A -> B -> C` a chain, `A -> B : words` a labelled link, a line with no
 * arrow a box on its own, `#` a comment. A box is named by its words: the same words are the
 * same box.
 */

import { z } from 'zod';

export const DIAGRAM_LIMITS = {
  source: 4_000,
  title: 160,
  nodes: 30,
  edges: 60,
  label: 80,
} as const;

export const DIAGRAM_DIRECTIONS = ['down', 'right'] as const;

export const diagramSpecSchema = z.object({
  title: z.string().trim().max(DIAGRAM_LIMITS.title),
  direction: z.enum(DIAGRAM_DIRECTIONS),
  /** The student's text, exactly as typed; the figure is drawn from it and nothing else. */
  source: z.string().max(DIAGRAM_LIMITS.source),
});
export type DiagramSpec = z.infer<typeof diagramSpecSchema>;

export type DiagramNode = { id: number; label: string };
export type DiagramEdge = { from: number; to: number; label: string | null };
export type ParsedDiagram = {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /** Each a sentence for the student, naming the line. Empty when the diagram can be drawn. */
  problems: string[];
};

const ARROW = /\s*(?:->|→|=>)\s*/;

export function parseDiagram(source: string): ParsedDiagram {
  const nodes: DiagramNode[] = [];
  const byLabel = new Map<string, number>();
  const edges: DiagramEdge[] = [];
  const problems: string[] = [];
  const seenEdge = new Set<string>();

  const node = (raw: string, line: number): number | null => {
    const label = raw.replace(/\s+/g, ' ').trim();
    if (!label) {
      problems.push(`Line ${line} has an arrow with nothing on one side.`);
      return null;
    }
    if (label.length > DIAGRAM_LIMITS.label) {
      problems.push(
        `Line ${line}: “${label.slice(0, 30)}…” is longer than ${DIAGRAM_LIMITS.label} characters.`,
      );
      return null;
    }
    const key = label.toLowerCase();
    const known = byLabel.get(key);
    if (known !== undefined) return known;
    const id = nodes.length;
    nodes.push({ id, label });
    byLabel.set(key, id);
    return id;
  };

  source.split(/\r?\n/).forEach((text, index) => {
    const line = index + 1;
    const content = text.replace(/#.*$/, '').trim();
    if (!content) return;
    // The label after the last colon belongs to the last link of the line.
    const colon = content.lastIndexOf(' : ');
    const body = colon >= 0 ? content.slice(0, colon) : content;
    const edgeLabel = colon >= 0 ? content.slice(colon + 3).trim() || null : null;
    const parts = body.split(ARROW);
    if (parts.length === 1) {
      node(parts[0] ?? '', line);
      if (edgeLabel) problems.push(`Line ${line} has a label but no arrow to put it on.`);
      return;
    }
    const ids = parts.map((p) => node(p, line));
    if (ids.some((id) => id === null)) return;
    for (let i = 0; i + 1 < ids.length; i++) {
      const from = ids[i] as number;
      const to = ids[i + 1] as number;
      const key = `${from}>${to}`;
      if (seenEdge.has(key)) continue;
      seenEdge.add(key);
      edges.push({ from, to, label: i + 2 === ids.length ? edgeLabel : null });
    }
    if (edgeLabel && edgeLabel.length > DIAGRAM_LIMITS.label) {
      problems.push(`Line ${line}: the label is longer than ${DIAGRAM_LIMITS.label} characters.`);
    }
  });

  if (nodes.length === 0 && problems.length === 0) problems.push('Type at least one step.');
  if (nodes.length > DIAGRAM_LIMITS.nodes) {
    problems.push(
      `${nodes.length} boxes is more than a figure can show; keep it to ${DIAGRAM_LIMITS.nodes}.`,
    );
  }
  if (edges.length > DIAGRAM_LIMITS.edges) {
    problems.push(`${edges.length} links is more than ${DIAGRAM_LIMITS.edges}.`);
  }
  return { nodes, edges, problems };
}
