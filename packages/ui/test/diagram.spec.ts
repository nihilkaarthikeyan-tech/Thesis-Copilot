import { parseDiagram } from '@tc/types';
import { describe, expect, it } from 'vitest';
import { layoutDiagram, wrap } from '../src/diagrams/index.js';

/** Eight pixels a character: enough to test wrapping and sizes without a canvas. */
const measure = (t: string) => t.length * 8;

describe('parseDiagram (ADR-0049)', () => {
  it('reads links, chains, labels, lone boxes and comments; same words are the same box', () => {
    const d = parseDiagram(
      [
        '# the drying line',
        'Raw fish -> Brining -> Solar dryer',
        'solar dryer -> Packaging : below 15% moisture',
        'Weather data',
        'Weather data -> Solar dryer',
      ].join('\n'),
    );
    expect(d.problems).toEqual([]);
    expect(d.nodes.map((n) => n.label)).toEqual([
      'Raw fish',
      'Brining',
      'Solar dryer',
      'Packaging',
      'Weather data',
    ]);
    expect(d.edges).toEqual([
      { from: 0, to: 1, label: null },
      { from: 1, to: 2, label: null },
      { from: 2, to: 3, label: 'below 15% moisture' },
      { from: 4, to: 2, label: null },
    ]);
  });

  it('names the line that has an arrow with nothing on one side', () => {
    expect(parseDiagram('A ->\nB -> C').problems).toEqual([
      'Line 1 has an arrow with nothing on one side.',
    ]);
  });

  it('asks for something when the text is empty, and refuses a figure too big to read', () => {
    expect(parseDiagram('  \n# only a comment').problems).toEqual(['Type at least one step.']);
    const many = Array.from({ length: 31 }, (_, i) => `Step ${i}`).join('\n');
    expect(parseDiagram(many).problems[0]).toContain('keep it to 30');
  });
});

describe('layoutDiagram', () => {
  it('puts each box one layer below the furthest box linking into it', () => {
    const d = parseDiagram('A -> B -> C\nA -> C\nD -> C');
    const layout = layoutDiagram(d, 'down', measure);
    const layer = Object.fromEntries(layout.nodes.map((n) => [n.label, n.layer]));
    expect(layer).toEqual({ A: 0, B: 1, C: 2, D: 0 });
    // Down: a later layer is lower on the page, never overlapping.
    const y = Object.fromEntries(layout.nodes.map((n) => [n.label, n]));
    expect((y.B?.y ?? 0) > (y.A?.y ?? 0) + (y.A?.h ?? 0)).toBe(true);
  });

  it('routes a link that skips a layer through a waypoint beside, not through, the box between', () => {
    const d = parseDiagram('A -> B -> C\nD -> C');
    const layout = layoutDiagram(d, 'down', measure);
    // D is in layer 0 and C in layer 2: one waypoint, in layer 1, not inside B.
    const dToC = layout.edges.findIndex((e) => e.from === 3 && e.to === 2);
    const route = layout.routes[dToC] ?? [];
    expect(route).toHaveLength(1);
    const b = layout.nodes.find((n) => n.label === 'B');
    const [x, y] = route[0] ?? [0, 0];
    const insideB = b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
    expect(insideB).toBe(false);
    // Links between neighbouring layers have no waypoints.
    expect(layout.routes.filter((r) => r.length > 0)).toHaveLength(1);
    // Waypoints are not boxes.
    expect(layout.nodes.map((n) => n.label)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('survives a cycle and lays out left to right on request', () => {
    const d = parseDiagram('Plan -> Do -> Check -> Act -> Plan');
    const layout = layoutDiagram(d, 'right', measure);
    expect(layout.nodes.map((n) => n.layer)).toEqual([0, 1, 2, 3]);
    const xs = layout.nodes.map((n) => n.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(layout.width).toBeGreaterThan(layout.height);
  });

  it('wraps a long label rather than stretching the box', () => {
    const lines = wrap(
      'A forced convection solar dryer with a biomass backup heater',
      200,
      measure,
    );
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => measure(l) <= 200)).toBe(true);
  });
});
