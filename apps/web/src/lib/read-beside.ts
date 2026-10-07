/**
 * "Read beside": a source's PDF in a pane to the right of the chapter (2026-10-04, from the Jenni
 * study). The pane is `components/editor/ReadBesidePane.tsx`; it shows the browser's own PDF
 * viewer in an iframe on the signed link, so there is no PDF library to ship or keep patched.
 *
 * Anything may ask for it — the citation hover card, the Sources tab — by dispatching one window
 * event, so the editor screen only has to mount the pane. On a screen too narrow for a second
 * column (a phone) the PDF opens in a new tab instead, as it always did.
 */

export const READ_BESIDE = 'tc:read-beside';

export type ReadBesideTarget = {
  sourceId: string;
  /** The page to open at, when the citation's passage knows it. */
  page: number | null;
  /** A short label for the pane's header ("Kumar 2021"); the pane falls back to "Source". */
  label?: string | null;
  /**
   * R21 (ADR-0108): the cited passage's text. The pane finds its opening words from `page` on and
   * marks them, as the reader page does for `?chunk=`.
   */
  quote?: string | null;
};

/**
 * Wide enough for the chapter list, the chapter, the tool panel and a PDF side by side — Tailwind's
 * `xl`. Below it (a phone, a tablet, a small laptop) the PDF opens in a new tab.
 */
export const READ_BESIDE_MIN_VIEWPORT = 1280;

export const PANE_MIN_WIDTH = 320;
export const PANE_DEFAULT_WIDTH = 520;
/**
 * What the rest of the screen keeps: the chapter list (14rem) and the tool panel (18rem), and the
 * chapter itself at a width that still reads as a page.
 */
export const RESERVED_WIDTH = 224 + 288 + 420;

export function canReadBeside(viewportWidth: number): boolean {
  return viewportWidth >= READ_BESIDE_MIN_VIEWPORT;
}

/** `#page=N` is the open PDF fragment every built-in viewer (Chrome, Edge, Firefox, Safari) reads. */
export function pdfAtPage(url: string, page: number | null): string {
  const bare = url.split('#')[0] as string;
  return page !== null && Number.isInteger(page) && page > 0 ? `${bare}#page=${page}` : bare;
}

/** The pane's width after a drag, kept between its minimum and what leaves the chapter room. */
export function clampPaneWidth(width: number, viewportWidth: number): number {
  const max = Math.max(PANE_MIN_WIDTH, viewportWidth - RESERVED_WIDTH);
  return Math.round(Math.min(Math.max(width, PANE_MIN_WIDTH), max));
}

/**
 * Asks for the pane. Returns false when the screen is too narrow, so the caller can open the PDF
 * in a new tab instead.
 */
export function requestReadBeside(target: ReadBesideTarget): boolean {
  if (typeof window === 'undefined' || !canReadBeside(window.innerWidth)) return false;
  window.dispatchEvent(new CustomEvent<ReadBesideTarget>(READ_BESIDE, { detail: target }));
  return true;
}
