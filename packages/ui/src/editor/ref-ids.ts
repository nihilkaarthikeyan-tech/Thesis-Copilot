/**
 * Stable identities for the things a cross-reference can point at (2026-09-21).
 *
 * A reference stores an id, not a number, so the thing it points at needs one that survives being
 * moved, and being cut and pasted somewhere else in the chapter.
 *
 * An image already has `key` — its object-storage path, unique and permanent — so `refIdOf` in
 * `@tc/types` falls back to it and images uploaded before cross-references existed are still
 * referenceable. A table has nothing, so `TableWithRef` gives it one.
 */

import Table from '@tiptap/extension-table';
import { nanoid } from 'nanoid';

export function newRefId(): string {
  return `r_${nanoid(10)}`;
}

/**
 * The table extension, plus an id.
 *
 * Generated in the attribute's `default`, which runs once when the node is created and then
 * travels with it: a table dragged to another section keeps its id, so references to it keep
 * working and simply renumber. Parsing an existing table without one mints a fresh id rather than
 * leaving it null, because a table nothing can point at is a table the picker cannot offer.
 */
export const TableWithRef = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      refId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-ref-id') ?? newRefId(),
        renderHTML: (attrs) => (attrs.refId ? { 'data-ref-id': attrs.refId } : {}),
      },
      /**
       * The caption every exporter prints as "Table 3.1: …". The exporters had read this
       * attribute since the template engine existed; the node never had it, so every table in
       * every submitted thesis was captioned "Table 3.1:" and nothing more.
       */
      caption: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-caption'),
        renderHTML: (attrs) => (attrs.caption ? { 'data-caption': attrs.caption } : {}),
      },
    };
  },
});
