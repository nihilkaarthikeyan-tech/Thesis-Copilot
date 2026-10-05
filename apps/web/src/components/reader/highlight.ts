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
  api.highlights.set('reader-match', new api.Highlight(...ranges));
  if (current) api.highlights.set('reader-current', new api.Highlight(current));
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
