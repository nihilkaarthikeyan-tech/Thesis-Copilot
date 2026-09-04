/**
 * The thesis editor schema — PRD Appendix B.2, assembled in one place.
 *
 * Nodes: doc, heading (1–3), paragraph, bulletList, orderedList, listItem, table*, image,
 * mathInline, mathBlock, codeBlock, blockquote, hardBreak, citation, draftBlock, needsSourceNote.
 * Marks: bold, italic, underline, strike, link, superscript, subscript, provenance, commentAnchor.
 *
 * GhostText carries priority 1000 so its Tab handler runs before list indentation (B.3).
 */

import type { Extensions } from '@tiptap/core';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import Underline from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';
import { Citation } from './citation.js';
import { DraftBlock, type DraftBlockOptions } from './draft-block.js';
import { GhostText, type GhostTextOptions } from './ghost-text.js';
import { MathBlock, MathInline } from './math.js';
import {
  CommentAnchor,
  type ImageUpload,
  NeedsSourceNote,
  ThesisHeading,
  ThesisImage,
} from './nodes.js';
import { Provenance } from './provenance.js';

export type ThesisEditorOptions = {
  ghostText: Partial<GhostTextOptions> & Pick<GhostTextOptions, 'chapterId' | 'request'>;
  draft?: Partial<DraftBlockOptions>;
  imageUpload?: ImageUpload;
  placeholder?: string;
  /** Tables measure the DOM for column resizing; off in tests (jsdom has no layout). */
  resizableTables?: boolean;
};

export function thesisExtensions(options: ThesisEditorOptions): Extensions {
  return [
    // Before everything else: keymap precedence (B.3).
    GhostText.configure(options.ghostText),

    StarterKit.configure({
      heading: false,
      // Provenance is our own mark; history is fine as ghost text never enters the document.
    }),
    ThesisHeading,
    Underline,
    Superscript,
    Subscript,
    Link.configure({ openOnClick: false, autolink: true }),
    Table.configure({ resizable: options.resizableTables ?? false }),
    TableRow,
    TableHeader,
    TableCell,
    ThesisImage.configure({ ...(options.imageUpload ? { upload: options.imageUpload } : {}) }),
    MathInline,
    MathBlock,
    Citation,
    NeedsSourceNote,
    DraftBlock.configure({ regenerateEnabled: false, ...options.draft }),
    Provenance,
    CommentAnchor,
    Placeholder.configure({
      placeholder: options.placeholder ?? 'Start writing. Ctrl+/ asks for a suggestion.',
    }),
  ];
}
