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
import { insertBlockWithCaretAfter } from './insert-block.js';

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

/**
 * What to do when the upload fails — a rejected figure type, an expired session, MinIO down.
 *
 * Without it the command swallowed the rejection and the student saw nothing happen at all, which
 * is why the app had grown its own copy of this whole command just to show a message.
 */
export type ImageUploadError = (error: unknown) => void;

/**
 * A fresh link for a figure whose stored one no longer loads.
 *
 * The server re-signs every figure when a chapter is read, but a signed link lasts fifteen
 * minutes and a chapter stays open for hours: an image redrawn after that (an undo, a paste)
 * would ask for the old link again. The view asks for a new one once, and shows that.
 */
export type ImageResolveUrl = (key: string) => Promise<string>;

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
  onUploadError?: ImageUploadError;
  resolveUrl?: ImageResolveUrl;
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
  addNodeView() {
    const resolveUrl = this.options.resolveUrl;
    return ({ node }) => {
      const img = document.createElement('img');
      let current = node;
      // A link fetched for this figure's key, which outlives any re-render of the node.
      let fresh: { key: string; url: string } | null = null;
      let asked: string | null = null;
      const draw = () => {
        const key = typeof current.attrs.key === 'string' ? current.attrs.key : null;
        const src = fresh && fresh.key === key ? fresh.url : String(current.attrs.src ?? '');
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        img.alt = String(current.attrs.alt ?? '');
        if (current.attrs.title) img.title = String(current.attrs.title);
        if (key) img.dataset.key = key;
        else delete img.dataset.key;
      };
      img.addEventListener('error', () => {
        const key = typeof current.attrs.key === 'string' ? current.attrs.key : null;
        if (!key || !resolveUrl || asked === key) return;
        asked = key;
        resolveUrl(key).then(
          (url) => {
            fresh = { key, url };
            draw();
          },
          () => undefined,
        );
      });
      draw();
      return {
        dom: img,
        update: (updated) => {
          if (updated.type !== current.type) return false;
          current = updated;
          draw();
          return true;
        },
      };
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
          const onError = this.options.onUploadError;
          void upload(file).then(({ key, url }) => {
            if (editor.isDestroyed) return;
            editor
              .chain()
              .command(({ tr, dispatch }) => {
                const image = editor.schema.nodes.image?.create({
                  src: url,
                  // Every attribute at insertion time, including `key`.
                  //
                  // This used to be `setImage` followed by `updateAttributes('image', { key })`,
                  // and `updateAttributes` writes to the node *at the current selection* — so
                  // whether a figure ever got its storage key depended on where the selection
                  // landed. A figure with no key cannot be found at export time and becomes a
                  // bracketed placeholder in the submitted thesis.
                  alt: caption ?? file.name,
                  key,
                  caption: caption ?? null,
                });
                const paragraph = editor.schema.nodes.paragraph?.create();
                if (!image || !paragraph) return false;
                if (!dispatch) return true;

                return insertBlockWithCaretAfter(tr, image, paragraph);
              })
              .run();
          }, onError);
          return true;
        },
    };
  },
});
