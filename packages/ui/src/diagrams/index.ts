/**
 * Diagram layout and drawing — ADR-0049. A layered flowchart drawn on a canvas, like the charts
 * (ADR-0027): deterministic, no library, no model, prints in black and white.
 *
 * Layout: each box goes one layer below the furthest box that links into it (a link that closes a
 * cycle is drawn but does not push its target down), then each layer is ordered by the average
 * position of the boxes linking into it, twice, which removes most crossings in the small figures
 * a thesis uses.
 */

import type { DiagramEdge, DiagramNode, DiagramSpec, ParsedDiagram } from '@tc/types';

export type PlacedNode = DiagramNode & {
  layer: number;
  order: number;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
};

export type DiagramLayout = {
  nodes: PlacedNode[];
  edges: DiagramEdge[];
  /** Per edge, the waypoints a link that skips layers passes through; empty for the rest. */
  routes: Array<Array<[number, number]>>;
  width: number;
  height: number;
};

type Measure = (text: string) => number;

const BOX = { maxWidth: 260, padX: 18, padY: 12, lineHeight: 22, gapLayer: 70, gapOrder: 36 };

/** Words wrapped to fit `max` pixels as `measure` reads them. */
export function wrap(text: string, max: number, measure: Measure): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= max || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

/** Layers by longest path from the boxes nothing links into; cycles cut where they close. */
function layers(nodes: readonly DiagramNode[], edges: readonly DiagramEdge[]): number[] {
  const out = new Map<number, number[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  // Depth-first order to find the links that close a cycle.
  const state = new Map<number, 'open' | 'done'>();
  const back = new Set<string>();
  const visit = (n: number) => {
    state.set(n, 'open');
    for (const m of out.get(n) ?? []) {
      if (state.get(m) === 'open') back.add(`${n}>${m}`);
      else if (!state.has(m)) visit(m);
    }
    state.set(n, 'done');
  };
  for (const n of nodes) if (!state.has(n.id)) visit(n.id);

  const forward = edges.filter((e) => !back.has(`${e.from}>${e.to}`) && e.from !== e.to);
  const layer = nodes.map(() => 0);
  // Relax until stable: a DAG of at most 30 boxes settles in at most 30 passes.
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const e of forward) {
      const want = (layer[e.from] ?? 0) + 1;
      if ((layer[e.to] ?? 0) < want) {
        layer[e.to] = want;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return layer;
}

export function layoutDiagram(
  parsed: Pick<ParsedDiagram, 'nodes' | 'edges'>,
  direction: DiagramSpec['direction'],
  measure: Measure,
): DiagramLayout {
  const layerOf = layers(parsed.nodes, parsed.edges);
  const count = Math.max(0, ...layerOf) + 1;
  const byLayer: number[][] = Array.from({ length: count }, () => []);
  for (const n of parsed.nodes) byLayer[layerOf[n.id] ?? 0]?.push(n.id);

  // A link that skips layers gets a waypoint in each layer it crosses, which takes a slot in that
  // layer's order like a narrow box. Without it the line ran straight through whatever box sat
  // in between, and its label hid behind that box (found in the first browser run).
  const waypointLayer = new Map<number, number>();
  const routeIds: number[][] = parsed.edges.map(() => []);
  let nextId = parsed.nodes.length;
  parsed.edges.forEach((e, i) => {
    const from = layerOf[e.from] ?? 0;
    const to = layerOf[e.to] ?? 0;
    for (let l = from + 1; l < to; l++) {
      const id = nextId++;
      waypointLayer.set(id, l);
      byLayer[l]?.push(id);
      routeIds[i]?.push(id);
    }
  });
  // The links as the ordering sees them: each long link split at its waypoints.
  const segments: Array<{ from: number; to: number }> = [];
  parsed.edges.forEach((e, i) => {
    const chain = [e.from, ...(routeIds[i] ?? []), e.to];
    for (let k = 0; k + 1 < chain.length; k++) {
      segments.push({ from: chain[k] as number, to: chain[k + 1] as number });
    }
  });
  const layerOfAny = (id: number) =>
    id < parsed.nodes.length ? (layerOf[id] ?? 0) : (waypointLayer.get(id) ?? 0);

  // Order within a layer by the mean position of the boxes linking in, two sweeps.
  const position = new Map<number, number>();
  for (const ids of byLayer) {
    ids.forEach((id, i) => {
      position.set(id, i);
    });
  }
  for (let sweep = 0; sweep < 2; sweep++) {
    for (let l = 1; l < count; l++) {
      const ids = byLayer[l] ?? [];
      const score = (id: number) => {
        const ins = segments.filter((e) => e.to === id && layerOfAny(e.from) < l);
        if (ins.length === 0) return position.get(id) ?? 0;
        return ins.reduce((s, e) => s + (position.get(e.from) ?? 0), 0) / ins.length;
      };
      ids.sort((a, b) => score(a) - score(b) || a - b);
      ids.forEach((id, i) => {
        position.set(id, i);
      });
    }
  }

  type Sized = { id: number; label: string; lines: string[]; w: number; h: number };
  const sized = new Map<number, Sized>();
  for (const n of parsed.nodes) {
    const lines = wrap(n.label, BOX.maxWidth - 2 * BOX.padX, measure);
    const w = Math.min(BOX.maxWidth, Math.max(120, ...lines.map((l) => measure(l) + 2 * BOX.padX)));
    sized.set(n.id, {
      id: n.id,
      label: n.label,
      lines,
      w,
      h: lines.length * BOX.lineHeight + 2 * BOX.padY,
    });
  }
  // A waypoint is a narrow slot, except the one that carries its link's label: that slot is as
  // wide as the label (drawn at about 0.85 of the box font), so the label sits in its own room.
  const down = direction === 'down';
  const labelAt = new Map<number, string>();
  parsed.edges.forEach((e, i) => {
    const ids = routeIds[i] ?? [];
    const mid = ids[Math.floor(ids.length / 2)];
    if (e.label && mid !== undefined) labelAt.set(mid, e.label);
  });
  for (const id of waypointLayer.keys()) {
    const label = labelAt.get(id);
    const room = label ? measure(label) * 0.85 + 16 : 24;
    sized.set(id, { id, label: '', lines: [], w: down ? room : 24, h: down ? 24 : 28 });
  }
  const get = (id: number) => sized.get(id) as Sized;

  // Main axis: layers; cross axis: order within the layer. Each layer is centred on the widest.
  const mainSize = (n: Sized) => (down ? n.h : n.w);
  const crossSize = (n: Sized) => (down ? n.w : n.h);
  const layerMain = byLayer.map((ids) => Math.max(0, ...ids.map((id) => mainSize(get(id)))));
  const layerCross = byLayer.map(
    (ids) =>
      ids.reduce((s, id) => s + crossSize(get(id)), 0) + Math.max(0, ids.length - 1) * BOX.gapOrder,
  );
  const crossTotal = Math.max(0, ...layerCross);

  const placed: PlacedNode[] = [];
  const waypoint = new Map<number, [number, number]>();
  let main = 0;
  byLayer.forEach((ids, l) => {
    let cross = (crossTotal - (layerCross[l] ?? 0)) / 2;
    for (const id of ids) {
      const n = get(id);
      const mainOffset = ((layerMain[l] ?? 0) - mainSize(n)) / 2;
      const x = down ? cross : main + mainOffset;
      const y = down ? main + mainOffset : cross;
      if (waypointLayer.has(id)) waypoint.set(id, [x + n.w / 2, y + n.h / 2]);
      else {
        placed.push({ ...n, layer: l, order: position.get(id) ?? 0, x, y });
      }
      cross += crossSize(n) + BOX.gapOrder;
    }
    main += (layerMain[l] ?? 0) + BOX.gapLayer;
  });
  const mainTotal = Math.max(0, main - BOX.gapLayer);
  placed.sort((a, b) => a.id - b.id);
  return {
    nodes: placed,
    edges: parsed.edges,
    routes: routeIds.map((ids) => ids.map((id) => waypoint.get(id) as [number, number])),
    width: down ? crossTotal : mainTotal,
    height: down ? mainTotal : crossTotal,
  };
}

/** Where the line from a box's centre towards `(tx, ty)` leaves the box. */
function exitPoint(n: PlacedNode, tx: number, ty: number): [number, number] {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const sx = dx === 0 ? Number.POSITIVE_INFINITY : n.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Number.POSITIVE_INFINITY : n.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return [cx + dx * s, cy + dy * s];
}

const FONT = '18px "Helvetica Neue", Arial, sans-serif';
const LABEL_FONT = 'italic 15px "Helvetica Neue", Arial, sans-serif';
const TITLE_FONT = 'bold 22px "Helvetica Neue", Arial, sans-serif';

/**
 * Draws the diagram to fill the canvas, scaled to fit with a margin; the title on top. Black on
 * white, so it prints and photocopies.
 *
 * With `fit`, the canvas height is first set to the diagram's own proportions (between a third
 * and one and a quarter of the width): a tall flowchart squeezed into a 16:10 frame drew its boxes
 * too small to read — found in the first browser run.
 */
export function drawDiagram(
  canvas: HTMLCanvasElement,
  spec: DiagramSpec,
  parsed: ParsedDiagram,
  options: { fit?: boolean } = {},
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.font = FONT;
  const margin = 40;
  const titleSpace = spec.title ? 50 : 0;
  const layout =
    parsed.nodes.length > 0
      ? layoutDiagram(parsed, spec.direction, (t) => ctx.measureText(t).width)
      : null;
  // Room on the right (top to bottom) or below (left to right) for the loops that bow out.
  let bowRoom = 0;
  if (layout) {
    const layerOf = new Map(layout.nodes.map((n) => [n.id, n.layer]));
    ctx.font = LABEL_FONT;
    for (const e of layout.edges) {
      const from = layerOf.get(e.from) ?? 0;
      const to = layerOf.get(e.to) ?? 0;
      if (to > from) continue;
      const bow = 70 + 20 * Math.abs(from - to);
      // A quadratic reaches half its control point's offset; its label sits there.
      const label = e.label ? ctx.measureText(e.label).width / 2 + 10 : 0;
      bowRoom = Math.max(bowRoom, bow / 2 + label + 10);
    }
    ctx.font = FONT;
  }
  const down = spec.direction === 'down';
  const contentW = (layout?.width ?? 0) + (down ? bowRoom : 0);
  const contentH = (layout?.height ?? 0) + (down ? 0 : bowRoom);
  if (options.fit && layout) {
    const ratio = (contentH + 2 * margin + titleSpace) / (contentW + 2 * margin);
    canvas.height = Math.round(canvas.width * Math.min(1.25, Math.max(1 / 3, ratio)));
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!layout) return;
  ctx.font = FONT;
  const scale = Math.min(
    1.6,
    (canvas.width - 2 * margin) / Math.max(1, contentW),
    (canvas.height - 2 * margin - titleSpace) / Math.max(1, contentH),
  );
  const offsetX = (canvas.width - contentW * scale) / 2;
  const offsetY =
    margin + titleSpace + (canvas.height - 2 * margin - titleSpace - contentH * scale) / 2;

  if (spec.title) {
    ctx.fillStyle = '#111111';
    ctx.font = TITLE_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(spec.title, canvas.width / 2, margin / 2);
  }

  ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));

  // Links first, so boxes sit on top of them.
  ctx.strokeStyle = '#333333';
  ctx.fillStyle = '#333333';
  ctx.lineWidth = 2;
  layout.edges.forEach((e, index) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) return;
    const route = layout.routes[index] ?? [];
    // A link that goes back up the flow (a loop: "above 15% -> dry again") would lie on top of
    // the forward link between the same boxes. It leaves and enters from the side and bows out.
    const backward = b.layer <= a.layer;
    let x1: number;
    let y1: number;
    let x2: number;
    let y2: number;
    let cx = 0;
    let cy = 0;
    if (backward) {
      const bow = 70 + 20 * Math.abs(a.layer - b.layer);
      if (down) {
        x1 = a.x + a.w;
        y1 = a.y + a.h / 2;
        x2 = b.x + b.w;
        y2 = b.y + b.h / 2;
        cx = Math.max(x1, x2) + bow;
        cy = (y1 + y2) / 2;
      } else {
        x1 = a.x + a.w / 2;
        y1 = a.y + a.h;
        x2 = b.x + b.w / 2;
        y2 = b.y + b.h;
        cx = (x1 + x2) / 2;
        cy = Math.max(y1, y2) + bow;
      }
    } else {
      const first = route[0];
      const last = route[route.length - 1];
      [x1, y1] = exitPoint(a, first ? first[0] : b.x + b.w / 2, first ? first[1] : b.y + b.h / 2);
      [x2, y2] = exitPoint(b, last ? last[0] : a.x + a.w / 2, last ? last[1] : a.y + a.h / 2);
    }
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    if (backward) ctx.quadraticCurveTo(cx, cy, x2, y2);
    else {
      for (const [px, py] of route) ctx.lineTo(px, py);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
    // The arrowhead follows the line's last direction: the curve's, or the last leg's.
    const before = route[route.length - 1];
    const angle = backward
      ? Math.atan2(y2 - cy, x2 - cx)
      : Math.atan2(y2 - (before ? before[1] : y1), x2 - (before ? before[0] : x1));
    const head = 12;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(angle - 0.4), y2 - head * Math.sin(angle - 0.4));
    ctx.lineTo(x2 - head * Math.cos(angle + 0.4), y2 - head * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();
    if (e.label) {
      ctx.font = LABEL_FONT;
      // On a curve the label sits at its midpoint (t = ½ of the quadratic).
      // On a routed link, at its middle waypoint, which sits in a gap between boxes.
      const mid = route[Math.floor(route.length / 2)];
      const mx = backward ? 0.25 * x1 + 0.5 * cx + 0.25 * x2 : mid ? mid[0] : (x1 + x2) / 2;
      const my = backward ? 0.25 * y1 + 0.5 * cy + 0.25 * y2 : mid ? mid[1] : (y1 + y2) / 2;
      const tw = ctx.measureText(e.label).width;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(mx - tw / 2 - 4, my - 11, tw + 8, 22);
      ctx.fillStyle = '#333333';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(e.label, mx, my);
    }
  });

  ctx.font = FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const n of layout.nodes) {
    ctx.fillStyle = '#f4f4f4';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(n.x, n.y, n.w, n.h, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#111111';
    n.lines.forEach((line, i) => {
      ctx.fillText(line, n.x + n.w / 2, n.y + BOX.padY + BOX.lineHeight / 2 + i * BOX.lineHeight);
    });
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
