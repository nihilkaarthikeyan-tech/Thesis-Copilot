/**
 * Smaller schema pieces from PRD Appendix B.2:
 *   - `needsSourceNote`: inline atom, only meaningful inside a draftBlock (B.6)
 *   - `commentAnchor`: mark, registered but inert until Phase 3 (B.1)
 *   - `heading`: levels 1–3, level 1 reserved for the chapter title and not user-insertable
 *   - `image`: stores an object-storage key, never base64 (B.1); upload via a signed URL hook
 */

import { Mark, mergeAttributes, Node, textblockTypeInputRule } from '@tiptap/core';
import Heading from '@tiptap/extension-heading';
import Image from '@tiptap/extension-image';

export const NeedsSourceNote = Node.create({
  name: 'needsSourceNote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ text: { default: '' } }),
  parseHTML: () => [{ tag: 'span[data-needs-source]' }],
  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-needs-source': '',
        class: 'needs-source-note',
        title: 'The pinned sources did not cover this',
      }),
      `[[NEEDS SOURCE: ${String(node.attrs.text)}]]`,
    ];
  },
});

export const CommentAnchor = Mark.create({
  name: 'commentAnchor',
  inclusive: false,
  addAttributes: () => ({ commentId: { default: null } }),
  parseHTML: () => [{ tag: 'span[data-comment-id]' }],
  renderHTML({ HTMLAttributes, mark }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-comment-id': mark.attrs.commentId }),
      0,
    ];
  },
});

/**
 * Heading with level 1 reserved (B.2). Programmatic `setNode('heading', { level: 1 })` still works
 * for the chapter title; the `#` input rule and the keyboard shortcut only offer levels 2 and 3.
 */
export const ThesisHeading = Heading.extend({
  addInputRules() {
    return [2, 3].map((level) =>
      textblockTypeInputRule({
        find: new RegExp(`^(#{${level}})\\s$`),
        type: this.type,
        getAttributes: { level },
      }),
    );
  },
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-2': () => this.editor.commands.toggleHeading({ level: 2 }),
      'Mod-Alt-3': () => this.editor.commands.toggleHeading({ level: 3 }),
    };
  },
}).configure({ levels: [1, 2, 3] });

export type ImageUpload = (file: File) => Promise<{ key: string; url: string }>;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    thesisImage: {
      /** Uploads through `options.upload` (signed URL) and inserts the resulting node. */
      uploadImage: (file: File, caption?: string) => ReturnType;
    };
  }
}

export const ThesisImage = Image.extend<{
  upload?: ImageUpload;
  inline: boolean;
  allowBase64: boolean;
  HTMLAttributes: Record<string, unknown>;
}>({
  addOptions() {
    return { ...this.parent?.(), inline: false, allowBase64: false };
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      key: { default: null, renderHTML: (a) => (a.key ? { 'data-key': a.key } : {}) },
      caption: {
        default: null,
        renderHTML: (a) => (a.caption ? { 'data-caption': a.caption } : {}),
      },
    };
  },
  addCommands() {
    return {
      ...this.parent?.(),
      uploadImage:
        (file, caption) =>
        ({ editor }) => {
          const upload = this.options.upload;
          if (!upload) return false;
          void upload(file).then(({ key, url }) => {
            if (!editor.isDestroyed) {
              editor.commands.setImage({ src: url, alt: caption ?? file.name });
              // `key`/`caption` are set through updateAttributes on the inserted node.
              editor.commands.updateAttributes('image', { key, caption: caption ?? null });
            }
          });
          return true;
        },
    };
  },
});
