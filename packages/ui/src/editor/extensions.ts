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
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import Underline from '@tiptap/extension-underline';
import StarterKit from '@tiptap/starter-kit';
import type { Doc as YDoc } from 'yjs';
import { Citation, type CitationOptions } from './citation.js';
import { CrossRef } from './cross-ref.js';
import { DraftBlock, type DraftBlockOptions } from './draft-block.js';
import { GhostText, type GhostTextOptions } from './ghost-text.js';
import { MathBlock, MathInline } from './math.js';
import {
  CommentAnchor,
  type ImageResolveUrl,
  type ImageUpload,
  type ImageUploadError,
  NeedsSourceNote,
  ThesisHeading,
  ThesisImage,
} from './nodes.js';
import { Provenance } from './provenance.js';
import { TableWithRef } from './ref-ids.js';
import { ReviewHighlights, type ReviewHighlightsOptions } from './review.js';

export type ThesisEditorOptions = {
  ghostText: Partial<GhostTextOptions> & Pick<GhostTextOptions, 'chapterId' | 'request'>;
  draft?: Partial<DraftBlockOptions>;
  /** The passage resolver behind the citation hover popover (PHASES 3.5). */
  citation?: CitationOptions;
  imageUpload?: ImageUpload;
  /** Shown to the student when an upload fails; without it the failure is silent. */
  imageUploadError?: ImageUploadError;
  /** A fresh link for a figure whose stored one has expired (`ImageResolveUrl`). */
  imageResolveUrl?: ImageResolveUrl;
  placeholder?: string;
  /** Tables measure the DOM for column resizing; off in tests (jsdom has no layout). */
  resizableTables?: boolean;
  /** This chapter's number, for the "3.2" in "Figure 3.2". */
  chapterNumber?: number;
  /** Supervisor comments drawn on the passages they are about (review.ts). */
  review?: Partial<ReviewHighlightsOptions>;
  /**
   * ADR-0028: edit live with others. The document then comes from the `Y.Doc`, not `content`,
   * and the provider carries everyone's cursors.
   */
  collaboration?: {
    document: YDoc;
    /** A y-websocket `WebsocketProvider`, or anything with its `awareness`. */
    provider: unknown;
    user: { name: string; color: string };
  };
};

export function thesisExtensions(options: ThesisEditorOptions): Extensions {
  return [
    // Before everything else: keymap precedence (B.3).
    GhostText.configure(options.ghostText),

    StarterKit.configure({
      heading: false,
      // Provenance is our own mark; history is fine as ghost text never enters the document.
      // Live (ADR-0028), Yjs keeps the history, so two people's undo stacks stay their own.
      ...(options.collaboration ? { history: false } : {}),
    }),
    ...(options.collaboration
      ? [
          Collaboration.configure({ document: options.collaboration.document }),
          CollaborationCursor.configure({
            provider: options.collaboration.provider,
            user: options.collaboration.user,
          }),
        ]
      : []),
    ThesisHeading,
    Underline,
    Superscript,
    Subscript,
    Link.configure({ openOnClick: false, autolink: true }),
    // The table that carries a refId, so a cross-reference can point at it (cross-ref.ts).
    TableWithRef.configure({ resizable: options.resizableTables ?? false }),
    TableRow,
    TableHeader,
    TableCell,
    ThesisImage.configure({
      ...(options.imageUpload ? { upload: options.imageUpload } : {}),
      ...(options.imageUploadError ? { onUploadError: options.imageUploadError } : {}),
      ...(options.imageResolveUrl ? { resolveUrl: options.imageResolveUrl } : {}),
    }),
    CrossRef.configure({ chapterNumber: options.chapterNumber ?? 1 }),
    MathInline,
    MathBlock,
    Citation.configure(options.citation ?? {}),
    NeedsSourceNote,
    DraftBlock.configure({ regenerateEnabled: false, ...options.draft }),
    Provenance,
    CommentAnchor,
    ReviewHighlights.configure(options.review ?? {}),
    Placeholder.configure({
      placeholder: options.placeholder ?? 'Start writing. Ctrl+/ asks for a suggestion.',
    }),
  ];
}
