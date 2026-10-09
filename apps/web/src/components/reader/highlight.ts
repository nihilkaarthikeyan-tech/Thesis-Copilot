/**
 * Finding and marking search matches in the reader's DOM (ADR-0068).
 *
 * Matches are drawn with the CSS Custom Highlight API: a `Range` per match, registered under a
 * name the stylesheet colours (`::highlight(reader-match)`). Nothing is wrapped in a `<mark>`, so
 * pdf.js's text layer — whose spans are positioned one by one over the canvas — is never touched,
 * and a selection made afterwards is exactly the one the student would have made anyway. A
 * browser without the API still moves to each match and counts them; it just draws no colour.
 */

import { findAll, normaliseQuery, SearchIndex } from '@/lib/reader';

type Origin = { node: Text; offset: number };

/** The searchable text under `root`: text nodes in order, a `<br>` as the space it stands for. */
export function indexElement(root: Element): SearchIndex<Origin> {
  const index = new SearchIndex<Origin>();
  // `data-search-skip` marks furniture (a "Page 4" marker) that is not the paper's own text.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) =>
      node.nodeType === Node.ELEMENT_NODE && (node as Element).hasAttribute('data-search-skip')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text;
      index.push(text.data, (offset) => ({ node: text, offset }));
    } else if ((node as Element).tagName === 'BR' || (node as Element).hasAttribute('data-gap')) {
      index.gap();
    }
  }
  return index;
}

/** A DOM range for each occurrence of `query` under `root`, in reading order. */
export function matchRanges(root: Element, query: string): Range[] {
  const needle = normaliseQuery(query);
  if (!needle) return [];
  const index = indexElement(root);
  const ranges: Range[] = [];
  for (const start of findAll(index.text, needle)) {
    const first = firstOrigin(index.origins, start, start + needle.length);
    const last = lastOrigin(index.origins, start, start + needle.length);
    if (!first || !last) continue;
    const range = document.createRange();
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, last.offset + 1);
    ranges.push(range);
  }
  return ranges;
}

function firstOrigin(origins: ReadonlyArray<Origin | null>, from: number, to: number) {
  for (let i = from; i < to; i++) if (origins[i]) return origins[i];
  return null;
}

function lastOrigin(origins: ReadonlyArray<Origin | null>, from: number, to: number) {
  for (let i = to - 1; i >= from; i--) if (origins[i]) return origins[i];
  return null;
}

type HighlightRegistry = {
  set: (name: string, value: unknown) => void;
  delete: (name: string) => void;
};

function registry(): {
  highlights: HighlightRegistry;
  Highlight: new (...r: Range[]) => unknown;
} | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const Highlight = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!css?.highlights || !Highlight) return null;
  return { highlights: css.highlights, Highlight };
}

/** Colours every match, and the current one more strongly. */
export function paintMatches(ranges: readonly Range[], current: Range | null): void {
  const api = registry();
  if (!api) return;
  // Above the student's own highlights (ADR-0130), so a search match on a yellow passage shows.
  const raise = <T>(highlight: T): T => Object.assign(highlight as object, { priority: 2 }) as T;
  api.highlights.set('reader-match', raise(new api.Highlight(...ranges)));
  if (current) api.highlights.set('reader-current', raise(new api.Highlight(current)));
  else api.highlights.delete('reader-current');
}

export function clearMatches(): void {
  const api = registry();
  if (!api) return;
  api.highlights.delete('reader-match');
  api.highlights.delete('reader-current');
}

/** Scrolls `scroller` so the range sits a third of the way down it. */
export function scrollRangeIntoView(scroller: HTMLElement, range: Range): void {
  const box = range.getBoundingClientRect();
  const frame = scroller.getBoundingClientRect();
  if (box.height === 0 && box.width === 0) return;
  const top = scroller.scrollTop + (box.top - frame.top) - frame.height / 3;
  scroller.scrollTo({ top: Math.max(0, top) });
  const left = box.left - frame.left;
  if (left < 0 || left > frame.width - 40) {
    scroller.scrollTo({ left: Math.max(0, scroller.scrollLeft + left - 40) });
  }
}

// ---- Highlights the student keeps (ADR-0130) -----------------------------------------------------

/**
 * Where `range` sits in `root`'s searchable text: the offsets of its first and last characters in
 * `indexElement(root).text`, which is what a saved highlight is anchored to.
 */
export function rangeOffsets(
  root: Element,
  range: Range,
): { text: string; start: number; end: number } | null {
  const index = indexElement(root);
  let start = -1;
  let end = -1;
  for (let i = 0; i < index.origins.length; i++) {
    const origin = index.origins[i];
    if (!origin) continue;
    let at: number;
    try {
      at = range.comparePoint(origin.node, origin.offset);
    } catch {
      continue;
    }
    if (at === 1) break; // past the end of the selection
    if (at === 0 && range.comparePoint(origin.node, origin.offset + 1) === 0) {
      if (start < 0) start = i;
      end = i + 1;
    }
  }
  if (start < 0) return null;
  return { text: index.text, start, end };
}

/** A DOM range over `start`..`end` of `root`'s searchable text, or null when it has no text there. */
export function rangeAt(root: Element, start: number, end: number): Range | null {
  const index = indexElement(root);
  const first = firstOrigin(index.origins, start, end);
  const last = lastOrigin(index.origins, start, end);
  if (!first || !last) return null;
  const range = document.createRange();
  try {
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, last.offset + 1);
  } catch {
    return null;
  }
  return range;
}

/** The searchable text of `root`, as anchors are written against it. */
export function searchableText(root: Element): string {
  return indexElement(root).text;
}

export const HIGHLIGHT_NAMES = ['yellow', 'green', 'blue', 'pink'] as const;

/**
 * Draws the student's highlights, one CSS highlight per colour (`::highlight(reader-hl-yellow)`
 * and so on), and the one being looked at more strongly. Ranges into a page that has since been
 * redrawn or scrolled away are dropped: they would draw nothing anyway.
 */
export function paintHighlights(
  byColour: ReadonlyMap<string, readonly Range[]>,
  active: Range | null,
): void {
  const api = registry();
  if (!api) return;
  for (const colour of HIGHLIGHT_NAMES) {
    const ranges = (byColour.get(colour) ?? []).filter((r) => r.startContainer.isConnected);
    if (ranges.length > 0) api.highlights.set(`reader-hl-${colour}`, new api.Highlight(...ranges));
    else api.highlights.delete(`reader-hl-${colour}`);
  }
  if (active?.startContainer.isConnected) {
    api.highlights.set('reader-hl-active', new api.Highlight(active));
  } else api.highlights.delete('reader-hl-active');
}

export function clearHighlights(): void {
  const api = registry();
  if (!api) return;
  for (const colour of HIGHLIGHT_NAMES) api.highlights.delete(`reader-hl-${colour}`);
  api.highlights.delete('reader-hl-active');
}
