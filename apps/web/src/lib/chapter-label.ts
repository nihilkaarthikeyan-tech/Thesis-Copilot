/**
 * A chapter's label in a list: "1. Introduction", but "Chapter 1 — Introduction" left as it is.
 * A new thesis's first chapter is titled "Chapter 1 — Introduction", and the list showed
 * "1. Chapter 1 — Introduction" (2026-10-04, found comparing with Jenni).
 */
export function chapterLabel(order: number, title: string): string {
  return /^\s*(chapter|ch\.?)\s*\d+\b/i.test(title) ? title.trim() : `${order}. ${title.trim()}`;
}
